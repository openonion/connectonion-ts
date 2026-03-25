/**
 * @llm-note
 *   Dependencies: imports from [src/address (type-only)] | imported by [all connect/ files, src/react/]
 *   Data flow: defines interfaces used by RemoteAgent for WebSocket message parsing → ChatItem union rendered by UI consumers → SessionState synced between client/server
 *   State/Effects: pure type definitions, no runtime logic or side effects
 *   Integration: exports Response, ChatItem (14-variant union), ChatItemType, WebSocketLike, WebSocketCtor, ResolvedEndpoint, AgentInfo, ConnectOptions, SessionState, ApprovalMode, AgentStatus, ConnectionState
 */
import type * as address from '../address';

export type { AddressData } from '../address';

export interface Response {
  text: string;
  done: boolean;
}

export type ChatItemType = 'user' | 'agent' | 'thinking' | 'tool_call' | 'ask_user' | 'approval_needed' | 'onboard_required' | 'onboard_success' | 'intent' | 'eval' | 'compact' | 'tool_blocked' | 'ulw_turns_reached' | 'plan_review';

export type ChatItem =
  | { id: string; type: 'user'; content: string; images?: string[]; files?: FileAttachment[] }
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
  | { id: string; type: 'tool_blocked'; tool: string; reason: string; message: string; command?: string }
  | { id: string; type: 'ulw_turns_reached'; turns_used: number; max_turns: number }
  | { id: string; type: 'plan_review'; plan_content: string };

export type WebSocketLike = {
  onopen: ((ev?: unknown) => unknown) | null;
  onmessage: ((ev: { data: unknown }) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  onclose: ((ev: unknown) => unknown) | null;
  send(data: unknown): void;
  close(): void;
};

export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface ResolvedEndpoint {
  httpUrl: string;
  wsUrl: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
}

export interface AgentInfo {
  address: string;
  name?: string;
  tools?: string[];
  skills?: SkillInfo[];
  trust?: string;
  version?: string;
  online: boolean;
}

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
}

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

export type ApprovalMode = 'safe' | 'plan' | 'accept_edits' | 'ulw';

export type AgentStatus = 'idle' | 'working' | 'waiting';

export type ConnectionState = 'disconnected' | 'connected' | 'reconnecting';

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export type OutgoingMessage = Record<string, unknown>;
