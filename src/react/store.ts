/**
 * @purpose Zustand store factory for per-session agent state, persisted to localStorage
 * @llm-note
 *   Dependencies: imports from [zustand, zustand/middleware, src/connect/types (ChatItem, AgentStatus, SessionState)] | imported by [src/react/index.ts]
 *   Data flow: getStore(address, sessionId) → creates or retrieves cached zustand store → persisted to localStorage as co:agent:{address}:session:{sessionId}
 *   State/Effects: storeCache (module-level Map) prevents duplicate stores | each store persists messages, ui, session, timestamps to localStorage via zustand/persist | persisted state is sanitized: base64 data URLs are stripped (screenshots would blow the ~5MB localStorage quota); live images survive in memory and replays re-fetch from the server
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

const OMITTED_DATA_URL = '[image data omitted]';

function shouldPersistImageUrl(value: unknown): value is string {
  // http(s) URLs persist; base64 payloads and absurdly long URLs don't.
  return typeof value === 'string' && !value.startsWith('data:') && value.length <= 8192;
}

// One screenshot is 100KB–1MB of base64; a few of them blow the ~5MB
// localStorage quota and evict the whole session. Data URLs hide in two
// shapes, each needing a different treatment:
//   - inside strings (message content, tool results) → replace with a
//     readable placeholder
//   - as entries of an `images` array → drop them (a placeholder string
//     there would render as a broken <img>)
// The walk is recursive because server payloads nest them arbitrarily
// (ui items, session.messages, trace entries) — a missed path is a quota
// blowout, so we sweep everything instead of enumerating known spots.
function sanitizeForPersistence(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, OMITTED_DATA_URL);
  }

  if (Array.isArray(value)) {
    return value
      .map(sanitizeForPersistence)
      .filter((item) => item !== OMITTED_DATA_URL);
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'images' && Array.isArray(item)) {
        const images = item.filter(shouldPersistImageUrl);
        if (images.length) next[key] = images;
        continue;
      }
      next[key] = sanitizeForPersistence(item);
    }
    return next;
  }

  return value;
}

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
          messages: sanitizeForPersistence(state.messages) as Message[],
          ui: sanitizeForPersistence(state.ui) as ChatItem[],
          session: sanitizeForPersistence(state.session) as SessionState | null,
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
