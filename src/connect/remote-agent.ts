/**
 * @llm-note
 *   Dependencies: imports from [src/connect/types, src/connect/endpoint, src/connect/auth, src/connect/handlers, src/address]
 *   Data flow: input() → _connectAndSend() → creates WS + Promise → attachWsHandlers() dispatches events → resolve on OUTPUT
 *   State/Effects: owns WebSocket lifecycle + mutable _chatItems + _currentSession
 *   Integration: public API consumed by connect() factory and React useAgentForHuman hook
 */
import * as address from '../address';
import {
  AgentStatus, ApprovalMode, ChatItem, ChatItemType, ConnectionState,
  ConnectOptions, ResolvedEndpoint, Response, SessionState, WebSocketCtor, WebSocketLike,
} from './types';
import { getWebSocketCtor, generateUUID, normalizeRelayUrl, resolveEndpoint } from './endpoint';
import { ensureKeys, signPayload } from './auth';
import { attachWsHandlers } from './ws-handlers';

export class RemoteAgent {
  readonly address: string;

  _keys?: address.AddressData;
  _relayUrl: string;
  _directUrl?: string;
  _resolvedEndpoint?: ResolvedEndpoint;
  _endpointResolutionAttempted = false;
  _WS: WebSocketCtor;

  _status: AgentStatus = 'idle';
  _connectionState: ConnectionState = 'disconnected';
  _currentSession: SessionState | null = null;
  _chatItems: ChatItem[] = [];
  _activeWs: WebSocketLike | null = null;
  _pendingPrompt: string | null = null;
  _pendingInputId: string | null = null;
  _pendingSessionId: string | null = null;

  _lastPingTime = 0;
  _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  _reconnectAttempts = 0;
  _maxReconnectAttempts = 3;
  _reconnectBaseDelay = 1000;
  _shouldReconnect = false;
  _connectedCallback: ((data: Record<string, unknown>) => void) | null = null;

  constructor(agentAddress: string, options: ConnectOptions = {}) {
    this.address = agentAddress;
    this._relayUrl = normalizeRelayUrl(options.relayUrl || 'wss://oo.openonion.ai');
    this._directUrl = options.directUrl?.replace(/\/$/, '');
    this._WS = options.wsCtor || getWebSocketCtor();
    if (options.keys) this._keys = options.keys;
  }

  get agentAddress(): string { return this.address; }
  get status(): AgentStatus { return this._status; }
  get connectionState(): ConnectionState { return this._connectionState; }
  get currentSession(): SessionState | null { return this._currentSession; }
  get ui(): ChatItem[] { return this._chatItems; }
  get mode(): ApprovalMode { return this._currentSession?.mode || 'safe'; }
  get error(): Error | null { return this._error || null; }

  _error: Error | null = null;
  _onMessage: (() => void) | null = null;
  set onMessage(fn: (() => void) | null) { this._onMessage = fn; }

  // --- Public API ---

  async input(prompt: string, options?: { images?: string[]; timeoutMs?: number }): Promise<Response> {
    return this._connectAndSend(prompt, options?.timeoutMs ?? 600000, options?.images);
  }

  /** Reconnect to an existing session to receive pending output without adding duplicate UI items */
  async reconnect(sessionId?: string): Promise<Response> {
    const sid = sessionId || this._currentSession?.session_id;
    if (!sid) throw new Error('No session to reconnect');

    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();

    if (!this._currentSession) this._currentSession = { session_id: sid };

    this._status = 'working';
    const inputId = generateUUID();
    const { wsUrl, isDirect } = this._resolveWsUrl();

    const ws = new this._WS(wsUrl);
    this._activeWs = ws;
    this._shouldReconnect = true;

    return new Promise<Response>((resolve, reject) => {
      const state = {
        settled: false,
        timer: setTimeout(() => {
          if (!state.settled) {
            state.settled = true;
            this._status = 'idle';
            this._shouldReconnect = false;
            this._connectionState = 'disconnected';
            ws.close();
            reject(new Error('Reconnect timed out'));
          }
        }, 60000),
      };

      ws.onopen = () => {
        this._connectionState = 'connected';
        this._lastPingTime = Date.now();
        this._startPingMonitor(ws, reject);
        // CONNECT with session_id to resume — no INPUT needed
        this._connectedCallback = null;
        this._sendConnect(ws, sid, isDirect);
      };

      attachWsHandlers(this, ws, inputId, isDirect, state, resolve, reject);
    });
  }

  /** Attach to an existing session without sending a prompt. For auto-reconnect on page refresh. */
  async attach(sessionId: string): Promise<Response> {
    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();

    if (!this._currentSession) this._currentSession = { session_id: sessionId };
    this._status = 'working';
    const { wsUrl, isDirect } = this._resolveWsUrl();

    const ws = new this._WS(wsUrl);
    this._activeWs = ws;
    this._shouldReconnect = true;

    return new Promise<Response>((resolve, reject) => {
      const state = {
        settled: false,
        timer: setTimeout(() => {
          if (!state.settled) {
            state.settled = true;
            this._status = 'idle';
            this._shouldReconnect = false;
            this._connectionState = 'disconnected';
            ws.close();
            reject(new Error('Attach timed out'));
          }
        }, 60000),
      };

      ws.onopen = () => {
        this._connectionState = 'connected';
        this._lastPingTime = Date.now();
        this._startPingMonitor(ws, reject);
        this._connectedCallback = null;
        this._sendConnect(ws, sessionId, isDirect);
      };

      attachWsHandlers(this, ws, generateUUID(), isDirect, state, resolve, reject);
    });
  }

  async inputAsync(prompt: string, options?: { images?: string[]; timeoutMs?: number }): Promise<Response> {
    return this.input(prompt, options);
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
    if (this._activeWs) {
      const msg: Record<string, unknown> = { type: 'mode_change', mode };
      if (mode === 'ulw' && options?.turns) msg.turns = options.turns;
      this._activeWs.send(JSON.stringify(msg));
    }
  }

  reset(): void {
    if (this._activeWs) { this._activeWs.close(); this._activeWs = null; }
    this._currentSession = null;
    this._chatItems = [];
    this._status = 'idle';
    this._connectionState = 'disconnected';
    this._shouldReconnect = false;
    this._reconnectAttempts = 0;
  }

  resetConversation(): void { this.reset(); }

  send(message: Record<string, unknown>): void {
    if (!this._activeWs) throw new Error('No active connection');
    this._activeWs.send(JSON.stringify(message));
  }

  signOnboard(options: { inviteCode?: string; payment?: number }): Record<string, unknown> {
    const payload: Record<string, unknown> = { timestamp: Math.floor(Date.now() / 1000) };
    if (options.inviteCode) payload.invite_code = options.inviteCode;
    if (options.payment) payload.payment = options.payment;
    return { type: 'ONBOARD_SUBMIT', ...signPayload(this._keys, payload) };
  }

  async checkSession(sessionId?: string): Promise<'running' | 'done' | 'not_found'> {
    const sid = sessionId || this._currentSession?.session_id;
    if (!sid) return 'not_found';
    await this._resolveEndpointOnce();
    const httpUrl = this._directUrl || this._resolvedEndpoint?.httpUrl;
    if (!httpUrl) return 'not_found';
    const res = await fetch(`${httpUrl}/sessions/${sid}`);
    if (!res.ok) return 'not_found';
    const data = await res.json() as { status?: string } | null;
    return data?.status === 'running' ? 'running' : 'done';
  }

  async checkSessionStatus(sessionId: string): Promise<'running' | 'suspended' | 'completed' | 'not_found'> {
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
          clearTimeout(timeout); ws.close(); resolve(data.status || 'not_found');
        }
      };
      ws.onerror = () => { clearTimeout(timeout); ws.close(); resolve('not_found'); };
    });
  }

  // --- Module-internal helpers (used by handlers.ts) ---

  _addChatItem(event: Partial<ChatItem> & { type: ChatItemType }): void {
    const id = (event as { id?: string }).id || generateUUID();
    this._chatItems.push({ ...event, id } as ChatItem);
  }

  _clearPlaceholder(): void {
    const idx = this._chatItems.findIndex(item => item.id === '__optimistic__');
    if (idx !== -1) this._chatItems.splice(idx, 1);
  }

  _stopPingMonitor(): void {
    if (this._healthCheckInterval) { clearInterval(this._healthCheckInterval); this._healthCheckInterval = null; }
  }

  _attemptReconnect(resolve: (value: Response) => void, reject: (reason?: any) => void): void {
    if (!this._currentSession?.session_id) { reject(new Error('No session to reconnect')); return; }
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._reconnectAttempts = 0;
      this._shouldReconnect = false;
      this._connectionState = 'disconnected';
      reject(new Error('Max reconnection attempts reached'));
      return;
    }
    this._connectionState = 'reconnecting';
    this._reconnectAttempts++;
    const delay = Math.min(this._reconnectBaseDelay * Math.pow(2, this._reconnectAttempts - 1), 30000);
    console.log(`[ConnectOnion] Connection lost. Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);
    setTimeout(() => this._reconnect(resolve, reject), delay);
  }

  _sendConnect(ws: WebSocketLike, sessionId: string | null, isDirect: boolean): void {
    const payload: Record<string, unknown> = { timestamp: Math.floor(Date.now() / 1000) };
    payload.to = this.address;
    const signed = signPayload(this._keys, payload);
    const msg: Record<string, unknown> = { type: 'CONNECT', ...signed };
    if (!isDirect) msg.to = this.address;
    if (sessionId) msg.session_id = sessionId;
    if (this._currentSession) {
      msg.session = { ...this._currentSession, session_id: sessionId };
    }
    console.log(`[ConnectOnion] Sending CONNECT via ${isDirect ? 'direct' : 'relay'}, from: ${(signed as { from?: string }).from?.slice(0, 12)}...`);
    ws.send(JSON.stringify(msg));
  }

  _sendInput(ws: WebSocketLike, inputId: string, prompt: string, sessionId: string, isDirect: boolean, images?: string[]): void {
    const msg: Record<string, unknown> = { type: 'INPUT', input_id: inputId, prompt };
    if (images?.length) msg.images = images;
    if (!isDirect) msg.to = this.address;
    msg.session = this._currentSession
      ? { ...this._currentSession, session_id: sessionId }
      : { session_id: sessionId };
    console.log(`[ConnectOnion] Sending INPUT`);
    ws.send(JSON.stringify(msg));
  }

  // --- Private: connection lifecycle ---

  private _startPingMonitor(ws: WebSocketLike, reject: (reason?: any) => void): void {
    this._stopPingMonitor();
    this._healthCheckInterval = setInterval(() => {
      if (Date.now() - this._lastPingTime > 60000) {
        this._stopPingMonitor();
        ws.close();
        reject(new Error('Connection health check failed: No PING received for 60 seconds'));
      }
    }, 10000);
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

  private async _connectAndSend(prompt: string, timeoutMs: number, images?: string[]): Promise<Response> {
    this._keys = ensureKeys(this._keys);
    await this._resolveEndpointOnce();

    this._pendingPrompt = prompt;
    this._addChatItem({ type: 'user', content: prompt, images });
    this._addChatItem({ type: 'thinking', id: '__optimistic__', status: 'running' });
    this._status = 'working';

    const inputId = generateUUID();
    const sessionId = this._currentSession?.session_id || generateUUID();
    const { wsUrl, isDirect } = this._resolveWsUrl();

    const ws = new this._WS(wsUrl);
    this._activeWs = ws;
    this._shouldReconnect = true;

    return new Promise<Response>((resolve, reject) => {
      const state = {
        settled: false,
        timer: setTimeout(() => {
          if (!state.settled) {
            state.settled = true;
            this._status = 'idle';
            this._shouldReconnect = false;
            this._connectionState = 'disconnected';
            ws.close();
            reject(new Error('Connection timed out'));
          }
        }, timeoutMs),
      };

      ws.onopen = () => {
        this._connectionState = 'connected';
        this._lastPingTime = Date.now();
        this._startPingMonitor(ws, reject);
        // Two-step: CONNECT first, then INPUT after CONNECTED response
        this._connectedCallback = () => {
          this._sendInput(ws, inputId, prompt, sessionId, isDirect, images);
        };
        this._sendConnect(ws, sessionId, isDirect);
      };

      attachWsHandlers(this, ws, inputId, isDirect, state, resolve, reject);
    });
  }

  private _reconnect(resolve: (value: Response) => void, reject: (reason?: any) => void): void {
    const sessionId = this._currentSession?.session_id;
    if (!sessionId) { reject(new Error('No session to reconnect')); return; }

    const { wsUrl, isDirect } = this._resolveWsUrl();
    const ws = new this._WS(wsUrl);
    this._activeWs = ws;
    this._status = 'working';

    const state = {
      settled: false,
      timer: setTimeout(() => {
        if (!state.settled) {
          state.settled = true;
          this._status = 'idle';
          ws.close();
          this._attemptReconnect(resolve, reject);
        }
      }, 600000),
    };

    ws.onopen = () => {
      console.log('[ConnectOnion] Reconnected successfully');
      this._connectionState = 'connected';
      this._lastPingTime = Date.now();
      this._startPingMonitor(ws, reject);
      // Reconnect: CONNECT with session_id, no INPUT needed
      this._connectedCallback = null;
      this._sendConnect(ws, sessionId, isDirect);
    };

    attachWsHandlers(this, ws, '', isDirect, state, resolve, reject);
  }

  toString(): string {
    const short = this.address.length > 12 ? this.address.slice(0, 12) + '...' : this.address;
    return `RemoteAgent(${short})`;
  }
}
