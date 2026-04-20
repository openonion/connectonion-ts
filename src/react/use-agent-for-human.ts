import { useEffect, useRef, useState } from 'react';
import {
  connect,
  RemoteAgent,
  ChatItem,
  AgentStatus,
  ConnectionState,
  SessionState,
  ApprovalMode,
  OutgoingMessage,
} from '../connect';
import { getStore, type Message } from './store';

/**
 * Return value of `useAgentForHuman`. Exposes all reactive state and every method
 * needed to drive a full chat UI — from sending a first prompt to handling
 * ULW (Unlimited Work) pauses and approval gates.
 *
 * This hook is designed for human users interacting with agents through a UI.
 * For agent-to-agent communication, use `connect()` directly.
 *
 * All fields are stable references across re-renders unless their underlying
 * value actually changes.
 */
export interface UseAgentForHumanReturn {
  /** Current agent lifecycle state: 'idle' | 'working' | 'waiting' */
  status: AgentStatus;

  /**
   * WebSocket relay connection state: 'disconnected' | 'connected' | 'reconnecting'.
   * Updated synchronously whenever the agent's `onMessage` callback fires.
   */
  connectionState: ConnectionState;

  /**
   * Ordered list of chat items streamed from the agent. Each item is a
   * discriminated union keyed by `type` — use `isChatItemType` to narrow
   * before reading type-specific fields.
   */
  ui: ChatItem[];

  /** Session UUID passed to the hook. Echoed here so consumers don't need a separate ref. */
  sessionId: string;

  /** True whenever status !== 'idle'. Useful for disabling input controls. */
  isProcessing: boolean;

  /** Last error captured and stored in the Zustand store. Cleared on the next `input()` call. */
  error: Error | null;

  /**
   * Check whether a specific session is alive on the relay server.
   * The caller decides when and how often to invoke this — no built-in interval.
   *
   * @param sessionId - Session UUID to probe
   * @returns 'executing' | 'suspended' | 'connected' | 'not_found'
   */
  checkSessionStatus: (sessionId: string) => Promise<'executing' | 'suspended' | 'connected' | 'not_found'>;


  /** Current approval mode. Defaults to 'safe' when no session exists yet. */
  mode: ApprovalMode;

  /** Maximum turns before ULW mode pauses. null when mode is not 'ulw'. */
  ulwTurns: number | null;

  /** Turns consumed so far in the current ULW window. null when mode is not 'ulw'. */
  ulwTurnsUsed: number | null;

  /**
   * Fire-and-forget: sends a user prompt to the agent. Updates flow back through
   * the `onMessage` callback registered during mount, keeping `ui`, `status`,
   * `connectionState`, and `session` in sync as the agent streams its response.
   *
   * @param prompt - Natural-language instruction for the agent
   * @param options.images - Base64-encoded images to attach to the message
   * @param options.files - File attachments with name, type, size, and dataUrl
   */
  input: (prompt: string, options?: { images?: string[]; files?: import('../connect/types').FileAttachment[] }) => void;

  /**
   * Send a typed message to the agent over the WebSocket.
   * Use this for all response messages: ASK_USER_RESPONSE, APPROVAL_RESPONSE,
   * PLAN_REVIEW_RESPONSE, ULW_RESPONSE, etc.
   */
  sendMessage: (message: OutgoingMessage) => void;

  /** Sign an onboard payload (requires private keys). Pass result to sendMessage(). */
  signOnboard: (options: { inviteCode?: string; payment?: number }) => OutgoingMessage;

  /**
   * Switch the agent's approval mode and sync the change to localStorage immediately
   * so it survives a page refresh before the next server-synced session snapshot arrives.
   * Also initialises ULW turn counters locally when switching to 'ulw'.
   *
   * @param mode - Target approval mode
   * @param options.turns - Initial turn budget when switching to 'ulw' (default 100)
   */
  setMode: (mode: ApprovalMode, options?: { turns?: number }) => void;

  /** Reconnect to existing session to receive pending output */
  reconnect: () => void;

  /** Clear all agent and store state, effectively starting a new conversation. */
  reset: () => void;

  /** Pause agent execution at the next iteration boundary */
  pause: () => void;

  /** Resume a paused agent */
  resume: () => void;

  /** Stop agent execution */
  stopExecution: () => void;

  /** Send an inline message to the agent during execution */
  sendInlineMessage: (content: string) => void;

  /** Current execution state: null when idle, 'running'/'paused'/'stopped' during execution */
  executionState: 'running' | 'paused' | 'stopped' | null;
}

/**
 * React hook for a human user to interact with a remote AI agent.
 *
 * This is the primary hook for building chat UIs where a human drives the
 * conversation. It handles approval gates, ULW pauses, onboarding flows,
 * and session persistence — all concerns specific to human interaction.
 * For agent-to-agent communication, use `connect()` directly instead.
 *
 * Wraps a `RemoteAgent` instance with Zustand-backed localStorage persistence
 * so chat history and session state survive page refreshes. One store is created
 * per `(address, sessionId)` pair and cached for the lifetime of the module.
 *
 * **Lifecycle**
 * 1. On mount (or when `sessionId` changes), any persisted session is restored
 *    into the `RemoteAgent` so the server can resume from the correct context.
 * 2. `agent.onMessage` is registered in an effect to receive every streaming
 *    event from the agent — UI items, status, connection state, and session
 *    snapshots are all synced here without a polling interval.
 * 3. `input()` is fire-and-forget: it merges the session and dispatches the
 *    prompt; all reactive updates come back through `onMessage`.
 *
 * **Session ID ownership**
 * The caller is responsible for generating and managing the session UUID.
 * A stable ID (e.g. persisted in a URL parameter or parent component state)
 * lets users resume interrupted sessions across browser refreshes.
 *
 * @param address - Agent's 0x-prefixed public address on the relay network
 * @param sessionId - UUID identifying this conversation session
 * @returns Reactive state and methods for driving a chat UI
 *
 * @example
 * ```tsx
 * const { status, ui, input, isProcessing } = useAgentForHuman(agentAddress, sessionId);
 *
 * return (
 *   <button disabled={isProcessing} onClick={() => input('Hello')}>
 *     Send
 *   </button>
 * );
 * ```
 */
export function useAgentForHuman(
  address: string,
  sessionId: string,
): UseAgentForHumanReturn {
  const useStore = getStore(address, sessionId);

  // State from store
  const messages = useStore((s) => s.messages);
  const ui = useStore((s) => s.ui);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);

  // Actions from store
  const setStatus = useStore((s) => s.setStatus);
  const setUI = useStore((s) => s.setUI);
  const setSession = useStore((s) => s.setSession);
  const setError = useStore((s) => s.setError);
  const updateMessages = useStore((s) => s.updateMessages);
  const resetStore = useStore((s) => s.reset);

  // RemoteAgent instance (keyed by address + sessionId)
  const agentRef = useRef<RemoteAgent | null>(null);
  const keyRef = useRef<string>(`${address}:${sessionId}`);

  // Tear down the cached agent when the caller switches to a different address or session
  // so the next render creates a fresh RemoteAgent pointing at the correct endpoint.
  if (keyRef.current !== `${address}:${sessionId}`) {
    agentRef.current = null;
    keyRef.current = `${address}:${sessionId}`;
  }

  if (!agentRef.current) {
    agentRef.current = connect(address);
  }
  const agent = agentRef.current;

  // connectionState is initialized from the agent and then kept in sync via onMessage.
  const [connectionState, setConnectionState] = useState<ConnectionState>(agent.connectionState);

  // Execution control state (pause/resume/stop)
  const [executionState, setExecutionState] = useState<'running' | 'paused' | 'stopped' | null>(agent.executionState);

  // Register a single onMessage callback for the lifetime of this agent instance.
  // This replaces a polling interval: every streaming event from the server triggers
  // one synchronous flush of all derived state into React/Zustand.
  useEffect(() => {
    agent.onMessage = () => {
      setUI([...agent.ui]);
      setStatus(agent.status);
      setConnectionState(agent.connectionState);
      setExecutionState(agent.executionState);
      if (agent.error) setError(agent.error);
      if (agent.currentSession) {
        setSession(agent.currentSession);
        if (agent.currentSession.messages) {
          updateMessages(agent.currentSession.messages as Message[]);
        }
      }
    };
    return () => { agent.onMessage = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  // Restore persisted session into the RemoteAgent on mount or when sessionId changes.
  // Then auto-reconnect to sync with server (get newer data, resume executing agent, etc.)
  useEffect(() => {
    if (session) {
      (agent as any)._currentSession = { ...session, session_id: sessionId };
      (agent as any)._chatItems = [...ui];
    } else if (messages.length > 0) {
      (agent as any)._currentSession = { session_id: sessionId, messages };
      (agent as any)._chatItems = [...ui];
    }

    // No auto-reconnect on mount. Show cached conversation from localStorage.
    // When user sends next message, input() → _ensureConnected() → CONNECT
    // will sync with server (session merge, server_newer, etc.).
  }, [sessionId]);

  const input = (prompt: string, options?: { images?: string[]; files?: import('../connect/types').FileAttachment[] }) => {
    setError(null);

    // Merge session before dispatching: the agent may have received a mode change via
    // setMode() (stored only on _currentSession) that isn't reflected in the Zustand
    // store yet. We preserve those in-flight agent properties while ensuring the server
    // receives the canonical message history and the correct session ID.
    const agentSession = (agent as any)._currentSession || {};
    (agent as any)._currentSession = {
      ...agentSession,          // Preserve mode set by setMode()
      ...(session || {}),       // Overlay with store session
      session_id: sessionId,    // Ensure correct session ID
      messages: session?.messages || messages,
    };

    // Restore chat items if agent is empty but store has data
    // (Zustand hydration is async — the mount-time restore effect may have
    // run before localStorage was hydrated, leaving _chatItems empty)
    if ((agent as any)._chatItems.length === 0 && ui.length > 0) {
      (agent as any)._chatItems = [...ui];
    }

    agent.input(prompt, options);  // non-blocking — updates come via onMessage
  };

  const reconnect = () => {
    // Ensure session is set on agent before reconnecting
    if (!(agent as any)._currentSession?.session_id) {
      (agent as any)._currentSession = { ...(session || {}), session_id: sessionId };
    }
    if ((agent as any)._chatItems.length === 0 && ui.length > 0) {
      (agent as any)._chatItems = [...ui];
    }
    agent.reconnect(sessionId);  // non-blocking — updates come via onMessage
  };

  const reset = () => {
    agent.reset();
    resetStore();
  };

  const sendMessage = (message: OutgoingMessage) => {
    agent.send(message);
  };

  const setMode = (newMode: ApprovalMode, options?: { turns?: number }) => {
    agent.setMode(newMode, options);
    // Mirror the mode change into the Zustand store immediately so the UI reflects it
    // before the next server-synced session arrives. ULW counters are also seeded here
    // so consumers can render a turn budget without waiting for the first response.
    const updates: Partial<SessionState> = { mode: newMode };
    if (newMode === 'ulw') {
      updates.ulw_turns = options?.turns || 100;
      updates.ulw_turns_used = 0;
    }
    setSession(session
      ? { ...session, ...updates }
      : { session_id: sessionId, ...updates }
    );
  };

  const pause = () => agent.pause();
  const resumeExecution = () => agent.resume();
  const stopExecution = () => agent.stopExecution();
  const sendInlineMessage = (content: string) => agent.sendInlineMessage(content);

  return {
    status,
    connectionState,
    ui,
    sessionId,
    isProcessing: status !== 'idle',
    error,
    checkSessionStatus: (sid: string) => agent.checkSessionStatus(sid),
    mode: session?.mode || 'safe',
    ulwTurns: session?.ulw_turns ?? null,
    ulwTurnsUsed: session?.ulw_turns_used ?? null,
    input,
    sendMessage,
    signOnboard: (options: { inviteCode?: string; payment?: number }) => agent.signOnboard(options),
    setMode,
    reconnect,
    reset,
    pause,
    resume: resumeExecution,
    stopExecution,
    sendInlineMessage,
    executionState,
  };
}

/**
 * Type guard that narrows a `ChatItem` to the specific variant identified by `type`.
 *
 * Prefer this over a raw `item.type === 'tool_call'` comparison in render code
 * because TypeScript will fully narrow the variant's unique fields inside the branch.
 *
 * @example
 * ```ts
 * if (isChatItemType(item, 'tool_call')) {
 *   console.log(item.name, item.timing_ms); // fully typed
 * }
 * ```
 */
export function isChatItemType<T extends ChatItem['type']>(
  item: ChatItem,
  type: T
): item is Extract<ChatItem, { type: T }> {
  return item.type === type;
}

/** @deprecated Use isChatItemType instead */
export const isEventType = isChatItemType;
