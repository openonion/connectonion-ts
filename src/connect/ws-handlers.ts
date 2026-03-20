/**
 * @llm-note
 *   Dependencies: imports from [src/connect/types, src/connect/stream-events, src/connect/endpoint, src/connect/remote-agent (type-only)]
 *   Data flow: onmessage parses JSON → dispatches by type → mutates agent fields → resolves/rejects the input() Promise
 *   State/Effects: mutates RemoteAgent fields (session, status, chatItems, connection state) via _ prefix access
 *   Integration: attachWsHandlers() wires onmessage/onerror/onclose; called by RemoteAgent._connectAndSend and _reconnect
 */
import type { RemoteAgent } from './remote-agent';
import { mapEventToChatItem } from './chat-item-mapper';
import { generateUUID } from './endpoint';
import { ChatItem, Response, WebSocketLike } from './types';

export function attachWsHandlers(
  agent: RemoteAgent,
  ws: WebSocketLike,
  inputId: string,
  isDirect: boolean,
  state: { settled: boolean; timer: ReturnType<typeof setTimeout> },
  resolve: (value: Response) => void,
  reject: (reason?: unknown) => void,
): void {
  ws.onmessage = (evt: { data: unknown }) => {
    if (state.settled) return;
    const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
    const data = JSON.parse(raw);

    if (data?.type === 'PING') {
      agent._lastPingTime = Date.now();
      ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }

    if (data?.type === 'session_sync' && data.session) {
      agent._currentSession = data.session;
    }

    if (data?.type === 'CONNECTED') {
      console.log('[RemoteAgent] Connected, session:', data.session_id, 'status:', data.status);
      if (agent._connectedCallback) {
        const cb = agent._connectedCallback;
        agent._connectedCallback = null;
        cb(data);
      }
      agent._onMessage?.();
      return;
    }

    if (data?.type === 'RECONNECTED') {
      console.log('[RemoteAgent] Reconnected to session:', data.session_id);
    }

    if (data?.type === 'SESSION_MERGED' && data.server_newer) {
      console.log('[RemoteAgent] Server had newer session, merged');
    }

    if (data?.type === 'mode_changed' && data.mode) {
      if (!agent._currentSession) {
        agent._currentSession = { mode: data.mode };
      } else {
        agent._currentSession.mode = data.mode;
      }
    }

    if (data?.type === 'ulw_turns_reached') {
      agent._status = 'waiting';
      if (agent._currentSession) {
        agent._currentSession.ulw_turns_used = data.turns_used;
      }
      agent._addChatItem({
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
      agent._clearPlaceholder();
      mapEventToChatItem(agent._chatItems, data, (item) => agent._addChatItem(item));
      if (data.session) {
        agent._currentSession = data.session;
      }
    }

    if (data?.type === 'ask_user') {
      agent._status = 'waiting';
      agent._addChatItem({ type: 'ask_user', text: data.text || '', options: data.options || [], multi_select: data.multi_select || false });
    }

    if (data?.type === 'approval_needed') {
      agent._status = 'waiting';
      agent._addChatItem({
        type: 'approval_needed',
        tool: data.tool as string,
        arguments: data.arguments as Record<string, unknown>,
        ...(data.description && { description: data.description as string }),
        ...(data.batch_remaining && { batch_remaining: data.batch_remaining as Array<{ tool: string; arguments: string }> }),
      });
    }

    if (data?.type === 'plan_review') {
      agent._status = 'waiting';
      agent._addChatItem({
        type: 'plan_review',
        plan_content: data.plan_content as string,
      });
    }

    if (data?.type === 'ONBOARD_REQUIRED') {
      agent._status = 'waiting';
      agent._pendingPrompt = data.prompt || '';
      agent._pendingInputId = inputId;
      agent._pendingSessionId = agent._currentSession?.session_id || null;
      agent._addChatItem({
        type: 'onboard_required',
        methods: (data.methods || []) as string[],
        paymentAmount: data.payment_amount as number | undefined,
      });
    }

    if (data?.type === 'ONBOARD_SUCCESS') {
      agent._addChatItem({
        type: 'onboard_success',
        level: data.level as string,
        message: data.message as string,
      });

      if (agent._pendingPrompt && agent._activeWs) {
        agent._status = 'working';
        const retryPrompt = agent._pendingPrompt;
        const retryInputId = agent._pendingInputId || generateUUID();
        agent._pendingPrompt = null;
        agent._pendingInputId = null;

        agent._sendInput(
          agent._activeWs, retryInputId, retryPrompt,
          agent._pendingSessionId || generateUUID(), isDirect,
        );
        agent._pendingSessionId = null;
      }
    }

    if (data?.type === 'OUTPUT') {
      state.settled = true;
      clearTimeout(state.timer);
      agent._stopPingMonitor();
      agent._clearPlaceholder();
      agent._status = 'idle';
      agent._shouldReconnect = false;
      agent._connectionState = 'disconnected';
      agent._reconnectAttempts = 0;

      if (data.session) {
        agent._currentSession = data.session;
      }

      if (data.server_newer && data.chat_items && Array.isArray(data.chat_items)) {
        console.log('[RemoteAgent] Session was merged with newer server state');
        const userItems = agent._chatItems.filter(item => item.type === 'user');
        const serverNonUserItems = (data.chat_items as ChatItem[]).filter(item => item.type !== 'user');
        agent._chatItems = [...userItems, ...serverNonUserItems];
      }

      const result = data.result || '';
      if (result) {
        const lastAgent = agent._chatItems.filter((e): e is ChatItem & { type: 'agent' } => e.type === 'agent').pop();
        if (!lastAgent || lastAgent.content !== result) {
          agent._addChatItem({ type: 'agent', content: result });
        }
      }

      agent._activeWs = null;
      ws.close();
      resolve({ text: result, done: true });
    }

    if (data?.type === 'ERROR') {
      state.settled = true;
      clearTimeout(state.timer);
      agent._stopPingMonitor();
      agent._status = 'idle';
      agent._shouldReconnect = false;
      agent._connectionState = 'disconnected';
      agent._activeWs = null;
      ws.close();
      reject(new Error(`Agent error: ${String(data.message || data.error || 'Unknown error')}`));
    }

    agent._onMessage?.();
  };

  ws.onerror = async (err: unknown) => {
    if (state.settled) return;
    agent._stopPingMonitor();
    clearTimeout(state.timer);
    ws.close();

    if (isDirect && !agent._directUrl) {
      agent._resolvedEndpoint = undefined;
      agent._endpointResolutionAttempted = false;
    }

    if (agent._shouldReconnect && agent._reconnectAttempts < agent._maxReconnectAttempts) {
      agent._attemptReconnect(resolve, reject);
    } else {
      state.settled = true;
      agent._status = 'idle';
      agent._shouldReconnect = false;
      agent._connectionState = 'disconnected';
      reject(new Error(`WebSocket error: ${String(err)}`));
    }
  };

  ws.onclose = async () => {
    agent._activeWs = null;
    agent._stopPingMonitor();
    if (!state.settled) {
      clearTimeout(state.timer);

      if (isDirect && !agent._directUrl) {
        agent._resolvedEndpoint = undefined;
        agent._endpointResolutionAttempted = false;
      }

      if (agent._shouldReconnect && agent._reconnectAttempts < agent._maxReconnectAttempts) {
        agent._attemptReconnect(resolve, reject);
      } else {
        state.settled = true;
        agent._status = 'idle';
        agent._shouldReconnect = false;
        agent._connectionState = 'disconnected';
        reject(new Error('Connection closed before response'));
      }
    }
  };
}
