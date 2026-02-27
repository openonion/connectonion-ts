import type * as address from '../address';

export type { AddressData } from '../address';

// ============================================================================
// Response Type
// ============================================================================

export interface Response {
  text: string;
  done: boolean;
}

// ============================================================================
// Chat Item Types (data for rendering chat UI)
// ============================================================================

export type ChatItemType = 'user' | 'agent' | 'thinking' | 'tool_call' | 'ask_user' | 'approval_needed' | 'onboard_required' | 'onboard_success' | 'intent' | 'eval' | 'compact' | 'tool_blocked' | 'ulw_turns_reached';

export type ChatItem =
  | { id: string; type: 'user'; content: string; images?: string[] }
  | { id: string; type: 'agent'; content: string; images?: string[] }
  | { id: string; type: 'thinking'; status: 'running' | 'done' | 'error'; model?: string; duration_ms?: number; content?: string; kind?: string; context_percent?: number; usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } }
  | { id: string; type: 'tool_call'; name: string; args?: Record<string, unknown>; status: 'running' | 'done' | 'error'; result?: string; timing_ms?: number }
  | { id: string; type: 'ask_user'; text: string; options: string[]; multi_select: boolean }
  | { id: string; type: 'approval_needed'; tool: string; arguments: Record<string, unknown>; description?: string; batch_remaining?: Array<{ tool: string; arguments: string }> }
  | { id: string; type: 'onboard_required'; methods: string[]; paymentAmount?: number }
  | { id: string; type: 'onboard_success'; level: string; message: string }
  | { id: string; type: 'intent'; status: 'analyzing' | 'understood'; ack?: string; is_build?: boolean }
  | { id: string; type: 'eval'; status: 'evaluating' | 'done'; passed?: boolean; summary?: string; expected?: string; eval_path?: string }
  | { id: string; type: 'compact'; status: 'compacting' | 'done' | 'error'; context_before?: number; context_after?: number; context_percent?: number; message?: string; error?: string }
  | { id: string; type: 'tool_blocked'; tool: string; reason: string; message: string }
  | { id: string; type: 'ulw_turns_reached'; turns_used: number; max_turns: number };

// ============================================================================
// WebSocket Types (internal, exported for cross-file use)
// ============================================================================

export type WebSocketLike = {
  onopen: ((ev?: unknown) => unknown) | null;
  onmessage: ((ev: { data: unknown }) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  onclose: ((ev: unknown) => unknown) | null;
  send(data: unknown): void;
  close(): void;
};

export type WebSocketCtor = new (url: string) => WebSocketLike;

// ============================================================================
// Endpoint Resolution
// ============================================================================

export interface ResolvedEndpoint {
  httpUrl: string;
  wsUrl: string;
}

// ============================================================================
// Agent Info
// ============================================================================

export interface AgentInfo {
  address: string;
  name?: string;
  tools?: string[];
  trust?: string;
  version?: string;
  online: boolean;
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

// ============================================================================
// Session State
// ============================================================================

export interface SessionState {
  session_id?: string;
  messages?: Array<{ role: string; content: string }>;
  trace?: unknown[];
  turn?: number;
  mode?: 'safe' | 'plan' | 'accept_edits' | 'ulw';
  /** ULW mode: max turns before pausing */
  ulw_turns?: number;
  /** ULW mode: turns used so far */
  ulw_turns_used?: number;
}

// ============================================================================
// Agent Status & Approval Mode
// ============================================================================

export type ApprovalMode = 'safe' | 'plan' | 'accept_edits' | 'ulw';

export type AgentStatus = 'idle' | 'working' | 'waiting';
