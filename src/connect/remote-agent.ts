/**
 * @llm-note
 *   Dependencies: imports from [src/connect/types, src/connect/endpoint, src/connect/auth, src/connect/chat-item-mapper, src/address]
 *   Data flow: ensureConnected() opens persistent WS + INIT auth → input() sends INPUT on existing WS → handleMessage() dispatches events → resolves on OUTPUT
 *   State/Effects: owns persistent WebSocket + mutable _chatItems + _currentSession
 *   Integration: public API consumed by connect() factory and React useAgentForHuman hook
 */
import * as address from '../address';
import {
  AgentStatus, ApprovalMode, ChatItem, ChatItemType, ConnectionState,
  ConnectOptions, ResolvedEndpoint, Response, SessionState, WebSocketCtor, WebSocketLike,
} from './types';
import { getWebSocketCtor, generateUUID, normalizeRelayUrl, resolveEndpoint } from './endpoint';
import { ensureKeys, signPayload } from './auth';
import { mapEventToChatItem } from './chat-item-mapper';

export class RemoteAgent {
  readonly address: string;

  _keys?: address.AddressData;
  _relayUrl: string;
  _directUrl?: string;
  _resolvedEndpoint?: ResolvedEndpoint;
  _endpointResolutionAttempted = false;
  _WS: WebSocketCtor;

  // Public reactive state
  _status: AgentStatus = 'idle';
  _connectionState: ConnectionState = 'disconnected';
  _currentSession: SessionState | null = null;
  _chatItems: ChatItem[] = [];
  _error: Error | null = null;

  // Persistent WebSocket
  private _ws: WebSocketLike | null = null;
  private _authenticated = false;

  // Promise resolution for current input() call
  private _inputResolve: ((value: Response) => void) | null = null;
  private _inputReject: ((reason?: unknown) => void) | null = null;
  private _inputTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending retry after onboard
  private _pendingRetry: { prompt: string; inputId: string; images?: string[] } | null = null;

  // PING/PONG health check
  private _lastPingTime = 0;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;

  // Callback + promise for ensureConnected
  private _connectResolve: ((data: Record<string, unknown>) => void) | null = null;
  private _connectReject: ((reason?: unknown) => void) | null = null;

  _onMessage: (() => void) | null = null;
  set onMessage(fn: (() => void) | null) { this._onMessage = fn; }

  constructor(agentAddress: string, options: ConnectOptions = {}) {
    this.address = agentAddress;
    this._relayUrl = normalizeRelayUrl(options.relayUrl || 'wss://oo.openonion.ai');
    this._directUrl = options.directUrl?.replace(/\/$/, '');
    this._WS = options.wsCtor || getWebSocketCtor();
    if (options.keys) this._keys = options.keys;
  }

  // --- Public getters ---

  get agentAddress(): string { return this.address; }
  get status(): AgentStatus { return this._status; }
  get connectionState(): ConnectionState { return this._connectionState; }
  get currentSession(): SessionState | null { return this._currentSession; }
  get ui(): ChatItem[] { return this._chatItems; }
  get mode(): ApprovalMode { return this._currentSession?.mode || 'safe'; }
  get error(): Error | null { return this._error || null; }

  // --- Public API ---

  async input(prompt: string, options?: { images?: string[]; files?: import('./types').FileAttachment[]; timeoutMs?: number }): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? 600000;

    this._addChatItem({ type: 'user', content: prompt, images: options?.images, files: options?.files });
    this._addChatItem({ type: 'thinking', id: '__optimistic__', status: 'running' });
    this._status = 'working';
    this._onMessage?.();

    await this._ensureConnected();

    const inputId = generateUUID();
    const isDirect = this._isDirect();

    const msg: Record<string, unknown> = { type: 'INPUT', input_id: inputId, prompt };
    if (options?.images?.length) msg.images = options.images;
    if (options?.files?.length) msg.files = options.files.map(f => ({ name: f.name, data: f.dataUrl }));
    if (!isDirect) msg.to = this.address;

    this._ws!.send(JSON.stringify(msg));

    return new Promise<Response>((resolve, reject) => {
      this._inputResolve = resolve;
      this._inputReject = reject;
      this._inputTimer = setTimeout(() => {
        this._settleInput();
        this._status = 'idle';
        this._onMessage?.();
        reject(new Error('Request timed out'));
      }, timeoutMs);
    });
  }

  async reconnect(sessionId?: string): Promise<Response> {
    const sid = sessionId || this._currentSession?.session_id;
    if (!sid) throw new Error('No session to reconnect');

    if (!this._currentSession) this._currentSession = { session_id: sid };
    this._status = 'working';
    this._onMessage?.();

    // Force new connection for reconnect
    this._closeWs();

    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();

    const { wsUrl, isDirect } = this._resolveWsUrl();
    const ws = new this._WS(wsUrl);
    this._ws = ws;
    this._connectionState = 'reconnecting';
    this._onMessage?.();

    return new Promise<Response>((resolve, reject) => {
      this._inputResolve = resolve;
      this._inputReject = reject;
      this._inputTimer = setTimeout(() => {
        this._settleInput();
        this._status = 'idle';
        this._connectionState = 'disconnected';
        this._onMessage?.();
        reject(new Error('Reconnect timed out'));
      }, 60000);

      ws.onopen = () => {
        this._connectionState = 'connected';
        this._lastPingTime = Date.now();
        this._startPingMonitor();

        // Send CONNECT with session_id + session data
        const payload: Record<string, unknown> = { timestamp: Math.floor(Date.now() / 1000) };
        payload.to = this.address;
        const signed = signPayload(this._keys, payload);
        const msg: Record<string, unknown> = { type: 'CONNECT', session_id: sid, ...signed };
        if (!isDirect) msg.to = this.address;
        if (this._currentSession) msg.session = { ...this._currentSession };
        ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (evt: { data: unknown }) => this._handleMessage(evt);
      ws.onerror = () => this._handleConnectionLoss();
      ws.onclose = () => this._handleConnectionLoss();
    });
  }

  send(message: Record<string, unknown>): void {
    if (!this._ws) throw new Error('No active connection');
    this._ws.send(JSON.stringify(message));
  }

  setMode(mode: ApprovalMode, options?: { turns?: number }): void {
    if (!this._currentSession) {
      this._currentSession = { mode };
    } else {
      this._currentSession.mode = mode;
    }
    if (mode === 'ulw') {
      this._currentSession.ulw_turns = options?.turns || 100;
      this._currentSession.ulw_turns_used = 0;
    }
    if (this._ws) {
      const msg: Record<string, unknown> = { type: 'mode_change', mode };
      if (mode === 'ulw' && options?.turns) msg.turns = options.turns;
      this._ws.send(JSON.stringify(msg));
    }
  }

  reset(): void {
    this._closeWs();
    this._currentSession = null;
    this._chatItems = [];
    this._status = 'idle';
    this._connectionState = 'disconnected';
    this._error = null;
    this._settleInput();
    this._pendingRetry = null;
  }

  resetConversation(): void { this.reset(); }

  signOnboard(options: { inviteCode?: string; payment?: number }): Record<string, unknown> {
    const payload: Record<string, unknown> = { timestamp: Math.floor(Date.now() / 1000) };
    if (options.inviteCode) payload.invite_code = options.inviteCode;
    if (options.payment) payload.payment = options.payment;
    return { type: 'ONBOARD_SUBMIT', ...signPayload(this._keys, payload) };
  }

  async checkSessionStatus(sessionId: string): Promise<'executing' | 'suspended' | 'connected' | 'not_found'> {
    // If we have a live WS, send SESSION_STATUS over it (no new connection needed)
    if (this._ws && this._authenticated) {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('not_found'), 5000);
        // Temporarily intercept the next SESSION_STATUS response
        const origHandler = this._ws!.onmessage;
        this._ws!.onmessage = (evt: { data: unknown }) => {
          const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
          const data = JSON.parse(raw);
          if (data?.type === 'SESSION_STATUS') {
            clearTimeout(timeout);
            this._ws!.onmessage = origHandler;
            resolve(data.status || 'not_found');
          } else {
            // Not our response — pass to normal handler
            this._handleMessage(evt);
          }
        };
        this._ws!.send(JSON.stringify({
          type: 'SESSION_STATUS',
          session: { session_id: sessionId },
        }));
      });
    }

    // No active connection — open a short-lived WS just for the check
    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();
    const { wsUrl, isDirect } = this._resolveWsUrl();

    return new Promise((resolve) => {
      const ws = new this._WS(wsUrl);
      const timeout = setTimeout(() => { ws.close(); resolve('not_found'); }, 5000);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'SESSION_STATUS',
          session: { session_id: sessionId },
          ...(!isDirect && { to: this.address }),
        }));
      };
      ws.onmessage = (evt: { data: unknown }) => {
        const data = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
        if (data?.type === 'SESSION_STATUS') {
          clearTimeout(timeout);
          ws.close();
          resolve(data.status || 'not_found');
        }
      };
      ws.onerror = () => { clearTimeout(timeout); ws.close(); resolve('not_found'); };
    });
  }

  async checkSession(sessionId?: string): Promise<'running' | 'done' | 'not_found'> {
    const sid = sessionId || this._currentSession?.session_id;
    if (!sid) return 'not_found';
    await this._resolveEndpointOnce();
    const httpUrl = this._directUrl || this._resolvedEndpoint?.httpUrl;
    if (!httpUrl) return 'not_found';
    const res = await fetch(`${httpUrl}/sessions/${sid}`).catch(() => null);
    if (!res || !res.ok) return 'not_found';
    const data = await res.json().catch(() => null) as { status?: string } | null;
    return data?.status === 'running' ? 'running' : 'done';
  }

  toString(): string {
    const short = this.address.length > 12 ? this.address.slice(0, 12) + '...' : this.address;
    return `RemoteAgent(${short})`;
  }

  // --- Internal helpers (used by useAgentForHuman) ---

  _addChatItem(event: Partial<ChatItem> & { type: ChatItemType }): void {
    const id = (event as { id?: string }).id || generateUUID();
    this._chatItems.push({ ...event, id } as ChatItem);
  }

  _clearPlaceholder(): void {
    const idx = this._chatItems.findIndex(item => item.id === '__optimistic__');
    if (idx !== -1) this._chatItems.splice(idx, 1);
  }

  // --- Private: connection lifecycle ---

  private async _ensureConnected(): Promise<void> {
    if (this._ws && this._authenticated) return;

    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();

    const { wsUrl, isDirect } = this._resolveWsUrl();
    const ws = new this._WS(wsUrl);
    this._ws = ws;

    // Wait for open
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this._connectionState = 'connected';
        this._lastPingTime = Date.now();
        this._startPingMonitor();
        resolve();
      };
      ws.onerror = (err) => reject(new Error(`WebSocket connection failed: ${String(err)}`));
    });

    // Wire up persistent message handler
    ws.onmessage = (evt: { data: unknown }) => this._handleMessage(evt);
    ws.onerror = () => this._handleConnectionLoss();
    ws.onclose = () => this._handleConnectionLoss();

    // Send CONNECT with session (conversation history)
    const payload: Record<string, unknown> = { timestamp: Math.floor(Date.now() / 1000) };
    payload.to = this.address;
    const signed = signPayload(this._keys, payload);
    const connectMsg: Record<string, unknown> = { type: 'CONNECT', ...signed };
    if (!isDirect) connectMsg.to = this.address;
    if (this._currentSession?.session_id) connectMsg.session_id = this._currentSession.session_id;
    if (this._currentSession) connectMsg.session = { ...this._currentSession };
    ws.send(JSON.stringify(connectMsg));

    // Wait for CONNECTED response
    const connected = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      setTimeout(() => {
        if (this._connectResolve) {
          this._connectResolve = null;
          this._connectReject = null;
          reject(new Error('Authentication timed out'));
        }
      }, 30000);
    });

    this._authenticated = true;

    // Update session from server (may include merged data)
    const sid = connected.session_id as string;
    if (sid) {
      if (!this._currentSession) {
        this._currentSession = { session_id: sid };
      } else {
        this._currentSession.session_id = sid;
      }
    }
    if (connected.server_newer && connected.session) {
      this._currentSession = connected.session as SessionState;
    }
    if (connected.server_newer && connected.chat_items && Array.isArray(connected.chat_items)) {
      const userItems = this._chatItems.filter(item => item.type === 'user');
      const serverNonUserItems = (connected.chat_items as ChatItem[]).filter(item => item.type !== 'user');
      this._chatItems = [...userItems, ...serverNonUserItems];
      this._onMessage?.();
    }
  }

  private _handleMessage(evt: { data: unknown }): void {
    const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
    const data = JSON.parse(raw);

    // PING/PONG keepalive
    if (data?.type === 'PING') {
      this._lastPingTime = Date.now();
      this._ws?.send(JSON.stringify({ type: 'PONG' }));
      return;
    }

    // CONNECTED — resolve ensureConnected() promise
    if (data?.type === 'CONNECTED') {
      if (this._connectResolve) {
        const resolve = this._connectResolve;
        this._connectResolve = null;
        this._connectReject = null;
        resolve(data);
        this._onMessage?.();
        return;
      }

      // CONNECTED during reconnect — update session and UI if server has newer data
      if (data.server_newer && data.session) {
        this._currentSession = data.session as SessionState;
      }
      if (data.server_newer && data.chat_items && Array.isArray(data.chat_items)) {
        // Server has newer chat items (e.g., agent finished while client was away)
        // Keep user items from client, take everything else from server
        const userItems = this._chatItems.filter(item => item.type === 'user');
        const serverNonUserItems = (data.chat_items as ChatItem[]).filter(item => item.type !== 'user');
        this._chatItems = [...userItems, ...serverNonUserItems];
      }
      const reconnectSid = data.session_id as string;
      if (reconnectSid && this._currentSession) {
        this._currentSession.session_id = reconnectSid;
      }
      this._authenticated = true;
      // If status is "connected" (idle), resolve immediately — session is alive, no events to wait for
      if ((data.status as string) === 'connected' || (data.status as string) === 'new') {
        this._status = 'idle';
        const resolve = this._inputResolve;
        this._settleInput();
        resolve?.({ text: '', done: true });
      }
      // If status is "executing", events will stream in via _handleMessage — don't resolve yet
      this._onMessage?.();
      return;
    }

    // Session sync
    if (data?.type === 'session_sync' && data.session) {
      this._currentSession = data.session;
    }

    if (data?.type === 'RECONNECTED') {
      // Server confirmed reconnect — events will follow
    }

    if (data?.type === 'SESSION_MERGED' && data.server_newer) {
      // Server had newer session
    }

    if (data?.type === 'mode_changed' && data.mode) {
      if (!this._currentSession) {
        this._currentSession = { mode: data.mode };
      } else {
        this._currentSession.mode = data.mode;
      }
    }

    // ULW turns reached
    if (data?.type === 'ulw_turns_reached') {
      this._status = 'waiting';
      if (this._currentSession) {
        this._currentSession.ulw_turns_used = data.turns_used;
      }
      this._addChatItem({
        type: 'ulw_turns_reached',
        turns_used: data.turns_used as number,
        max_turns: data.max_turns as number,
      });
    }

    // Stream events → ChatItem mapping
    if (data?.type === 'llm_call' || data?.type === 'llm_result' ||
        data?.type === 'tool_call' || data?.type === 'tool_result' ||
        data?.type === 'thinking' || data?.type === 'assistant' ||
        data?.type === 'intent' || data?.type === 'eval' || data?.type === 'compact' ||
        data?.type === 'tool_blocked') {
      this._clearPlaceholder();
      mapEventToChatItem(this._chatItems, data, (item) => this._addChatItem(item));
      if (data.session) {
        this._currentSession = data.session;
      }
    }

    // Interactive events
    if (data?.type === 'ask_user') {
      this._status = 'waiting';
      this._addChatItem({ type: 'ask_user', text: data.text || '', options: data.options || [], multi_select: data.multi_select || false });
    }

    if (data?.type === 'approval_needed') {
      this._status = 'waiting';
      this._addChatItem({
        type: 'approval_needed',
        tool: data.tool as string,
        arguments: data.arguments as Record<string, unknown>,
        ...(data.description && { description: data.description as string }),
        ...(data.batch_remaining && { batch_remaining: data.batch_remaining as Array<{ tool: string; arguments: string }> }),
      });
    }

    if (data?.type === 'plan_review') {
      this._status = 'waiting';
      this._addChatItem({ type: 'plan_review', plan_content: data.plan_content as string });
    }

    // Onboard flow
    if (data?.type === 'ONBOARD_REQUIRED') {
      this._status = 'waiting';
      this._pendingRetry = { prompt: data.prompt || '', inputId: generateUUID() };
      this._addChatItem({
        type: 'onboard_required',
        methods: (data.methods || []) as string[],
        paymentAmount: data.payment_amount as number | undefined,
      });
    }

    if (data?.type === 'ONBOARD_SUCCESS') {
      this._addChatItem({
        type: 'onboard_success',
        level: data.level as string,
        message: data.message as string,
      });

      if (this._pendingRetry && this._ws) {
        this._status = 'working';
        const retry = this._pendingRetry;
        this._pendingRetry = null;
        const isDirect = this._isDirect();
        const msg: Record<string, unknown> = { type: 'INPUT', input_id: retry.inputId, prompt: retry.prompt };
        if (!isDirect) msg.to = this.address;
        this._ws.send(JSON.stringify(msg));
      }
    }

    // OUTPUT — resolve input() promise
    if (data?.type === 'OUTPUT') {
      this._clearPlaceholder();
      this._status = 'idle';

      if (data.session) {
        this._currentSession = data.session;
      }

      if (data.server_newer && data.chat_items && Array.isArray(data.chat_items)) {
        const userItems = this._chatItems.filter(item => item.type === 'user');
        const serverNonUserItems = (data.chat_items as ChatItem[]).filter(item => item.type !== 'user');
        this._chatItems = [...userItems, ...serverNonUserItems];
      }

      const result = data.result || '';
      if (result) {
        const lastAgent = this._chatItems.filter((e): e is ChatItem & { type: 'agent' } => e.type === 'agent').pop();
        if (!lastAgent || lastAgent.content !== result) {
          this._addChatItem({ type: 'agent', content: result });
        }
      }

      // Don't close WS — keep it for next input()
      const resolve = this._inputResolve;
      this._settleInput();
      resolve?.({ text: result, done: true });
    }

    // ERROR — reject input() promise
    if (data?.type === 'ERROR') {
      this._status = 'idle';
      this._connectionState = 'disconnected';
      this._closeWs();
      const reject = this._inputReject;
      this._settleInput();
      reject?.(new Error(`Agent error: ${String(data.message || data.error || 'Unknown error')}`));
    }

    this._onMessage?.();
  }

  private _handleConnectionLoss(): void {
    this._ws = null;
    this._authenticated = false;
    this._stopPingMonitor();

    // Reject pending connect
    if (this._connectReject) {
      const reject = this._connectReject;
      this._connectResolve = null;
      this._connectReject = null;
      reject(new Error('Connection lost during authentication'));
      return;
    }

    // Reject pending input only if there is one
    if (this._inputReject) {
      this._status = 'idle';
      this._connectionState = 'disconnected';
      const reject = this._inputReject;
      this._settleInput();
      reject(new Error('Connection closed before response'));
      this._onMessage?.();
    }
  }

  private _settleInput(): void {
    if (this._inputTimer) { clearTimeout(this._inputTimer); this._inputTimer = null; }
    this._inputResolve = null;
    this._inputReject = null;
  }

  private _closeWs(): void {
    this._stopPingMonitor();
    if (this._ws) {
      // Prevent close handler from firing during intentional close
      this._ws.onerror = null;
      this._ws.onclose = null;
      this._ws.onmessage = null;
      this._ws.close();
      this._ws = null;
    }
    this._authenticated = false;
    this._connectionState = 'disconnected';
  }

  private _startPingMonitor(): void {
    this._stopPingMonitor();
    this._pingTimer = setInterval(() => {
      if (Date.now() - this._lastPingTime > 60000) {
        this._stopPingMonitor();
        this._ws?.close();
      }
    }, 10000);
  }

  private _stopPingMonitor(): void {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  private _isDirect(): boolean {
    return !!this._directUrl || !!this._resolvedEndpoint;
  }

  private _resolveWsUrl(): { wsUrl: string; isDirect: boolean } {
    if (this._directUrl) {
      const base = this._directUrl.replace(/^https?:\/\//, '');
      const protocol = this._directUrl.startsWith('https') ? 'wss' : 'ws';
      return { wsUrl: `${protocol}://${base}/ws`, isDirect: true };
    }
    if (this._resolvedEndpoint) return { wsUrl: this._resolvedEndpoint.wsUrl, isDirect: true };
    return { wsUrl: `${this._relayUrl}/ws/input`, isDirect: false };
  }

  private async _resolveEndpointOnce(): Promise<void> {
    if (this._endpointResolutionAttempted || this._directUrl) return;
    this._endpointResolutionAttempted = true;
    if (!this.address.startsWith('0x') || this.address.length !== 66) return;
    const resolved = await resolveEndpoint(this.address, this._relayUrl);
    if (resolved) this._resolvedEndpoint = resolved;
  }
}
