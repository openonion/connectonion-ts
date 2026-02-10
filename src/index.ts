/**
 * @purpose Public API entry point that exports all SDK components (Agent, LLM providers, tool utilities, trust system, types)
 *
 * @graph Module Dependency Graph
 *
 *   External Consumer
 *        │
 *        ▼
 *   ┌─ index.ts ──────────────────────────────────────────────┐
 *   │  (re-exports everything)                                │
 *   │                                                         │
 *   │  ┌──────────┐  ┌──────────┐  ┌───────────┐            │
 *   │  │  Agent   │  │ createLLM│  │ Tool Utils │            │
 *   │  │(core/    │  │(llm/     │  │(tools/     │            │
 *   │  │ agent.ts)│  │ index.ts)│  │ tool-utils)│            │
 *   │  └────┬─────┘  └────┬─────┘  └─────┬─────┘            │
 *   │       │              │              │                   │
 *   │       │         ┌────┴────┐         │                   │
 *   │       │         ▼    ▼    ▼         │                   │
 *   │       │    Anthropic OpenAI Gemini  │                   │
 *   │       │       LLM    LLM   LLM     │                   │
 *   │       │                             │                   │
 *   │       └──────────┬──────────────────┘                   │
 *   │                  ▼                                      │
 *   │  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  │
 *   │  │  types   │  │ trust  │  │  xray   │  │ connect  │  │
 *   │  │(.ts)     │  │(/index)│  │(.ts)    │  │(.ts)     │  │
 *   │  └──────────┘  └────────┘  └─────────┘  └──────────┘  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * @llm-note
 *   Dependencies: imports from [src/core/agent, src/llm/*, src/tools/*, src/trust/*, src/types] | imported by external consumers | tested by all test files
 *   Data flow: no runtime logic, pure re-exports → external code imports from here → provides unified API surface
 *   State/Effects: no state or side effects | static exports only
 *   Integration: exposes Agent, createLLM, all LLM providers (OpenAILLM, AnthropicLLM, GeminiLLM), tool utils (xray, processTools, etc), trust system, all types | single source of truth for SDK imports
 */

export { Agent } from './core/agent';
export { createLLM, OpenAILLM, AnthropicLLM, GeminiLLM } from './llm';
export { 
  createToolFromFunction, 
  isClassInstance, 
  extractMethodsFromInstance,
  processTools,
  xray,
} from './tools/tool-utils';
export { trace as xrayTrace } from './tools/xray';
export { withReplay, xrayReplay, replay } from './tools/replay';
export * from './tools/email';
export * from './trust';
export * from './trust/tools';

export * from './types';
export { llmDo } from './llm/llm-do';
export { transcribe, type TranscribeOptions } from './transcribe';
export {
  connect,
  RemoteAgent,
  Response,
  ChatItem,
  ChatItemType,
  AgentStatus,
  ConnectOptions,
  SessionState,
  fetchAgentInfo,
  AgentInfo,
} from './connect';
export * as address from './address';
export * as addressBrowser from './address-browser';
