/**
 * @purpose Anthropic Claude provider (default SDK LLM) with native tool support and message format conversion from OpenAI-style to Claude API
 *
 * @graph Message Format Conversion (OpenAI → Anthropic)
 *
 *   Message[] (OpenAI-style)              Anthropic API format
 *   ┌──────────────────────┐             ┌────────────────────────┐
 *   │ {role:'system',      │   extract   │ system: "You are..."   │
 *   │  content:'You are..'}│ ──────────▶ │                        │
 *   │ {role:'user',        │   convert   │ messages: [            │
 *   │  content:'Hello'}    │ ──────────▶ │   {role:'user',        │
 *   │ {role:'assistant',   │             │    content:'Hello'},   │
 *   │  content:'Hi',       │ ──────────▶ │   {role:'assistant',   │
 *   │  tool_calls:[...]}   │             │    content:[           │
 *   │ {role:'tool',        │             │      {type:'text',...},│
 *   │  content:'result'}   │ ──────────▶ │      {type:'tool_use'}│
 *   └──────────────────────┘             │    ]}                  │
 *                                        │ ]                      │
 *                                        └────────────────────────┘
 *
 * @graph Tool Call Flow
 *
 *   FunctionSchema[] ──▶ convertTools() ──▶ Anthropic tool format
 *                                                   │
 *   client.messages.create({tools, messages}) ◀─────┘
 *                    │
 *                    ▼
 *   response.content[] ──▶ find type:'tool_use' ──▶ ToolCall[]
 *                     └──▶ find type:'text'     ──▶ content string
 *
 * @llm-note
 *   Dependencies: imports from [@anthropic-ai/sdk via dynamic require, src/types.ts] | imported by [src/llm/index.ts, src/index.ts] | tested by [tests/e2e/realProviders.test.ts]
 *   Data flow: receives Message[] + FunctionSchema[] → converts to Anthropic format (system separate, user/assistant alternating) → calls client.messages.create() → parses tool_use blocks → returns LLMResponse
 *   State/Effects: makes HTTP POST to Anthropic API | reads env ANTHROPIC_API_KEY | no persistent state | lazy-loads SDK to keep optional
 *   Integration: implements LLM interface | exposes complete(), structuredComplete() | default model 'claude-3-5-sonnet-20241022' | default max_tokens: 8192, temperature: 0 for determinism
 *   Performance: direct API call, no caching | native tool support via tool_use content blocks
 *   ⚠️ Anthropic requires max_tokens (hard cap may cut off mid-sentence) | messages must alternate user/assistant, first must be user
 */

import { LLM, LLMResponse, Message, FunctionSchema, ToolCall } from '../types';

export class AnthropicLLM implements LLM {
  private client: any;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(apiKey?: string, model: string = 'claude-3-5-sonnet-20241022') {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY or pass apiKey parameter.');
    }

    // Lazy-load anthropic SDK to keep it optional
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey: key });
    this.model = model;
    // Parity with Python SDK: Claude requires max_tokens. Use a safe default and allow override.
    this.defaultMaxTokens = 8192;
    // Favor deterministic results by default (can be overridden via params)
    this.defaultTemperature = 0;
  }

  async complete(messages: Message[], tools?: FunctionSchema[]): Promise<LLMResponse> {
    const { system, anthropicMessages } = this.convertMessages(messages);
    const anthropicTools = tools && tools.length > 0 ? this.convertTools(tools) : undefined;

    const params: any = {
      model: this.model,
      // Claude requires max_tokens. Default to 8192 unless caller overrides via extra params.
      max_tokens: this.defaultMaxTokens,
      messages: anthropicMessages,
      temperature: this.defaultTemperature,
    };
    if (system) params.system = system;
    if (anthropicTools) params.tools = anthropicTools;

    const response = await this.client.messages.create(params);

    const toolCalls: ToolCall[] = [];
    let content = '';
    if (response && response.content) {
      for (const block of response.content) {
        if (block.type === 'text') content += block.text;
        if (block.type === 'tool_use') {
          toolCalls.push({ name: block.name, arguments: block.input, id: block.id });
        }
      }
    }

    return {
      content: content || null,
      toolCalls,
      rawResponse: response,
    };
  }

  private convertMessages(messages: Message[]): { system?: string; anthropicMessages: any[] } {
    let system: string | undefined;
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic supports system as top-level field
        system = (system ? system + '\n' : '') + (msg.content || '');
        continue;
      }

      if (msg.role === 'tool') {
        // Tool results are appended as user message with tool_result type
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const contentBlocks: any[] = [];
        if (msg.content) contentBlocks.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: 'assistant', content: contentBlocks });
        continue;
      }

      // Regular user/assistant text messages (ensure alternation in caller usage; Anthropic expects first to be 'user')
      anthropicMessages.push({ role: msg.role, content: msg.content });
    }

    return { system, anthropicMessages };
  }

  private convertTools(tools: FunctionSchema[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {}, required: [] },
    }));
  }

  async structuredComplete<T = any>(messages: Message[], schema: any): Promise<T> {
    const { system, anthropicMessages } = this.convertMessages(messages);
    const tool = {
      name: 'return_structured_output',
      description: 'Return structured JSON matching the requested schema',
      input_schema: schema || { type: 'object', properties: {}, required: [] },
    };
    const params: any = {
      model: this.model,
      // Enforce required params per Anthropic: model, max_tokens, messages
      max_tokens: this.defaultMaxTokens,
      messages: anthropicMessages,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'return_structured_output' },
      temperature: this.defaultTemperature,
    };
    if (system) params.system = system;

    const response = await this.client.messages.create(params);
    for (const block of response.content || []) {
      if (block.type === 'tool_use' && block.name === 'return_structured_output') {
        return block.input as T;
      }
    }
    throw new Error('No structured output received from Anthropic');
  }
}
