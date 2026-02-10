/**
 * @purpose OpenAI LLM provider with support for GPT models, O-series models, and OpenOnion managed keys via configurable baseURL
 *
 * @graph API Request Flow
 *
 *   Message[] + FunctionSchema[]
 *        │
 *        ▼
 *   convertMessages() ──▶ OpenAI message format
 *        │
 *        ▼
 *   ┌─────────────────────────────────────────────┐
 *   │  client.chat.completions.create({           │
 *   │    model,                                   │
 *   │    messages,                                │
 *   │    tools: [{type:'function', function:...}],│
 *   │    tool_choice: 'auto'                      │
 *   │  })                                         │
 *   └────────────────────┬────────────────────────┘
 *                        │
 *              ┌─────────┴──────────┐
 *              ▼                    ▼
 *        message.content     message.tool_calls[]
 *              │                    │
 *              ▼                    ▼
 *        LLMResponse {        ToolCall[] {
 *          content,             name, args, id
 *          toolCalls          }
 *        }
 *
 * @graph BaseURL Override (co/* models)
 *
 *   options.baseURL ──set──▶ use options.baseURL
 *        │ unset
 *        ▼
 *   OPENAI_BASE_URL or   ──set──▶ use env URL
 *   OPENONION_BASE_URL
 *        │ unset
 *        ▼
 *   https://api.openai.com (default)
 *
 * @llm-note
 *   Dependencies: imports from [openai npm package, src/types.ts] | imported by [src/llm/index.ts, src/index.ts] | tested by [tests/e2e/realProviders.test.ts]
 *   Data flow: receives Message[] + FunctionSchema[] → converts to OpenAI format → calls client.chat.completions.create() → parses tool_calls → returns LLMResponse
 *   State/Effects: makes HTTP POST to OpenAI API (or baseURL override) | reads env OPENAI_API_KEY/OPENONION_API_KEY | no persistent state
 *   Integration: implements LLM interface | exposes complete(), structuredComplete() | default model 'o4-mini' | supports baseURL override for co/* models via createLLM factory
 *   Performance: direct API call, no caching | tool_choice: 'auto' for parallel tool execution
 */

import OpenAI from 'openai';
import { LLM, LLMResponse, Message, FunctionSchema, ToolCall } from '../types';

export class OpenAILLM implements LLM {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model: string = 'o4-mini', options?: { baseURL?: string }) {
    const key = apiKey || process.env.OPENAI_API_KEY || process.env.OPENONION_API_KEY;
    if (!key) {
      throw new Error(
        'OpenAI-compatible API key required. Set OPENAI_API_KEY (or OPENONION_API_KEY) or pass apiKey.'
      );
    }

    // Allow overriding base URL to support managed/proxy endpoints
    const envBase = process.env.OPENAI_BASE_URL || process.env.OPENONION_BASE_URL;
    const baseURL = options?.baseURL || envBase;
    this.client = new OpenAI(baseURL ? { apiKey: key, baseURL } : { apiKey: key });
    this.model = model;
  }

  async complete(messages: Message[], tools?: FunctionSchema[]): Promise<LLMResponse> {
    const openAIMessages = this.convertMessages(messages);
    
    const params: any = {
      model: this.model,
      messages: openAIMessages,
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map(tool => ({
        type: 'function',
        function: tool,
      }));
      params.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(params);
    const message = response.choices[0].message;

    // Parse tool calls
    const toolCalls: ToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
          id: tc.id,
        });
      }
    }

    return {
      content: message.content,
      toolCalls,
      rawResponse: response,
    };
  }

  private convertMessages(messages: Message[]): any[] {
    return messages.map(msg => {
      const converted: any = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.name) {
        converted.name = msg.name;
      }

      if (msg.tool_calls) {
        converted.tool_calls = msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      if (msg.tool_call_id) {
        converted.tool_call_id = msg.tool_call_id;
      }

      return converted;
    });
  }

  async structuredComplete<T = any>(messages: Message[], schema: any): Promise<T> {
    // Prefer responses.parse if available in the SDK
    const anyClient: any = this.client as any;
    try {
      if (anyClient.responses && typeof anyClient.responses.parse === 'function') {
        const response = await anyClient.responses.parse({
          model: this.model,
          input: this.convertMessages(messages),
          // Not all SDKs accept arbitrary objects; if it errors, fallback below.
          text_format: schema,
        });
        // Try common shapes for parsed output
        if (response?.output_parsed) return response.output_parsed as T;
        if (response?.parsed) return response.parsed as T;
      }
    } catch (_err) {
      // Fall through to chat JSON fallback
    }

    // Fallback: ask the model to return only JSON matching the schema
    const system = `You are a JSON generator. Return ONLY valid minified JSON matching this schema: ${JSON.stringify(
      schema
    )}. No prose.`;
    const openAIMessages = this.convertMessages([
      { role: 'system', content: system },
      ...messages,
    ]);
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: openAIMessages,
      temperature: 0,
    });
    const content = res.choices?.[0]?.message?.content || '{}';
    try {
      return JSON.parse(content) as T;
    } catch (e) {
      // Try to extract JSON substring if the model added extra text
      const match = content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error(`Failed to parse structured JSON: ${String(e)} | content=${content}`);
    }
  }
}
