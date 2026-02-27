import * as address from '../address';
import {
  AgentStatus,
  ApprovalMode,
  ChatItem,
  ChatItemType,
  ConnectOptions,
  ResolvedEndpoint,
  Response,
  SessionState,
  WebSocketCtor,
  WebSocketLike,
} from './types';
import {
  canonicalJSON,
  defaultWebSocketCtor,
  generateUUID,
  isBrowserEnv,
  normalizeRelayBase,
  resolveEndpoint,
} from './endpoint';

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
 * console.log(agent.ui);      // Array of UI events
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
  private _resolvedEndpoint?: ResolvedEndpoint;
  private _endpointResolved = false;
  private _WS: WebSocketCtor;

  private _status: AgentStatus = 'idle';
  private _currentSession: SessionState | null = null;
  private _chatItems: ChatItem[] = [];
  private _activeWs: WebSocketLike | null = null;
  private _pendingPrompt: string | null = null;
  private _pendingInputId: string | null = null;
  private _pendingSessionId: string | null = null;

  /**
   * Fallback counter for UI event IDs.
   * Most events use backend-generated UUIDs; counter is only for client-only events.
   */
  private _uiIdCounter = 0;

  private _enablePolling: boolean;
  private _pollIntervalMs: number;
  private _maxPollAttempts: number;

  private _lastPingTime: number = 0;
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(agentAddress: string, options: ConnectOptions = {}) {
    this.address = agentAddress;
    this._relayUrl = normalizeRelayBase(options.relayUrl || 'wss://oo.openonion.ai');
    this._directUrl = options.directUrl?.replace(/\/$/, '');
    this._WS = options.wsCtor || defaultWebSocketCtor();

    this._enablePolling = options.enablePolling !== false;
    this._pollIntervalMs = options.pollIntervalMs || 10000;
    this._maxPollAttempts = options.maxPollAttempts || 30;

    if (options.keys) {
      this._keys = options.keys;
    }
  }

  // ==========================================================================
  // Public Properties
  // ==========================================================================

  get status(): AgentStatus {
    return this._status;
  }

  get currentSession(): SessionState | null {
    return this._currentSession;
  }

  get ui(): ChatItem[] {
    return this._chatItems;
  }

  get mode(): ApprovalMode {
    return this._currentSession?.mode || 'safe';
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

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

    if (this._activeWs) {
      const msg: Record<string, unknown> = { type: 'mode_change', mode };
      if (mode === 'ulw' && options?.turns) {
        msg.turns = options.turns;
      }
      this._activeWs.send(JSON.stringify(msg));
    }
  }

  setPrompt(prompt: string): void {
    if (this._activeWs) {
      this._activeWs.send(JSON.stringify({ type: 'prompt_update', prompt }));
    }
  }

  reset(): void {
    if (this._activeWs) {
      try { this._activeWs.close(); } catch { /* ignore */ }
      this._activeWs = null;
    }
    this._currentSession = null;
    this._chatItems = [];
    this._status = 'idle';
    this._uiIdCounter = 0;
  }

  resetConversation(): void {
    this.reset();
  }

  async input(prompt: string, options?: { images?: string[]; timeoutMs?: number }): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? 600000;
    const images = options?.images;
    return this._streamInput(prompt, timeoutMs, images);
  }

  async inputAsync(prompt: string, options?: { images?: string[]; timeoutMs?: number }): Promise<Response> {
    return this.input(prompt, options);
  }

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

  respondToUlwTurnsReached(action: 'continue' | 'switch_mode', options?: { turns?: number; mode?: ApprovalMode }): void {
    if (!this._activeWs) {
      throw new Error('No active connection to respond to ULW');
    }
    this._activeWs.send(JSON.stringify({
      type: 'ULW_RESPONSE',
      action,
      ...(action === 'continue' && options?.turns && { turns: options.turns }),
      ...(action === 'switch_mode' && options?.mode && { mode: options.mode }),
    }));
  }

  // ==========================================================================
  // Private Methods - Streaming
  // ==========================================================================

  private _ensureKeys(): void {
    if (this._keys) return;

    const isBrowser = isBrowserEnv();
    const existingKeys = isBrowser ? address.loadBrowser() : address.load();
    if (existingKeys) {
      this._keys = existingKeys;
      return;
    }

    if (isBrowser) {
      this._keys = address.generateBrowser();
      address.saveBrowser(this._keys);
    } else {
      this._keys = address.generate();
    }
  }

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

  private _startHealthCheck(
    ws: WebSocketLike,
    sessionId: string,
    resolve: (value: Response) => void,
    reject: (reason?: any) => void
  ): void {
    this._stopHealthCheck();

    this._healthCheckInterval = setInterval(() => {
      const timeSinceLastPing = Date.now() - this._lastPingTime;

      if (timeSinceLastPing > 60000) {
        this._stopHealthCheck();
        try { ws.close(); } catch { /* ignore */ }

        if (this._enablePolling) {
          this._pollForResult(sessionId)
            .then((result) => {
              resolve({ text: result, done: true });
            })
            .catch((pollError) => {
              reject(new Error(`Connection health check failed and polling failed: ${pollError}`));
            });
        } else {
          reject(new Error('Connection health check failed: No PING received for 60 seconds'));
        }
      }
    }, 10000);
  }

  private _stopHealthCheck(): void {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  private async _tryResolveEndpoint(): Promise<void> {
    if (this._endpointResolved || this._directUrl) return;

    this._endpointResolved = true;

    if (!this.address.startsWith('0x') || this.address.length !== 66) return;

    const resolved = await resolveEndpoint(this.address, this._relayUrl);
    if (resolved) {
      this._resolvedEndpoint = resolved;
    }
  }

  private async _streamInput(prompt: string, timeoutMs: number, images?: string[]): Promise<Response> {
    this._ensureKeys();
    await this._tryResolveEndpoint();

    this._addChatItem({ type: 'user', content: prompt, images });
    this._addChatItem({ type: 'thinking', id: '__optimistic__', status: 'running' });
    this._status = 'working';

    const inputId = generateUUID();
    const sessionId = this._currentSession?.session_id || generateUUID();

    let wsUrl: string;
    let isDirect = false;
    if (this._directUrl) {
      const baseUrl = this._directUrl.replace(/^https?:\/\//, '');
      const protocol = this._directUrl.startsWith('https') ? 'wss' : 'ws';
      wsUrl = `${protocol}://${baseUrl}/ws`;
      isDirect = true;
    } else if (this._resolvedEndpoint) {
      wsUrl = this._resolvedEndpoint.wsUrl;
      isDirect = true;
    } else {
      wsUrl = `${this._relayUrl}/ws/input`;
    }

    const ws = new this._WS(wsUrl);
    this._activeWs = ws;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(async () => {
        if (!settled) {
          settled = true;
          this._status = 'idle';
          try { ws.close(); } catch { /* ignore */ }

          if (this._enablePolling) {
            try {
              const result = await this._pollForResult(sessionId);
              resolve({ text: result, done: true });
            } catch (pollError) {
              reject(new Error(`Connection timed out and polling failed: ${pollError}`));
            }
          } else {
            reject(new Error('Connection timed out'));
          }
        }
      }, timeoutMs);

      ws.onopen = () => {
        this._lastPingTime = Date.now();
        this._startHealthCheck(ws, sessionId, resolve, reject);

        const payload: Record<string, unknown> = {
          prompt,
          timestamp: Math.floor(Date.now() / 1000),
        };

        if (!isDirect) {
          payload.to = this.address;
        }

        const signed = this._signPayload(payload);

        const inputMessage: Record<string, unknown> = {
          type: 'INPUT',
          input_id: inputId,
          prompt,
          ...signed,
        };

        if (images && images.length > 0) {
          inputMessage.images = images;
        }

        if (!isDirect) {
          inputMessage.to = this.address;
        }

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

          if (data?.type === 'PING') {
            this._lastPingTime = Date.now();
            try {
              ws.send(JSON.stringify({ type: 'PONG' }));
            } catch {
              // Ignore send errors
            }
            return;
          }

          if (data?.type === 'session_sync' && data.session) {
            this._currentSession = data.session;
          }

          if (data?.type === 'mode_changed' && data.mode) {
            if (!this._currentSession) {
              this._currentSession = { mode: data.mode };
            } else {
              this._currentSession.mode = data.mode;
            }
          }

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

          if (data?.type === 'llm_call' || data?.type === 'llm_result' ||
              data?.type === 'tool_call' || data?.type === 'tool_result' ||
              data?.type === 'thinking' || data?.type === 'assistant' ||
              data?.type === 'intent' || data?.type === 'eval' || data?.type === 'compact' ||
              data?.type === 'tool_blocked') {
            this._handleStreamEvent(data);

            if (data.session) {
              this._currentSession = data.session;
            }
          }

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
          }

          if (data?.type === 'ONBOARD_SUCCESS') {
            this._addChatItem({
              type: 'onboard_success',
              level: data.level as string,
              message: data.message as string,
            });

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
              if (!isDirect) {
                retryPayload.to = this.address;
              }

              const retrySigned = this._signPayload(retryPayload);

              const retryMessage: Record<string, unknown> = {
                type: 'INPUT',
                input_id: retryInputId,
                prompt: retryPrompt,
                ...retrySigned,
              };
              if (!isDirect) {
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

          const isOutputForUs = isDirect
            ? data?.type === 'OUTPUT'
            : data?.type === 'OUTPUT' && data?.input_id === inputId;
          if (isOutputForUs) {
            settled = true;
            clearTimeout(timer);
            this._stopHealthCheck();
            this._removeOptimisticThinking();
            this._status = 'idle';

            if (data.session) {
              this._currentSession = data.session;
            }

            const result = data.result || '';
            if (result) {
              const lastAgent = this._chatItems.filter((e): e is ChatItem & { type: 'agent' } => e.type === 'agent').pop();
              if (!lastAgent || lastAgent.content !== result) {
                this._addChatItem({ type: 'agent', content: result });
              }
            }

            this._activeWs = null;
            try { ws.close(); } catch { /* ignore */ }
            resolve({ text: result, done: true });
          }

          if (data?.type === 'ERROR') {
            settled = true;
            clearTimeout(timer);
            this._stopHealthCheck();
            this._status = 'idle';
            this._activeWs = null;
            try { ws.close(); } catch { /* ignore */ }
            reject(new Error(`Agent error: ${String(data.message || data.error || 'Unknown error')}`));
          }
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          this._stopHealthCheck();
          this._status = 'idle';
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

        if (this._enablePolling) {
          try {
            const result = await this._pollForResult(sessionId);
            resolve({ text: result, done: true });
            return;
          } catch {
            // Polling failed, fall through to original error
          }
        }

        reject(new Error(`WebSocket error: ${String(err)}`));
      };

      ws.onclose = async () => {
        this._activeWs = null;
        this._stopHealthCheck();
        if (!settled) {
          settled = true;
          this._status = 'idle';
          clearTimeout(timer);

          if (this._enablePolling) {
            try {
              const result = await this._pollForResult(sessionId);
              resolve({ text: result, done: true });
              return;
            } catch {
              // Polling failed, fall through to original error
            }
          }

          reject(new Error('Connection closed before response'));
        }
      };
    });
  }

  // ==========================================================================
  // Private Methods - UI Helpers
  // ==========================================================================

  private _removeOptimisticThinking(): void {
    const idx = this._chatItems.findIndex(item => item.id === '__optimistic__');
    if (idx !== -1) {
      this._chatItems.splice(idx, 1);
    }
  }

  private _handleStreamEvent(event: Record<string, unknown>): void {
    const eventType = event.type as string;

    this._removeOptimisticThinking();

    switch (eventType) {
      case 'tool_call': {
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
        const toolId = (event.tool_id || event.id) as string;
        const existing = this._chatItems.find(
          (e): e is ChatItem & { type: 'tool_call' } => e.type === 'tool_call' && e.id === toolId
        );
        if (existing) {
          existing.status = event.status === 'error' ? 'error' : 'done';
          existing.result = event.result as string;
          if (typeof event.timing_ms === 'number') {
            existing.timing_ms = event.timing_ms;
          }
        }
        break;
      }

      case 'llm_call': {
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
        this._addChatItem({
          type: 'thinking',
          id: event.id != null ? String(event.id) : undefined,
          status: 'done',
          content: event.content as string | undefined,
          kind: event.kind as string | undefined,
        });
        break;
      }

      case 'assistant': {
        if (event.content) {
          this._addChatItem({
            type: 'agent',
            id: event.id != null ? String(event.id) : undefined,
            content: event.content as string,
          });
        }
        break;
      }

      case 'agent_image': {
        const imageData = event.image as string;
        if (imageData) {
          const lastAgent = this._chatItems.filter((e): e is ChatItem & { type: 'agent' } => e.type === 'agent').pop();
          if (lastAgent) {
            if (!lastAgent.images) {
              lastAgent.images = [];
            }
            lastAgent.images.push(imageData);
          } else {
            this._addChatItem({
              type: 'agent',
              id: event.id != null ? String(event.id) : undefined,
              content: '',
              images: [imageData],
            });
          }
        }
        break;
      }

      case 'intent': {
        const intentId = event.id as string;
        const status = event.status as 'analyzing' | 'understood';

        if (status === 'analyzing') {
          this._addChatItem({
            type: 'intent',
            id: intentId,
            status: 'analyzing',
          });
        } else if (status === 'understood') {
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
        const evalId = event.id as string;
        const status = event.status as 'evaluating' | 'done';

        if (status === 'evaluating') {
          this._addChatItem({
            type: 'eval',
            id: evalId,
            status: 'evaluating',
            expected: event.expected as string | undefined,
            eval_path: event.eval_path as string | undefined,
          });
        } else if (status === 'done') {
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

      case 'tool_blocked': {
        this._addChatItem({
          type: 'tool_blocked',
          tool: event.tool as string,
          reason: event.reason as string,
          message: event.message as string,
        });
        break;
      }
    }
  }

  private _addChatItem(event: Partial<ChatItem> & { type: ChatItemType }): void {
    const id = (event as { id?: string }).id || String(++this._uiIdCounter);
    this._chatItems.push({ ...event, id } as ChatItem);
  }

  // ==========================================================================
  // Private Methods - Signing
  // ==========================================================================

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

  toString(): string {
    const short = this.address.length > 12 ? this.address.slice(0, 12) + '...' : this.address;
    return `RemoteAgent(${short})`;
  }
}
