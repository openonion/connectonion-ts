/**
 * @purpose Core type definitions that provide compile-time safety and IDE support across the entire SDK
 *
 * @graph Type Relationship Map
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                      AgentConfig                            │
 *   │  { name, llm?, tools?, systemPrompt?, model?, trust? }     │
 *   │         │        │                                          │
 *   │         ▼        ▼                                          │
 *   │       ┌───┐   ┌──────┐                                     │
 *   │       │LLM│   │Tool[]│                                     │
 *   │       └─┬─┘   └──┬───┘                                     │
 *   │         │        │                                          │
 *   │         │        ├──▶ Tool.run(args) → any                  │
 *   │         │        └──▶ Tool.toFunctionSchema() ──┐           │
 *   │         │                                       ▼           │
 *   │         │                              ┌─────────────────┐  │
 *   │         │                              │ FunctionSchema  │  │
 *   │         │                              │ {name, desc,    │  │
 *   │         │                              │  parameters}    │  │
 *   │         │                              └────────┬────────┘  │
 *   │         │                                       │           │
 *   │         ▼                                       │           │
 *   │  LLM.complete(Message[], FunctionSchema[]) <────┘           │
 *   │         │                                                   │
 *   │         ▼                                                   │
 *   │   ┌───────────┐        ┌──────────┐                        │
 *   │   │LLMResponse│───────▶│ToolCall[]│                        │
 *   │   │{content,  │        │{name,    │                        │
 *   │   │ toolCalls}│        │ args, id}│                        │
 *   │   └───────────┘        └──────────┘                        │
 *   │                                                             │
 *   │   ┌───────────┐  OpenAI-compatible message format           │
 *   │   │  Message   │  {role, content, tool_calls?, tool_call_id?}│
 *   │   └───────────┘                                             │
 *   │                                                             │
 *   │   ┌────────────┐  Tool execution result                     │
 *   │   │ ToolResult  │  {status, result?, error?}                │
 *   │   └────────────┘                                            │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * @llm-note
 *   Dependencies: none (leaf node) | imported by [src/core/agent.ts, src/llm/*.ts, src/tools/tool-utils.ts, src/index.ts] | tested by [tests/agent.test.ts]
 *   Data flow: defines interfaces → used throughout codebase for type checking → no runtime data processing
 *   State/Effects: pure type definitions, no side effects or state
 *   Integration: exports all core interfaces (Tool, LLM, Agent, Message, FunctionSchema) | consumed by all modules | OpenAI-compatible message format
 */

/**
 * Represents a tool call request from the LLM
 * @interface ToolCall
 */
export interface ToolCall {
  /** The name of the tool to call */
  name: string;
  /** Arguments to pass to the tool function */
  arguments: Record<string, any>;
  /** Unique identifier for this tool call */
  id: string;
}

/**
 * Response from an LLM completion request
 * @interface LLMResponse
 */
export interface LLMResponse {
  /** Text content from the LLM (null if only tool calls) */
  content: string | null;
  /** Array of tool calls the LLM wants to make */
  toolCalls: ToolCall[];
  /** Raw response from the underlying API */
  rawResponse: any;
}

/**
 * Represents a message in the conversation history
 * @interface Message
 */
export interface Message {
  /** The role of the message sender */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** The message content */
  content: string;
  /** Optional name for the message sender */
  name?: string;
  /** Tool calls made by the assistant */
  tool_calls?: ToolCall[];
  /** ID linking this message to a specific tool call */
  tool_call_id?: string;
}

/**
 * OpenAI-compatible function schema for tool definitions
 * @interface FunctionSchema
 */
export interface FunctionSchema {
  /** The function name */
  name: string;
  /** Description of what the function does */
  description: string;
  /** JSON Schema for the function parameters */
  parameters: {
    /** Always 'object' for function parameters */
    type: 'object';
    /** Properties schema for each parameter */
    properties: Record<string, any>;
    /** List of required parameter names */
    required?: string[];
  };
}

/**
 * Represents a tool that can be used by an agent
 * @interface Tool
 */
export interface Tool {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** Function to execute the tool with given arguments */
  run: (args: Record<string, any>) => Promise<any> | any;
  /** Converts the tool to an OpenAI function schema */
  toFunctionSchema: () => FunctionSchema;
  /** Optional: mark as @xray to pause in debugger */
  xray?: boolean;
}

/**
 * Result from executing a tool
 * @interface ToolResult
 */
export interface ToolResult {
  /** Status of the tool execution */
  status: 'success' | 'error' | 'not_found';
  /** The result value if successful */
  result?: any;
  /** Error message if failed */
  error?: string;
}


/**
 * Configuration options for creating an Agent
 * @interface AgentConfig
 */
export interface AgentConfig {
  /** Unique name for the agent (used for behavior tracking) */
  name: string;
  /** Custom LLM instance (optional, defaults to OpenAI) */
  llm?: LLM;
  /** Array of tools available to the agent */
  tools?: Tool[] | Function[] | any[];
  /** System prompt defining agent behavior */
  systemPrompt?: string;
  /** API key for the LLM provider */
  apiKey?: string;
  /** Model to use (e.g., 'gpt-4o-mini') */
  model?: string;
  /** Maximum iterations for tool calling (default: 10) */
  maxIterations?: number;
  /** Trust configuration for the agent */
  trust?: string | any; // Agent type would create circular dependency
  /** Logging: true=./{name}.log, false=off, undefined=~/.co/logs/{name}.log, or string path */
  log?: boolean | string;
}

/**
 * Interface for Language Model providers
 * @interface LLM
 */
export interface LLM {
  /**
   * Complete a conversation with optional tool support
   * @param messages - Conversation history
   * @param tools - Available tools as function schemas
   * @returns Promise resolving to the LLM response
   */
  complete(messages: Message[], tools?: FunctionSchema[]): Promise<LLMResponse>;

  /**
   * Generate structured output matching a schema.
   * Provider implementations may use native structured APIs if available,
   * otherwise they will prompt the model to return strict JSON and parse it.
   * @param messages - Conversation history
   * @param schema - JSON Schema-like object describing expected output
   */
  structuredComplete<T = any>(messages: Message[], schema: any): Promise<T>;
}
