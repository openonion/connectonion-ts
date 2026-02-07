/**
 * @purpose Client for connecting to remote agents via WebSocket with automatic keep-alive, session recovery, and polling fallback
 * @llm-note
 *   Dependencies: imports from [src/address.ts (AddressData, generate, load, sign, etc.), src/types.ts (SessionStatus)] | imported by [src/index.ts, src/react/index.ts, examples/connect-example.ts, tests/connect.test.ts] | tested by [tests/connect.test.ts]
 *   Data flow: connect(address, options) → creates RemoteAgent → agent.input(prompt) → generates session_id (UUID) → saves to localStorage → opens WebSocket → sends INPUT{type, input_id, to, prompt, session{session_id}, signature?} → receives PING every 30s, responds with PONG → receives stream events (tool_call, tool_result, thinking, assistant) → receives OUTPUT{result, session_id, session} → clears localStorage → returns Response{text, done} | On disconnect/timeout: polls GET /sessions/{session_id} every 10s until result ready
 *   State/Effects: opens WebSocket connections | sends signed/unsigned messages | updates internal UI events array | syncs session from server | generates/loads Ed25519 keys | saves keys to localStorage (browser) or .co/keys/ (Node.js) | saves active session_id to localStorage for recovery | polls server via HTTP fetch on connection failure | health check interval detects dead connections
 *   Integration: exposes connect(address, options), RemoteAgent class, Response, ChatItem types, AgentStatus, ConnectOptions{enablePolling, pollIntervalMs, maxPollAttempts} | supports relay mode (wss://oo.openonion.ai) and direct mode (deployed agent URL) | Ed25519 signing for authentication | session persistence across calls | automatic recovery from network failures, timeouts, page refreshes
 *   Performance: 600s timeout default (10 min, up from 180s) | real-time WebSocket streaming | parallel tool execution on agent side | no client-side caching | auto-generates keys if missing | PING/PONG keep-alive every 30s | health check every 10s | polling fallback on failures | results persist 24h server-side
 *   Errors: throws on timeout (600s default) after polling exhausted | throws on WebSocket errors after polling attempt | throws on connection close after polling attempt | throws on ERROR messages from server | throws if session expired (404) during polling | includes error context in messages | graceful fallback to polling prevents data loss
 *
 * Architecture:
 *   Normal Flow:
 *     Client → /ws/input → Relay → Agent → OUTPUT → Relay → Client
 *
 *   Keep-Alive:
 *     Server sends PING every 30s → Client responds PONG → Health check every 10s
 *
 *   Recovery Flow (on disconnect/timeout):
 *     WebSocket fails → Poll GET /sessions/{session_id} every 10s → Status="done" → Return result
 *
 * Related Files:
 *   - oo-api/relay/routes.py: Relay server WebSocket endpoints
 *   - connectonion/network/connect.py: Python equivalent of this file
 *   - connectonion/network/asgi/websocket.py: Server-side PING sender
 *   - connectonion/network/host/session.py: SessionStorage for 24h TTL
 *   - src/react/index.ts: useAgent hook built on RemoteAgent
 *   - src/types.ts: SessionStatus, PollResult interfaces
 */

import * as address from './address';

export type { AddressData } from './address';

// ============================================================================
// Response Type
// ============================================================================

/**
 * Response from remote agent input.
 *
 * @property text - Agent's response or question
 * @property done - True if task complete, false if agent needs more input
 */
export interface Response {
  text: string;
  done: boolean;
}

// ============================================================================
// Chat Item Types (data for rendering chat UI)
// ============================================================================

/** Chat item type */
export type ChatItemType = 'user' | 'agent' | 'thinking' | 'tool_call' | 'ask_user' | 'approval_needed' | 'onboard_required' | 'onboard_success' | 'intent' | 'eval' | 'compact';

/** Chat item - data for rendering one element in chat UI */
export type ChatItem =
  | { id: string; type: 'user'; content: string }
  | { id: string; type: 'agent'; content: string }
  | { id: string; type: 'thinking'; status: 'running' | 'done' | 'error'; model?: string; duration_ms?: number; content?: string; kind?: string; context_percent?: number; usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } }
  | { id: string; type: 'tool_call'; name: string; args?: Record<string, unknown>; status: 'running' | 'done' | 'error'; result?: string; timing_ms?: number }
  | { id: string; type: 'ask_user'; text: string; options: string[]; multi_select: boolean }
  | { id: string; type: 'approval_needed'; tool: string; arguments: Record<string, unknown>; description?: string; batch_remaining?: Array<{ tool: string; arguments: string }> }
  | { id: string; type: 'onboard_required'; methods: string[]; paymentAmount?: number }
  | { id: string; type: 'onboard_success'; level: string; message: string }
  | { id: string; type: 'intent'; status: 'analyzing' | 'understood'; ack?: string; is_build?: boolean }
  | { id: string; type: 'eval'; status: 'evaluating' | 'done'; passed?: boolean; summary?: string; expected?: string; eval_path?: string }
  | { id: string; type: 'compact'; status: 'compacting' | 'done' | 'error'; context_before?: number; context_after?: number; context_percent?: number; message?: string; error?: string };

// ============================================================================
// WebSocket Types
// ============================================================================

// Minimal WebSocket-like interface to support both 'ws' and browser WebSocket
type WebSocketLike = {
  onopen: ((ev?: unknown) => unknown) | null;
  onmessage: ((ev: { data: unknown }) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  onclose: ((ev: unknown) => unknown) | null;
  send(data: unknown): void;
  close(): void;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

function defaultWebSocketCtor(): WebSocketCtor {
  const g = globalThis as { WebSocket?: WebSocketCtor };
  if (typeof g.WebSocket === 'function') {
    return g.WebSocket;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WS = require('ws');
  return WS as WebSocketCtor;
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if running in browser environment (same check as in address.ts).
 */
function isBrowserEnv(): boolean {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
    typeof (globalThis as { localStorage?: unknown }).localStorage !== 'undefined';
}

/**
 * Canonical JSON with sorted keys for consistent signatures.
 */
function canonicalJSON(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = obj[key];
  }
  return JSON.stringify(sortedObj);
}

function normalizeRelayBase(relayUrl: string): string {
  let normalized = relayUrl.replace(/\/$/, '');
  if (normalized.endsWith('/ws/announce')) {
    normalized = normalized.slice(0, -('/ws/announce'.length));
  } else if (normalized.endsWith('/ws')) {
    normalized = normalized.slice(0, -('/ws'.length));
  }
  return normalized;
}

// ============================================================================
// Connect Options
// ============================================================================

export interface ConnectOptions {
  /** Signing keys for authenticated requests */
  keys?: address.AddressData;
  /** Relay URL for WebSocket connection (default: wss://oo.openonion.ai) */
  relayUrl?: string;
  /**
   * Direct agent URL for deployed agents (bypasses relay).
   * Use this for agents deployed via `co deploy`.
   * Example: 'https://my-agent.agents.openonion.ai'
   *
   * When set:
   * - Connects directly to {directUrl}/ws
   * - Does not use relay routing
   * - Agent address is optional (used only for signing)
   */
  directUrl?: string;
  /** Custom WebSocket constructor */
  wsCtor?: WebSocketCtor;
  /** Enable polling fallback when WebSocket fails (default: true) */
  enablePolling?: boolean;
  /** Polling interval in milliseconds (default: 10000 / 10 seconds) */
  pollIntervalMs?: number;
  /** Maximum polling attempts (default: 30 / 5 minutes of polling) */
  maxPollAttempts?: number;
}

/** Session state synced from server */
export interface SessionState {
  session_id?: string;
  messages?: Array<{ role: string; content: string }>;
  trace?: unknown[];
  turn?: number;
}

// ============================================================================
// RemoteAgent Class
// ============================================================================

/** Agent status */
export type AgentStatus = 'idle' | 'working' | 'waiting';

/**
 * Proxy to a remote agent with streaming support.
 *
 * @example
 * ```typescript
 * const agent = connect("0x123abc");
 *
 * // Simple usage
 * const response = await agent.input("Search for Python docs");
 * console.log(response.text);  // Agent's response
 * console.log(response.done);  // true if complete
 *
 * // Access UI events for rendering
 * console.log(agent.ui);  // Array of UI events
 * console.log(agent.status);  // 'idle' | 'working' | 'waiting'
 * ```
 */
export class RemoteAgent {
  /** Agent's public address */
  public readonly address: string;

  /** Alias for address (backwards compatibility) */
  public get agentAddress(): string {
    return this.address;
  }

  private _keys?: address.AddressData;
  private _relayUrl: string;
  private _directUrl?: string;
  private _WS: WebSocketCtor;

  /** Current status: 'idle' | 'working' | 'waiting' */
  private _status: AgentStatus = 'idle';

  /** Session state synced from server */
  private _currentSession: SessionState | null = null;

  /** Chat items for rendering */
  private _chatItems: ChatItem[] = [];

  /** Active WebSocket for sending responses (ask_user, approval_needed, onboard) */
  private _activeWs: WebSocketLike | null = null;

  /** Pending prompt for retry after onboard success */
  private _pendingPrompt: string | null = null;

  /** Pending input ID for retry after onboard success */
  private _pendingInputId: string | null = null;

  /** Pending session ID for retry after onboard success */
  private _pendingSessionId: string | null = null;

  /**
   * Fallback counter for UI event IDs.
   * Most events (thinking, tool_call, assistant) use backend-generated UUIDs.
   * Counter is only used for client-only events (user input) that have no backend ID.
   */
  private _uiIdCounter = 0;

  /** Polling configuration */
  private _enablePolling: boolean;
  private _pollIntervalMs: number;
  private _maxPollAttempts: number;

  /** Ping/pong health tracking */
  private _lastPingTime: number = 0;
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(agentAddress: string, options: ConnectOptions = {}) {
    this.address = agentAddress;
    this._relayUrl = normalizeRelayBase(options.relayUrl || 'wss://oo.openonion.ai');
    this._directUrl = options.directUrl?.replace(/\/$/, '');
    this._WS = options.wsCtor || defaultWebSocketCtor();

    // Polling configuration
    this._enablePolling = options.enablePolling !== false; // Default: true
    this._pollIntervalMs = options.pollIntervalMs || 10000; // Default: 10 seconds
    this._maxPollAttempts = options.maxPollAttempts || 30; // Default: 30 attempts (5 minutes)

    // Store keys if provided (lazy-load/generate on first use)
    if (options.keys) {
      this._keys = options.keys;
    }
  }

  // ==========================================================================
  // Public Properties
  // ==========================================================================

  /** Current status: 'idle' | 'working' | 'waiting' */
  get status(): AgentStatus {
    return this._status;
  }

  /** Session state synced from server (read-only) */
  get currentSession(): SessionState | null {
    return this._currentSession;
  }

  /** Chat items for rendering. One type = one component. */
  get ui(): ChatItem[] {
    return this._chatItems;
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /** Clear session and UI state, start fresh */
  reset(): void {
    // Close active WebSocket if any
    if (this._activeWs) {
      try { this._activeWs.close(); } catch { /* ignore */ }
      this._activeWs = null;
    }
    this._currentSession = null;
    this._chatItems = [];
    this._status = 'idle';
    this._uiIdCounter = 0;
  }

  /** Alias for reset (backwards compatibility) */
  resetConversation(): void {
    this.reset();
  }

  /**
   * Send task to remote agent with streaming.
   * Returns Response with text and done flag.
   *
   * @param prompt - User's input
   * @param timeoutMs - Timeout in milliseconds (default: 600000 / 10 minutes)
   * @returns Response with text and done flag
   */
  async input(prompt: string, timeoutMs = 600000): Promise<Response> {
    return this._streamInput(prompt, timeoutMs);
  }

  /**
   * Async version of input (same as input, for API consistency with Python).
   */
  async inputAsync(prompt: string, timeoutMs = 600000): Promise<Response> {
    return this.input(prompt, timeoutMs);
  }

  /**
   * Respond to ask_user event.
   * Only valid when status === 'waiting' after an ask_user event.
   *
   * @param answer - User's answer (string or array for multi-select)
   */
  respond(answer: string | string[]): void {
    if (!this._activeWs) {
      throw new Error('No active connection to respond to');
    }
    const answerStr = Array.isArray(answer) ? answer.join(', ') : answer;
    this._activeWs.send(JSON.stringify({
      type: 'ASK_USER_RESPONSE',
      answer: answerStr,
    }));
  }

  /**
   * Respond to approval_needed event.
   * Only valid when status === 'waiting' after an approval_needed event.
   *
   * @param approved - Whether the tool is approved
   * @param scope - 'once' for single use, 'session' to remember for session
   * @param mode - Rejection mode: 'reject_soft' (skip, agent continues), 'reject_hard' (stop loop), 'reject_explain' (explain to user first)
   * @param feedback - Optional feedback for the agent on why rejected
   */
  respondToApproval(approved: boolean, scope: 'once' | 'session' = 'once', mode?: 'reject_soft' | 'reject_hard' | 'reject_explain', feedback?: string): void {
    if (!this._activeWs) {
      throw new Error('No active connection to respond to');
    }
    this._activeWs.send(JSON.stringify({
      type: 'APPROVAL_RESPONSE',
      approved,
      scope,
      ...(mode && { mode }),
      ...(feedback && { feedback }),
    }));
  }

  /**
   * Submit onboard credentials (invite code or payment).
   * Only valid when status === 'waiting' after an onboard_required event.
   *
   * @param options - Either inviteCode or payment
   */
  submitOnboard(options: { inviteCode?: string; payment?: number }): void {
    if (!this._activeWs) {
      throw new Error('No active connection to submit onboard');
    }

    const payload: Record<string, unknown> = {
      timestamp: Math.floor(Date.now() / 1000),
    };
    if (options.inviteCode) payload.invite_code = options.inviteCode;
    if (options.payment) payload.payment = options.payment;

    const signed = this._signPayload(payload);

    this._activeWs.send(JSON.stringify({
      type: 'ONBOARD_SUBMIT',
      ...signed,
    }));
  }

  // ==========================================================================
  // Private Methods - Streaming
  // ==========================================================================

  /**
   * Ensure keys are loaded or generated (lazy initialization).
   * Only runs once, on first connection attempt.
   */
  private _ensureKeys(): void {
    if (this._keys) return; // Already have keys

    const isBrowser = isBrowserEnv();

    // Try to load existing keys
    const existingKeys = isBrowser ? address.loadBrowser() : address.load();
    if (existingKeys) {
      this._keys = existingKeys;
      return;
    }

    // Generate new keys
    if (isBrowser) {
      this._keys = address.generateBrowser();
      address.saveBrowser(this._keys);
    } else {
      this._keys = address.generate();
    }
  }

  /**
   * Poll for session result when WebSocket fails or times out.
   * Repeatedly checks GET /sessions/{session_id} until result is ready.
   */
  private async _pollForResult(sessionId: string): Promise<string> {
    const baseUrl = this._directUrl || this._relayUrl.replace(/^wss?:\/\//, 'https://');
    const sessionUrl = `${baseUrl}/sessions/${sessionId}`;

    for (let attempt = 0; attempt < this._maxPollAttempts; attempt++) {
      try {
        const response = await fetch(sessionUrl);

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Session not found or expired');
          }
          throw new Error(`Session API error: ${response.status}`);
        }

        const data = await response.json() as { status?: string; result?: string };

        if (data.status === 'done' && data.result) {
          return data.result;
        }

        if (data.status === 'running') {
          await new Promise(resolve => setTimeout(resolve, this._pollIntervalMs));
          continue;
        }

        throw new Error(`Unexpected session status: ${data.status}`);
      } catch (error) {
        if (attempt === this._maxPollAttempts - 1) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, this._pollIntervalMs));
      }
    }

    throw new Error('Polling timeout: Result not ready after maximum attempts');
  }

  /**
   * Save session ID to localStorage (browser only).
   */
  private _saveSessionId(sessionId: string): void {
    if (isBrowserEnv() && typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      try {
        (globalThis as any).localStorage.setItem('connectonion_active_session', sessionId);
      } catch {
        // Ignore localStorage errors
      }
    }
  }

  /**
   * Clear session ID from localStorage (browser only).
   */
  private _clearSessionId(): void {
    if (isBrowserEnv() && typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      try {
        (globalThis as any).localStorage.removeItem('connectonion_active_session');
      } catch {
        // Ignore localStorage errors
      }
    }
  }

  /**
   * Start health check interval to detect dead connections.
   * Checks if PING received within 60 seconds, attempts reconnect if not.
   */
  private _startHealthCheck(
    ws: WebSocketLike,
    sessionId: string,
    resolve: (value: Response) => void,
    reject: (reason?: any) => void
  ): void {
    this._stopHealthCheck(); // Clear any existing interval

    this._healthCheckInterval = setInterval(() => {
      const timeSinceLastPing = Date.now() - this._lastPingTime;

      // If no ping for 60 seconds, connection is likely dead
      if (timeSinceLastPing > 60000) {
        this._stopHealthCheck();
        try { ws.close(); } catch { /* ignore */ }

        // Try polling as fallback
        if (this._enablePolling) {
          this._pollForResult(sessionId)
            .then((result) => {
              this._clearSessionId();
              resolve({ text: result, done: true });
            })
            .catch((pollError) => {
              this._clearSessionId();
              reject(new Error(`Connection health check failed and polling failed: ${pollError}`));
            });
        } else {
          this._clearSessionId();
          reject(new Error('Connection health check failed: No PING received for 60 seconds'));
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop health check interval.
   */
  private _stopHealthCheck(): void {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  /**
   * Stream input to agent with real-time UI events.
   * Uses directUrl if provided, otherwise routes via relay.
   */
  private async _streamInput(prompt: string, timeoutMs: number): Promise<Response> {
    // Lazy-load keys on first use
    this._ensureKeys();

    // Add user event to UI
    this._addChatItem({ type: 'user', content: prompt });

    // Add optimistic thinking (shows immediately, removed when real events arrive)
    this._addChatItem({ type: 'thinking', id: '__optimistic__', status: 'running' });

    // Set status to working
    this._status = 'working';

    const inputId = generateUUID();

    // Generate or reuse session_id for tracking and polling fallback
    const sessionId = this._currentSession?.session_id || generateUUID();
    this._saveSessionId(sessionId);

    // Choose connection mode: direct to agent or via relay
    let wsUrl: string;
    if (this._directUrl) {
      // Direct connection to deployed agent
      const baseUrl = this._directUrl.replace(/^https?:\/\//, '');
      const protocol = this._directUrl.startsWith('https') ? 'wss' : 'ws';
      wsUrl = `${protocol}://${baseUrl}/ws`;
    } else {
      // Via relay
      wsUrl = `${this._relayUrl}/ws/input`;
    }

    const ws = new this._WS(wsUrl);
    this._activeWs = ws;  // Save reference for respond methods

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(async () => {
        if (!settled) {
          settled = true;
          this._status = 'idle';
          try { ws.close(); } catch { /* ignore */ }

          // Try polling fallback if enabled
          if (this._enablePolling) {
            try {
              const result = await this._pollForResult(sessionId);
              this._clearSessionId();
              resolve({ text: result, done: true });
            } catch (pollError) {
              this._clearSessionId();
              reject(new Error(`Connection timed out and polling failed: ${pollError}`));
            }
          } else {
            this._clearSessionId();
              reject(new Error('Connection timed out'));
          }
        }
      }, timeoutMs);

      ws.onopen = () => {
        // Start connection health check
        this._lastPingTime = Date.now();
        this._startHealthCheck(ws, sessionId, resolve, reject);

        const payload: Record<string, unknown> = {
          prompt,
          timestamp: Math.floor(Date.now() / 1000),
        };

        // Only include 'to' when using relay (not needed for direct connection)
        if (!this._directUrl) {
          payload.to = this.address;
        }

        const signed = this._signPayload(payload);

        const inputMessage: Record<string, unknown> = {
          type: 'INPUT',
          input_id: inputId,
          prompt,
          ...signed,
        };

        // Only include 'to' for relay mode
        if (!this._directUrl) {
          inputMessage.to = this.address;
        }

        // Include session if we have one, or create new session with session_id
        if (this._currentSession) {
          inputMessage.session = { ...this._currentSession, session_id: sessionId };
        } else {
          inputMessage.session = { session_id: sessionId };
        }

        try {
          ws.send(JSON.stringify(inputMessage));
        } catch (e) {
          this._stopHealthCheck();
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            this._status = 'idle';
            try { ws.close(); } catch { /* ignore */ }
            reject(e);
          }
        }
      };

      ws.onmessage = (evt: { data: unknown }) => {
        if (settled) return;
        try {
          const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
          const data = JSON.parse(raw);

          // Handle PING (server keep-alive check)
          if (data?.type === 'PING') {
            this._lastPingTime = Date.now();
            // Respond with PONG
            try {
              ws.send(JSON.stringify({ type: 'PONG' }));
            } catch {
              // Ignore send errors
            }
            return;
          }

          // Handle streaming events
          if (data?.type === 'llm_call' || data?.type === 'llm_result' ||
              data?.type === 'tool_call' || data?.type === 'tool_result' ||
              data?.type === 'thinking' || data?.type === 'assistant' ||
              data?.type === 'intent' || data?.type === 'eval' || data?.type === 'compact') {
            this._handleStreamEvent(data);
          }

          // Handle ask_user event (agent needs more input)
          // Keep WebSocket OPEN - user will respond via respond() method
          if (data?.type === 'ask_user') {
            this._status = 'waiting';
            this._addChatItem({ type: 'ask_user', text: data.text || '', options: data.options || [], multi_select: data.multi_select || false });
            // Don't close WS, don't resolve - wait for user response
          }

          // Handle approval_needed event (agent needs permission)
          // Keep WebSocket OPEN - user will respond via respondToApproval() method
          if (data?.type === 'approval_needed') {
            this._status = 'waiting';
            this._addChatItem({
              type: 'approval_needed',
              tool: data.tool as string,
              arguments: data.arguments as Record<string, unknown>,
              ...(data.description && { description: data.description as string }),
              ...(data.batch_remaining && { batch_remaining: data.batch_remaining as Array<{ tool: string; arguments: string }> }),
            });
            // Don't close WS, don't resolve - wait for user response
          }

          // Handle ONBOARD_REQUIRED (stranger needs to verify)
          // Keep WebSocket OPEN - user will submit via submitOnboard() method
          if (data?.type === 'ONBOARD_REQUIRED') {
            this._status = 'waiting';
            this._pendingPrompt = prompt;
            this._pendingInputId = inputId;
            this._pendingSessionId = sessionId;
            this._addChatItem({
              type: 'onboard_required',
              methods: (data.methods || []) as string[],
              paymentAmount: data.payment_amount as number | undefined,
            });
            // Don't close WS, don't resolve - wait for onboard submit
          }

          // Handle ONBOARD_SUCCESS (verification complete)
          // Auto-retry the pending prompt
          if (data?.type === 'ONBOARD_SUCCESS') {
            this._addChatItem({
              type: 'onboard_success',
              level: data.level as string,
              message: data.message as string,
            });

            // Auto-retry the pending prompt
            if (this._pendingPrompt && this._activeWs) {
              this._status = 'working';
              const retryPrompt = this._pendingPrompt;
              const retryInputId = this._pendingInputId || generateUUID();
              this._pendingPrompt = null;
              this._pendingInputId = null;

              const retryPayload: Record<string, unknown> = {
                prompt: retryPrompt,
                timestamp: Math.floor(Date.now() / 1000),
              };
              if (!this._directUrl) {
                retryPayload.to = this.address;
              }

              const retrySigned = this._signPayload(retryPayload);

              const retryMessage: Record<string, unknown> = {
                type: 'INPUT',
                input_id: retryInputId,
                prompt: retryPrompt,
                ...retrySigned,
              };
              if (!this._directUrl) {
                retryMessage.to = this.address;
              }
              if (this._currentSession) {
                retryMessage.session = { ...this._currentSession, session_id: this._pendingSessionId };
              } else {
                retryMessage.session = { session_id: this._pendingSessionId };
              }

              this._activeWs.send(JSON.stringify(retryMessage));
              this._pendingSessionId = null;
            }
          }

          // Handle OUTPUT (final response)
          // Direct mode: accept any OUTPUT (1:1 connection, no routing needed)
          // Relay mode: match input_id for proper routing
          const isOutputForUs = this._directUrl
            ? data?.type === 'OUTPUT'
            : data?.type === 'OUTPUT' && data?.input_id === inputId;
          if (isOutputForUs) {
            settled = true;
            clearTimeout(timer);
            this._stopHealthCheck();
            this._status = 'idle';

            // Sync session from server
            if (data.session) {
              this._currentSession = data.session;
            }

            // Add agent response to UI (skip if already added via 'assistant' event)
            const result = data.result || '';
            if (result) {
              const lastAgent = this._chatItems.filter((e): e is ChatItem & { type: 'agent' } => e.type === 'agent').pop();
              if (!lastAgent || lastAgent.content !== result) {
                this._addChatItem({ type: 'agent', content: result });
              }
            }

            this._activeWs = null;  // Clear before close
            this._clearSessionId();  // Clear session_id on success
              try { ws.close(); } catch { /* ignore */ }
            resolve({ text: result, done: true });
          }

          // Handle ERROR
          if (data?.type === 'ERROR') {
            settled = true;
            clearTimeout(timer);
            this._stopHealthCheck();
            this._status = 'idle';
            this._activeWs = null;  // Clear before close
            this._clearSessionId();  // Clear session_id on error
              try { ws.close(); } catch { /* ignore */ }
            reject(new Error(`Agent error: ${String(data.message || data.error || 'Unknown error')}`));
          }
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          this._stopHealthCheck();
          this._status = 'idle';
          this._clearSessionId();  // Clear session_id on error
          try { ws.close(); } catch { /* ignore */ }
          reject(e);
        }
      };

      ws.onerror = async (err: unknown) => {
        if (settled) return;
        settled = true;
        this._stopHealthCheck();
        this._status = 'idle';
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }

        // Try polling fallback if enabled
        if (this._enablePolling) {
          try {
            const result = await this._pollForResult(sessionId);
            this._clearSessionId();
              resolve({ text: result, done: true });
            return;
          } catch {
            // Polling failed, fall through to original error
          }
        }

        this._clearSessionId();
        reject(new Error(`WebSocket error: ${String(err)}`));
      };

      ws.onclose = async () => {
        this._activeWs = null;  // Clear reference on close
        this._stopHealthCheck();
        if (!settled) {
          settled = true;
          this._status = 'idle';
          clearTimeout(timer);

          // Try polling fallback if enabled
          if (this._enablePolling) {
            try {
              const result = await this._pollForResult(sessionId);
              this._clearSessionId();
              resolve({ text: result, done: true });
              return;
            } catch {
              // Polling failed, fall through to original error
            }
          }

          this._clearSessionId();
          reject(new Error('Connection closed before response'));
        }
      };
    });
  }

  /**
   * Remove the optimistic thinking item (added for instant feedback).
   */
  private _removeOptimisticThinking(): void {
    const idx = this._chatItems.findIndex(item => item.id === '__optimistic__');
    if (idx !== -1) {
      this._chatItems.splice(idx, 1);
    }
  }

  /**
   * Handle streaming event and update UI.
   * Merges tool_result into existing tool_call.
   */
  private _handleStreamEvent(event: Record<string, unknown>): void {
    const eventType = event.type as string;

    // Remove optimistic thinking when first real event arrives
    this._removeOptimisticThinking();

    switch (eventType) {
      case 'tool_call': {
        // Add tool call with running status
        // Use tool_id from backend for matching tool_call with tool_result
        const toolId = (event.tool_id || event.id) as string;
        this._addChatItem({
          type: 'tool_call',
          id: toolId,
          name: event.name as string,
          args: event.args as Record<string, unknown>,
          status: 'running',
        });
        break;
      }

      case 'tool_result': {
        // Find existing tool_call and update it (merge)
        const toolId = (event.tool_id || event.id) as string;
        const existing = this._chatItems.find(
          (e): e is ChatItem & { type: 'tool_call' } => e.type === 'tool_call' && e.id === toolId
        );

        if (existing) {
          // Update existing tool_call with result
          existing.status = event.status === 'error' ? 'error' : 'done';
          existing.result = event.result as string;
          if (typeof event.timing_ms === 'number') {
            existing.timing_ms = event.timing_ms;
          }
        }
        break;
      }

      case 'llm_call': {
        // LLM started thinking - add thinking UI with running status
        const llmId = event.id as string;
        this._addChatItem({
          type: 'thinking',
          id: llmId,
          status: 'running',
          model: event.model as string | undefined,
        });
        break;
      }

      case 'llm_result': {
        // LLM finished - update thinking status with full info
        const llmId = event.id as string;
        const existingThinking = this._chatItems.find(
          (e): e is ChatItem & { type: 'thinking' } => e.type === 'thinking' && e.id === llmId
        );
        if (existingThinking) {
          existingThinking.status = event.status === 'error' ? 'error' : 'done';
          if (typeof event.duration_ms === 'number') {
            existingThinking.duration_ms = event.duration_ms;
          }
          if (event.model) {
            existingThinking.model = event.model as string;
          }
          if (event.usage) {
            existingThinking.usage = event.usage as {
              input_tokens?: number;
              output_tokens?: number;
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              cost?: number;
            };
          }
          if (typeof event.context_percent === 'number') {
            existingThinking.context_percent = event.context_percent;
          }
        }
        break;
      }

      case 'thinking': {
        // Backwards compatibility for old thinking events
        this._addChatItem({
          type: 'thinking',
          id: event.id != null ? String(event.id) : undefined,
          status: 'done',  // Old events don't have status, treat as done
          content: event.content as string | undefined,
          kind: event.kind as string | undefined,
        });
        break;
      }

      case 'assistant': {
        // Intermediate assistant message (not final)
        if (event.content) {
          this._addChatItem({
            type: 'agent',
            id: event.id != null ? String(event.id) : undefined,  // Use backend's ID
            content: event.content as string,
          });
        }
        break;
      }

      case 'intent': {
        // Intent analysis from system_reminder plugin
        const intentId = event.id as string;
        const status = event.status as 'analyzing' | 'understood';

        if (status === 'analyzing') {
          // Show "analyzing intent" UI
          this._addChatItem({
            type: 'intent',
            id: intentId,
            status: 'analyzing',
          });
        } else if (status === 'understood') {
          // Update existing intent item with acknowledgment
          const existing = this._chatItems.find(
            (e): e is ChatItem & { type: 'intent' } => e.type === 'intent' && e.id === intentId
          );
          if (existing) {
            existing.status = 'understood';
            existing.ack = event.ack as string | undefined;
            existing.is_build = event.is_build as boolean | undefined;
          }
        }
        break;
      }

      case 'eval': {
        // Evaluation from eval plugin (structured: passed + summary)
        const evalId = event.id as string;
        const status = event.status as 'evaluating' | 'done';

        if (status === 'evaluating') {
          // Show "evaluating" UI
          this._addChatItem({
            type: 'eval',
            id: evalId,
            status: 'evaluating',
            expected: event.expected as string | undefined,
            eval_path: event.eval_path as string | undefined,
          });
        } else if (status === 'done') {
          // Update existing eval item with structured results
          const existing = this._chatItems.find(
            (e): e is ChatItem & { type: 'eval' } => e.type === 'eval' && e.id === evalId
          );
          if (existing) {
            existing.status = 'done';
            existing.passed = event.passed as boolean | undefined;
            existing.summary = event.summary as string | undefined;
            existing.expected = event.expected as string | undefined;
            existing.eval_path = event.eval_path as string | undefined;
          }
        }
        break;
      }

      case 'compact': {
        // Auto-compact from auto_compact plugin
        const compactId = event.id as string;
        const status = event.status as 'compacting' | 'done' | 'error';

        if (status === 'compacting') {
          this._addChatItem({
            type: 'compact',
            id: compactId,
            status: 'compacting',
            context_percent: event.context_percent as number | undefined,
          });
        } else {
          // Update existing compact item
          const existing = this._chatItems.find(
            (e): e is ChatItem & { type: 'compact' } => e.type === 'compact' && e.id === compactId
          );
          if (existing) {
            existing.status = status;
            existing.context_before = event.context_before as number | undefined;
            existing.context_after = event.context_after as number | undefined;
            existing.message = event.message as string | undefined;
            existing.error = event.error as string | undefined;
          }
        }
        break;
      }
    }
  }

  /**
   * Add chat item with ID for React keys.
   * Backend events (thinking, tool_call, assistant) include UUID in event.id.
   * Client-only events (user input) use fallback counter.
   */
  private _addChatItem(event: Partial<ChatItem> & { type: ChatItemType }): void {
    const id = (event as { id?: string }).id || String(++this._uiIdCounter);
    this._chatItems.push({ ...event, id } as ChatItem);
  }

  // ==========================================================================
  // Private Methods - Signing
  // ==========================================================================

  /** Sign a payload if keys are available */
  private _signPayload(payload: Record<string, unknown>): Record<string, unknown> {
    if (!this._keys) {
      return { prompt: payload.prompt };
    }
    const canonicalMessage = canonicalJSON(payload);
    const signer = isBrowserEnv() ? address.signBrowser : address.sign;
    const signature = signer(this._keys, canonicalMessage);
    return {
      payload,
      from: this._keys.address,
      signature,
      timestamp: payload.timestamp,
    };
  }

  // ==========================================================================
  // String Representation
  // ==========================================================================

  toString(): string {
    const short = this.address.length > 12 ? this.address.slice(0, 12) + '...' : this.address;
    return `RemoteAgent(${short})`;
  }
}

/**
 * Connect to a remote agent.
 *
 * Two connection modes:
 * 1. Via relay (default): Uses agent address, routes through relay server
 * 2. Direct: Uses directUrl option, connects directly to deployed agent
 *
 * @param agentAddress Agent public key (0x...) - used for relay routing and signing
 * @param options Connection options
 *
 * @example
 * ```typescript
 * // Via relay (default) - uses agent address
 * const agent = connect("0x3d4017c3...");
 * const response = await agent.input("Hello");
 *
 * // Direct to deployed agent (bypasses relay)
 * const agent = connect("agent-name", {
 *   directUrl: "https://my-agent.agents.openonion.ai"
 * });
 * const response = await agent.input("Hello");
 *
 * // Access UI events for rendering
 * console.log(agent.ui);       // Array of UI events
 * console.log(agent.status);   // 'idle' | 'working' | 'waiting'
 *
 * // Multi-turn conversation
 * const r1 = await agent.input("Book a flight to NYC");
 * if (!r1.done) {
 *   // Agent asked a question
 *   const r2 = await agent.input("Tomorrow at 10am");
 * }
 *
 * // With signing (for strict trust agents)
 * import { address } from 'connectonion';
 * const keys = address.load('.co');
 * const agent = connect("0x3d4017c3...", { keys });
 * ```
 */
export function connect(
  agentAddress: string,
  options: ConnectOptions = {}
): RemoteAgent {
  return new RemoteAgent(agentAddress, options);
}
