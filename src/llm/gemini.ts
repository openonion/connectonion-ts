/**
 * @purpose Google Gemini provider with function calling support and JSON prompting fallback for structured output
 *
 * @graph Message Format Conversion (OpenAI → Gemini)
 *
 *   Message[] (OpenAI-style)              Gemini API format
 *   ┌──────────────────────┐             ┌────────────────────────┐
 *   │ {role:'system',      │   extract   │ systemInstruction:     │
 *   │  content:'You are..'}│ ──────────▶ │   "You are..."        │
 *   │ {role:'user',        │   convert   │                        │
 *   │  content:'Hello'}    │ ──────────▶ │ contents: [            │
 *   │ {role:'assistant',   │             │   {role:'user',        │
 *   │  content:'Hi'}       │ ──────────▶ │    parts:[{text:...}]},│
 *   └──────────────────────┘             │   {role:'model',       │
 *                                        │    parts:[{text:...}]} │
 *                                        │ ]                      │
 *                                        └────────────────────────┘
 *
 * @graph Tool Integration
 *
 *   FunctionSchema[]
 *        │
 *        ▼
 *   tools: [{ functionDeclarations: [{name, description, parameters}] }]
 *        │
 *        ▼
 *   client.generateContent({contents, tools, systemInstruction})
 *        │
 *        ▼
 *   response.functionCall parts ──▶ ToolCall[] {name, args, id}
 *   response.text()               ──▶ content string
 *
 * @llm-note
 *   Dependencies: imports from [@google/generative-ai via dynamic require, src/types.ts] | imported by [src/llm/index.ts, src/index.ts] | tested by [tests/e2e/realProviders.test.ts]
 *   Data flow: receives Message[] + FunctionSchema[] → converts to Gemini format (contents array, systemInstruction separate) → calls client.generateContent() → parses functionCall parts → returns LLMResponse
 *   State/Effects: makes HTTP POST to Google Gemini API | reads env GEMINI_API_KEY or GOOGLE_API_KEY | no persistent state | lazy-loads SDK to keep optional
 *   Integration: implements LLM interface | exposes complete(), structuredComplete() | default model 'gemini-1.5-flash' | converts OpenAI-style messages to Gemini contents format
 *   Performance: direct API call, no caching | tool support via functionDeclarations
 *   ⚠️ structuredComplete uses JSON prompting fallback (not native structured output API)
 */

import { LLM, LLMResponse, Message, FunctionSchema, ToolCall } from '../types';

export class GeminiLLM implements LLM {
  private client: any; // genai.GenerativeModel

  constructor(apiKey?: string, model: string = 'gemini-1.5-flash') {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error('Gemini API key required. Set GEMINI_API_KEY/GOOGLE_API_KEY or pass apiKey.');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const genai = require('@google/generative-ai');
    const googleAI = new genai.GoogleGenerativeAI(key);
    this.client = googleAI.getGenerativeModel({ model });
  }

  async complete(messages: Message[], tools?: FunctionSchema[]): Promise<LLMResponse> {
    const { contents, systemInstruction } = this.convertMessages(messages);
    const params: any = { contents };
    if (systemInstruction) params.systemInstruction = systemInstruction;

    // Minimal tools conversion to Gemini functionDeclarations
    if (tools && tools.length > 0) {
      params.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description || '',
            parameters: this.convertSchema(t.parameters),
          })),
        },
      ];
    }

    const response = await this.client.generateContent(params);
    const raw = response?.response;
    const text = raw?.text ? raw.text() : '';

    const toolCalls: ToolCall[] = [];
    const parts = raw?.candidates?.[0]?.content?.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.functionCall) {
        toolCalls.push({ name: p.functionCall.name, arguments: p.functionCall.args || {}, id: `fc_${i}` });
      }
    }

    return {
      content: text || null,
      toolCalls,
      rawResponse: response,
    };
  }

  async structuredComplete<T = any>(messages: Message[], schema: any): Promise<T> {
    // Fallback to JSON-prompt approach
    const system = `You are a JSON generator. Return ONLY valid minified JSON matching this schema: ${JSON.stringify(
      schema
    )}. No prose.`;
    const { contents } = this.convertMessages([{ role: 'system', content: system }, ...messages]);
    const response = await this.client.generateContent({ contents, generationConfig: { temperature: 0 } });
    const raw = response?.response;
    const text = raw?.text ? raw.text() : '{}';
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error(`Failed to parse structured JSON: ${String(e)} | content=${text}`);
    }
  }

  private convertMessages(messages: Message[]): { contents: any[]; systemInstruction?: string } {
    const contents: any[] = [];
    let systemInstruction: string | undefined;

    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];

      if (msg.role === 'system') {
        systemInstruction = systemInstruction ? systemInstruction + '\n' + msg.content : msg.content;
        i += 1;
        continue;
      }

      // Assistant with tool calls: add functionCall parts and then stitch following tool results
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments || {} } });
        }
        contents.push({ role: 'model', parts });

        // Collect subsequent tool result messages and convert to functionResponse
        i += 1;
        const responseParts: any[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          const toolMsg = messages[i];
          // Find matching tool name by id
          let toolName = 'unknown';
          for (const tc of msg.tool_calls) {
            if (tc.id === toolMsg.tool_call_id) { toolName = tc.name; break; }
          }
          responseParts.push({ functionResponse: { name: toolName, response: { result: toolMsg.content } } });
          i += 1;
        }
        if (responseParts.length > 0) {
          contents.push({ role: 'function', parts: responseParts });
        }
        continue;
      }

      if (msg.role === 'tool') {
        // Tool result without preceding assistant call; treat as user content
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
        i += 1;
        continue;
      }

      // Regular user/assistant messages
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
      i += 1;
    }

    return { contents, systemInstruction };
  }

  private convertSchema(parameters: any): any {
    // Gemini expects a Schema object; pass through JSON schema-like structure
    // Use permissive mapping by default
    const p = parameters || { type: 'object', properties: {}, required: [] };
    return p;
  }
}
