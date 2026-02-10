/**
 * @purpose Graceful fallback LLM that throws descriptive errors when no valid provider is configured or API keys are missing
 *
 * @graph NoopLLM in Factory Pattern
 *
 *   createLLM("claude-*")
 *        │
 *        ▼
 *   new AnthropicLLM() ──catch──▶ new NoopLLM("Anthropic requires...")
 *        │                               │
 *     success                     agent.input() later
 *        │                               │
 *        ▼                               ▼
 *   LLM works                    throw Error(reason)
 *   normally                     (descriptive message)
 *
 * @llm-note
 *   Dependencies: imports from [src/types.ts (LLM, LLMResponse, Message, FunctionSchema)] | imported by [src/llm/index.ts] | no tests (error handler)
 *   Data flow: receives messages/tools → immediately throws Error with reason string → no actual LLM communication
 *   State/Effects: throws Error on complete() or structuredComplete() calls | no side effects | prevents silent failures
 *   Integration: implements LLM interface | returned by createLLM() when provider fails to initialize | used as safety net in factory pattern
 *   Performance: O(1) error throwing | no network calls | no computation
 *   Errors: always throws Error with custom reason message | fails fast on every method call
 */

import { LLM, LLMResponse, Message, FunctionSchema } from '../types';

export class NoopLLM implements LLM {
  private reason: string;
  constructor(reason?: string) {
    this.reason = reason || 'No LLM configured. Provide an LLM or set API keys.';
  }

  async complete(_messages: Message[], _tools?: FunctionSchema[]): Promise<LLMResponse> {
    throw new Error(this.reason);
  }

  async structuredComplete<T = any>(_messages: Message[], _schema: any): Promise<T> {
    throw new Error(this.reason);
  }
}
