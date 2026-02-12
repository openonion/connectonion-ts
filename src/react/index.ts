/**
 * React hook for connecting to remote agents with automatic session persistence.
 *
 * @example
 * ```tsx
 * import { useAgent } from 'connectonion/react'
 *
 * function Chat() {
 *   const { status, ui, input, reset } = useAgent('0x123abc')
 *
 *   return (
 *     <div>
 *       {ui.map(event => <div key={event.id}>{event.type}</div>)}
 *       <button onClick={() => input('Hello')}>Send</button>
 *     </div>
 *   )
 * }
 * ```
 */

import { useEffect, useRef } from 'react';
import { create, StoreApi, UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  connect,
  RemoteAgent,
  Response,
  ChatItem,
  AgentStatus,
  ConnectOptions,
} from '../connect';

// Re-export types and utilities
export type {
  Response,
  ChatItem,
  ChatItemType,
  AgentStatus,
  ConnectOptions,
  AgentInfo,
} from '../connect';

export { fetchAgentInfo } from '../connect';

/** @deprecated Use ChatItem instead */
export type UIEvent = ChatItem;

// =============================================================================
// Storage Structure
// =============================================================================

/**
 * localStorage structure:
 *
 * co:agent:{address}:session:{sessionId}
 *   → { messages, ui, createdAt, updatedAt }
 *   → Each session stored separately by sessionId
 *
 * Future: useSessions hook for session management
 */

// =============================================================================
// Types
// =============================================================================

/** Message in conversation */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ name: string; arguments: unknown; id: string }>;
}

/** Store state */
interface AgentState {
  messages: Message[];
  ui: ChatItem[];
  status: AgentStatus;
  error: Error | null;
  createdAt: number;
  updatedAt: number;
}

/** Store actions */
interface AgentActions {
  setStatus: (status: AgentStatus) => void;
  setUI: (ui: ChatItem[]) => void;
  setError: (error: Error | null) => void;
  updateMessages: (messages: Message[]) => void;
  reset: () => void;
}

type AgentStore = AgentState & AgentActions;

// =============================================================================
// Utilities
// =============================================================================

function createInitialState(): AgentState {
  const now = Date.now();
  return {
    messages: [],
    ui: [],
    status: 'idle',
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// Store Factory
// =============================================================================

const storeCache = new Map<string, UseBoundStore<StoreApi<AgentStore>>>();

function createAgentStore(address: string, sessionId: string) {
  return create<AgentStore>()(
    persist(
      (set) => ({
        ...createInitialState(),

        setStatus: (status) => set({ status }),

        setUI: (ui) => set({ ui, updatedAt: Date.now() }),

        setError: (error) => set({ error }),

        updateMessages: (messages) => set({ messages, updatedAt: Date.now() }),

        reset: () => set(createInitialState()),
      }),
      {
        name: `co:agent:${address}:session:${sessionId}`,
        storage: createJSONStorage(() => (globalThis as any).localStorage),
        skipHydration: typeof globalThis !== 'undefined' && !(globalThis as any).localStorage,
        partialize: (state) => ({
          messages: state.messages,
          ui: state.ui,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        }),
      }
    )
  );
}

function getStore(address: string, sessionId: string) {
  const key = `${address}:${sessionId}`;
  let store = storeCache.get(key);
  if (!store) {
    store = createAgentStore(address, sessionId);
    storeCache.set(key, store);
  }
  return store;
}

// =============================================================================
// useAgent Hook
// =============================================================================

export interface UseAgentReturn {
  status: AgentStatus;
  ui: ChatItem[];
  sessionId: string;
  isProcessing: boolean;
  error: Error | null;
  input: (prompt: string, timeoutMs?: number) => Promise<Response>;
  respond: (answer: string | string[]) => void;
  respondToApproval: (approved: boolean, scope?: 'once' | 'session', mode?: 'reject_soft' | 'reject_hard' | 'reject_explain', feedback?: string) => void;
  submitOnboard: (options: { inviteCode?: string; payment?: number }) => void;
  reset: () => void;
}

export interface UseAgentOptions extends ConnectOptions {
  sessionId: string;
}

/**
 * React hook for connecting to a remote AI agent.
 * Session automatically persists to localStorage by sessionId.
 *
 * @param address - Agent's public address (0x...)
 * @param options - Connection options with required sessionId
 */
export function useAgent(
  address: string,
  options: UseAgentOptions
): UseAgentReturn {
  const { sessionId, ...connectOptions } = options;
  const useStore = getStore(address, sessionId);

  // State from store
  const messages = useStore((s) => s.messages);
  const ui = useStore((s) => s.ui);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);

  // Actions from store
  const setStatus = useStore((s) => s.setStatus);
  const setUI = useStore((s) => s.setUI);
  const setError = useStore((s) => s.setError);
  const updateMessages = useStore((s) => s.updateMessages);
  const resetStore = useStore((s) => s.reset);

  // RemoteAgent instance (keyed by address + sessionId)
  const agentRef = useRef<RemoteAgent | null>(null);
  const keyRef = useRef<string>(`${address}:${sessionId}`);

  // Reset agent if address or sessionId changes
  if (keyRef.current !== `${address}:${sessionId}`) {
    agentRef.current = null;
    keyRef.current = `${address}:${sessionId}`;
  }

  if (!agentRef.current) {
    agentRef.current = connect(address, connectOptions);
  }
  const agent = agentRef.current;

  // Restore session to agent on mount or when sessionId changes
  useEffect(() => {
    if (messages.length > 0) {
      (agent as any)._currentSession = {
        session_id: sessionId,
        messages: messages,
      };
      // Restore UI events
      (agent as any)._chatItems = [...ui];
    }
  }, [sessionId]);

  const input = async (prompt: string, timeoutMs?: number): Promise<Response> => {
    setError(null);
    setStatus('working');

    // Set session before request
    (agent as any)._currentSession = {
      session_id: sessionId,
      messages: messages,
    };

    // Poll for UI updates
    const pollInterval = setInterval(() => {
      setUI([...agent.ui]);
      setStatus(agent.status);
    }, 50);

    try {
      const response = await agent.input(prompt, timeoutMs);

      // Persist messages
      if (agent.currentSession?.messages) {
        updateMessages(agent.currentSession.messages as Message[]);
      }

      // Final sync
      setUI([...agent.ui]);
      setStatus(agent.status);

      return response;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setStatus('idle');
      throw e;
    } finally {
      clearInterval(pollInterval);
    }
  };

  const reset = () => {
    agent.reset();
    resetStore();
  };

  const respond = (answer: string | string[]) => {
    agent.respond(answer);
  };

  const respondToApproval = (approved: boolean, scope: 'once' | 'session' = 'once', mode?: 'reject_soft' | 'reject_hard' | 'reject_explain', feedback?: string) => {
    agent.respondToApproval(approved, scope, mode, feedback);
  };

  const submitOnboard = (options: { inviteCode?: string; payment?: number }) => {
    agent.submitOnboard(options);
  };

  return {
    status,
    ui,
    sessionId,
    isProcessing: status !== 'idle',
    error,
    input,
    respond,
    respondToApproval,
    submitOnboard,
    reset,
  };
}

// =============================================================================
// Utility
// =============================================================================

export function isChatItemType<T extends ChatItem['type']>(
  item: ChatItem,
  type: T
): item is Extract<ChatItem, { type: T }> {
  return item.type === type;
}

/** @deprecated Use isChatItemType instead */
export const isEventType = isChatItemType;

// Voice input
export {
  useVoiceInput,
  type UseVoiceInputOptions,
  type UseVoiceInputReturn,
  type VoiceInputStatus,
} from './useVoiceInput';

// Browser identity (Ed25519 keys for authentication)
export {
  generateBrowser,
  saveBrowser,
  loadBrowser,
  signBrowser,
  createSignedPayloadBrowser,
  type AddressData,
} from '../address-browser';
