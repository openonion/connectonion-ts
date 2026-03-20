/**
 * @purpose Zustand store factory for per-session agent state, persisted to localStorage
 * @llm-note
 *   Dependencies: imports from [zustand, zustand/middleware, src/connect/types (ChatItem, AgentStatus, SessionState)] | imported by [src/react/index.ts]
 *   Data flow: getStore(address, sessionId) → creates or retrieves cached zustand store → persisted to localStorage as co:agent:{address}:session:{sessionId}
 *   State/Effects: storeCache (module-level Map) prevents duplicate stores | each store persists messages, ui, session, timestamps to localStorage via zustand/persist
 *   Integration: exposes getStore(), Message, AgentState, AgentActions, AgentStore types
 *   Performance: storeCache is singleton Map — O(1) lookup per address:sessionId pair | partialize() limits persisted state size
 */

import { create, StoreApi, UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChatItem, AgentStatus, SessionState } from '../connect';

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
export interface AgentState {
  messages: Message[];
  ui: ChatItem[];
  session: SessionState | null;
  status: AgentStatus;
  error: Error | null;
  createdAt: number;
  updatedAt: number;
}

/** Store actions */
export interface AgentActions {
  setStatus: (status: AgentStatus) => void;
  setUI: (ui: ChatItem[]) => void;
  setSession: (session: SessionState | null) => void;
  setError: (error: Error | null) => void;
  updateMessages: (messages: Message[]) => void;
  reset: () => void;
}

export type AgentStore = AgentState & AgentActions;

// =============================================================================
// Store Factory
// =============================================================================

function createInitialState(): AgentState {
  const now = Date.now();
  return {
    messages: [],
    ui: [],
    session: null,
    status: 'idle',
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

const storeCache = new Map<string, UseBoundStore<StoreApi<AgentStore>>>();

function createAgentStore(address: string, sessionId: string) {
  return create<AgentStore>()(
    persist(
      (set) => ({
        ...createInitialState(),

        setStatus: (status) => set({ status }),

        setUI: (ui) => set({ ui, updatedAt: Date.now() }),

        setSession: (session) => set({ session, updatedAt: Date.now() }),

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
          session: state.session,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        }),
      }
    )
  );
}

export function getStore(address: string, sessionId: string) {
  const key = `${address}:${sessionId}`;
  let store = storeCache.get(key);
  if (!store) {
    store = createAgentStore(address, sessionId);
    storeCache.set(key, store);
  }
  return store;
}
