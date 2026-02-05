/**
 * @purpose LLM factory that routes model names to appropriate providers (Anthropic, OpenAI, Gemini, OpenOnion) with graceful fallback to NoopLLM
 *
 * @graph Model Routing Decision Tree
 *
 *                    createLLM(model, apiKey?)
 *                            │
 *                            ▼
 *                  ┌───────────────────┐
 *                  │ model.startsWith? │
 *                  └─────────┬─────────┘
 *                            │
 *          ┌─────────┬───────┼────────┬──────────┐
 *          ▼         ▼       ▼        ▼          ▼
 *       "co/*"   "claude"  "gpt-"   "gemini"  (other)
 *          │         │     / "o"      │          │
 *          ▼         ▼       ▼        ▼          ▼
 *    ┌──────────┐┌────────┐┌──────┐┌────────┐┌────────┐
 *    │ OpenAI   ││Anthropic││OpenAI││ Gemini ││Anthropic│
 *    │ +baseURL ││  LLM   ││ LLM  ││  LLM   ││(default)│
 *    └─────┬────┘└───┬────┘└──┬───┘└───┬────┘└───┬────┘
 *          │         │        │        │         │
 *          └─────────┴────────┴────────┴─────────┘
 *                            │
 *                     on error → NoopLLM
 *                     (descriptive message)
 *
 * @graph OpenOnion (co/*) URL Resolution
 *
 *   OPENONION_BASE_URL set? ──yes──▶ use that URL
 *          │ no
 *          ▼
 *   OPENONION_DEV=1 or    ──yes──▶ http://localhost:8000/v1
 *   ENVIRONMENT=development
 *          │ no
 *          ▼
 *   https://oo.openonion.ai/v1
 *
 * @llm-note
 *   Dependencies: imports from [src/types.ts, src/llm/openai.ts, src/llm/anthropic.ts, src/llm/gemini.ts, src/llm/noop.ts] | imported by [src/core/agent.ts, src/index.ts] | tested indirectly via agent tests
 *   Data flow: receives model string + optional apiKey → pattern matches model name (co/*, claude*, gpt-*, o*, gemini*) → instantiates provider → catches errors and returns NoopLLM with descriptive message
 *   State/Effects: no state, pure factory function | reads env OPENONION_DEV/ENVIRONMENT for baseURL selection
 *   Integration: exports createLLM(model, apiKey) + all provider classes | default model 'claude-3-5-sonnet-20241022' | co/* models use OpenOnion proxy (localhost:8000 dev, oo.openonion.ai prod)
 *   ⚠️ try-catch around each provider instantiation prevents crashes from missing API keys or SDKs
 */

import { LLM } from '../types';
import { OpenAILLM } from './openai';
import { AnthropicLLM } from './anthropic';
import { NoopLLM } from './noop';
import { GeminiLLM } from './gemini';

export { OpenAILLM } from './openai';
export { AnthropicLLM } from './anthropic';
export { GeminiLLM } from './gemini';

/**
 * Create an LLM instance based on the model name
 */
export function createLLM(model: string = 'claude-3-5-sonnet-20241022', apiKey?: string): LLM {
  // Route based on model like the Python SDK
  const isCo = model.startsWith('co/');
  const m = isCo ? model.slice(3) : model;

  // co/ models use an OpenAI-compatible endpoint via baseURL
  if (isCo) {
    const baseURL = process.env.OPENONION_BASE_URL
      || (process.env.OPENONION_DEV || process.env.ENVIRONMENT === 'development' ? 'http://localhost:8000/v1' : 'https://oo.openonion.ai/v1');
    try {
      return new OpenAILLM(apiKey, m, { baseURL });
    } catch (err) {
      return new NoopLLM('OpenOnion (co/) model requires OPENONION_API_KEY. Run `co auth` or set env.');
    }
  }

  // Anthropic (Claude) models
  if (m.startsWith('claude')) {
    try {
      return new AnthropicLLM(apiKey, m);
    } catch (err) {
      return new NoopLLM('Anthropic requires ANTHROPIC_API_KEY and @anthropic-ai/sdk installed.');
    }
  }

  // OpenAI models
  if (m.startsWith('gpt-') || m.startsWith('o')) {
    try {
      return new OpenAILLM(apiKey, m);
    } catch (err) {
      return new NoopLLM('OpenAI requires OPENAI_API_KEY set or pass apiKey.');
    }
  }

  // Gemini models
  if (m.startsWith('gemini')) {
    try {
      return new GeminiLLM(apiKey, m);
    } catch (err) {
      return new NoopLLM('Gemini requires GEMINI_API_KEY/GOOGLE_API_KEY and @google/generative-ai installed.');
    }
  }

  // Default to Anthropic preference; fallback to OpenAI if fails
  try {
    return new AnthropicLLM(apiKey, 'claude-3-5-sonnet-20241022');
  } catch {
    return new NoopLLM('No supported LLM configured. Provide model/apiKey or set env.');
  }
}
