/**
 * @purpose Simple one-shot completion helper for quick LLM queries without creating an Agent (Python parity with llm_do)
 * @llm-note
 *   Dependencies: imports from [src/llm/index.ts (createLLM), src/types.ts (Message)] | imported by [src/index.ts] | tested by manual examples
 *   Data flow: receives prompt: string + options → creates messages array with optional system → calls createLLM(model).complete(messages) → returns response.content string
 *   State/Effects: makes LLM API call via provider | no persistent state | returns text content only (discards tool_calls)
 *   Integration: exposes llmDo(prompt, options?) where options: {model?, apiKey?, system?, temperature?} | delegates to createLLM factory | default model from createLLM ('claude-3-5-sonnet-20241022')
 *   Performance: creates new LLM instance per call (no caching) | single API request
 *   Errors: throws from LLM provider (API errors, network errors, invalid model names) | no error handling (fails fast)
 * @example
 *   const text = await llmDo('Hello', { model: 'gpt-4o-mini' })
 */
import { createLLM } from './index';
import type { Message } from '../types';

export interface LlmDoOptions {
  model?: string;
  apiKey?: string;
  system?: string;
  temperature?: number;
}

export async function llmDo(prompt: string, opts: LlmDoOptions = {}): Promise<string> {
  const { model, apiKey, system } = opts;
  const llm = createLLM(model, apiKey);

  const messages: Message[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const res = await llm.complete(messages);
  return res.content ?? '';
}

