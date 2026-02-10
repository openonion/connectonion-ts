/**
 * @purpose Main Agent orchestrator that combines LLM reasoning with parallel tool execution, multi-turn conversations, and interactive debugging
 * @llm-note
 *   Dependencies: imports from [src/types, src/llm/index, src/console, src/tools/tool-utils, src/trust/index, node:fs, node:dotenv, node:readline] | imported by [src/index.ts] | tested by [tests/agent.test.ts, tests/e2e/*.test.ts]
 *   Data flow: receives user prompt → lazy-init messages array (system + user) → LLM loop (max 10 iterations) → parallel tool execution via Promise.all → adds tool results to messages → repeats until no tool calls → returns final text response
 *   State/Effects: mutates this.messages (persistent conversation state) | writes to Console (stderr + optional file) | reads systemPrompt from file if path provided | reads env for API keys/config
 *   Integration: exposes input(prompt, maxIterations?), resetConversation(), addTool(), removeTool(), getTools(), executeTool(), autoDebug(), getSession(), getTrust() | uses createLLM() factory | tool execution at line 285-302 (parallel) | main loop at line 221-267
 *   Performance: parallel tool execution via Promise.all | no caching | tool map for O(1) lookup | max 10 iterations default (configurable)
 *   ⚠️ messages persist across input() calls until resetConversation() | @xray tools pause execution in debug mode | tool errors returned to LLM for retry
 */

import {
  AgentConfig,
  Tool,
  LLM,
  Message,
  ToolResult
} from '../types';
import { createLLM } from '../llm';
import { Console } from '../console';
import { processTools } from '../tools/tool-utils';
import { injectXrayContext, clearXrayContext } from '../tools/xray';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as readline from 'readline';
import { createTrustAgent, getDefaultTrustLevel } from '../trust';

// Load environment variables from local .env only; if not present, env stays empty
dotenv.config();

/**
 * Agent class - The core of ConnectOnion
 * 
 * An Agent combines:
 * - LLM for intelligence and reasoning
 * - Tools for taking actions
 * - In-memory session (messages + trace)
 * - System prompts for personality
 * 
 * @example
 * ```typescript
 * // Create a simple agent with a calculator tool
 * function add(a: number, b: number): number {
 *   return a + b;
 * }
 * 
 * const agent = new Agent({
 *   name: 'calculator',
 *   tools: [add],
 *   systemPrompt: 'You are a helpful math assistant.'
 * });
 * 
 * const response = await agent.input('What is 5 plus 3?');
 * console.log(response); // "5 plus 3 equals 8"
 * ```
 */
export class Agent {
  /** Unique identifier for this agent */
  private name: string;

  /** System prompt that defines the agent's behavior and personality */
  private systemPrompt: string;

  /** Maximum number of iterations for tool calling loops */
  private maxIterations: number;

  /** Array of tools available to this agent */
  private tools: Tool[];

  /** Quick lookup map for tools by name */
  private toolMap: Map<string, Tool>;

  /** LLM instance for generating responses */
  private llm: LLM;

  /** Session interface aligned with Python: messages + trace */
  // messages are tracked in this.messages; trace in this.trace

  /** Persistent conversation messages for multi-turn interactions */
  private messages: Message[] | null = null;

  /** Console for terminal + optional file logging */
  private console: Console;

  /** Current iteration counter for logging */
  private currentIteration: number = 0;
  /** Debug flag to pause at @xray tools */
  private debugEnabled = false;
  /** Trust configuration object */
  private _trust: any = null;
  /** In-memory trace entries for xray-style introspection */
  private trace: Array<{ tool_name: string; timing: number; status: string; args?: any; result?: any; iteration?: number }> = [];
  /** Last user prompt, for xray context */
  private lastUserPrompt: string | null = null;

  /**
   * Creates a new Agent instance
   * 
   * @param config - Configuration object for the agent
   * @param config.name - Unique name for the agent (used for behavior tracking)
   * @param config.llm - Optional custom LLM instance
   * @param config.tools - Array of tools (functions, class instances, or Tool objects)
   * @param config.systemPrompt - System prompt defining agent behavior
   * @param config.apiKey - API key for LLM provider (uses env var if not provided)
   * @param config.model - Model to use (default: 'gpt-4o-mini')
   * @param config.maxIterations - Max iterations for tool calling (default: 10)
   * 
   * @example
   * ```typescript
   * // With environment variable for API key
   * const agent = new Agent({
   *   name: 'my-agent',
   *   tools: [myTool1, myTool2]
   * });
   * 
   * // With explicit API key
   * const agent = new Agent({
   *   name: 'my-agent',
   *   apiKey: 'sk-...',
   *   model: 'gpt-4',
   *   tools: [myTool]
   * });
   * ```
   */
  constructor(config: AgentConfig) {
    this.name = config.name;
    // Support systemPrompt as raw string or a file path (if exists)
    let systemPrompt = config.systemPrompt;
    if (systemPrompt && typeof systemPrompt === 'string' && fs.existsSync(systemPrompt)) {
      try {
        systemPrompt = fs.readFileSync(systemPrompt, 'utf-8');
      } catch {
        // ignore file read errors and use as-is
      }
    }
    this.systemPrompt = systemPrompt || `You are ${config.name}, a helpful AI assistant.`;
    this.maxIterations = config.maxIterations || 10;

    // Process tools: convert functions, class instances, etc. to Tool objects
    this.tools = processTools(config.tools || []);

    // Create a map for O(1) tool lookup by name
    this.toolMap = new Map(this.tools.map(tool => [tool.name, tool]));

    // No persistent history: align with Python current_session semantics

    // Setup console logging
    let logFile: string | undefined;
    if (process.env.CONNECTONION_LOG) {
      logFile = process.env.CONNECTONION_LOG;
    } else if (config.log === true) {
      logFile = `${this.name}.log`;
    } else if (typeof config.log === 'string') {
      logFile = config.log;
    } else if (config.log === false) {
      logFile = undefined;
    } else {
      // Default to .co/logs/{name}.log in current working directory
      logFile = `.co/logs/${this.name}.log`;
    }
    this.console = new Console(logFile);

    // Initialize LLM - either use provided instance or create one
    if (config.llm) {
      this.llm = config.llm;
    } else {
      // Create LLM based on model name
      // Default to Anthropic Claude Sonnet 3.5 if unspecified
      this.llm = createLLM(config.model || 'claude-3-5-sonnet-20241022', config.apiKey);
    }

    // Trust parameter handling
    const trustLevel = (typeof config.trust === 'string') ? config.trust : undefined;
    const tl = (trustLevel === 'open' || trustLevel === 'careful' || trustLevel === 'strict') ? trustLevel as any : undefined;
    const finalTrust = tl || getDefaultTrustLevel();
    this._trust = createTrustAgent(finalTrust);
  }

  /**
   * Process user input and generate a response
   * 
   * This is the main entry point for interacting with the agent.
   * The agent will:
   * 1. Process the input prompt
   * 2. Decide whether to use tools
   * 3. Execute any necessary tool calls
   * 4. Generate a final response
   * 
   * @param prompt - The user's input prompt
   * @param maxIterations - Override the default max iterations for this request
   * @returns The agent's response as a string
   * 
   * @example
   * ```typescript
   * const response = await agent.input('What is the weather in NYC?');
   * console.log(response);
   * 
   * // With custom iteration limit for complex tasks
   * const response = await agent.input(
   *   'Analyze this data and create a report',
   *   20 // Allow more iterations for complex task
   * );
   * ```
   */
  async input(prompt: string, maxIterations?: number): Promise<string> {
    const iterations = maxIterations || this.maxIterations;

    // Record input implicitly via messages; no persistent history

    this.console.print(`INPUT: ${prompt.slice(0, 100)}...`);

    // Lazy-init persistent conversation
    if (!this.messages) {
      this.messages = [{ role: 'system', content: this.systemPrompt }];
    }

    // Add user message
    this.messages.push({ role: 'user', content: prompt });
    this.lastUserPrompt = prompt;

    // Convert tools to OpenAI-compatible function schemas
    const toolSchemas = this.tools.map(tool => tool.toFunctionSchema());

    let finalResponse = '';

    // Main execution loop - allows for multiple rounds of tool calling
    for (let i = 0; i < iterations; i++) {
      this.currentIteration = i + 1;
      // Call LLM with current conversation and available tools
      const reqStart = Date.now();
      this.console.print(`→ LLM Request (${(this as any).llm?.model || 'llm'})`);
      const llmResponse = await this.llm.complete(this.messages, toolSchemas);
      const reqMs = Date.now() - reqStart;
      this.console.print(`← LLM Response (${reqMs}ms)`);

      // No persistent history; record via messages only

      // Add assistant's response to the conversation
      if (llmResponse.content || llmResponse.toolCalls.length > 0) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: llmResponse.content || '',
        };

        // Include tool calls in the message if present
        if (llmResponse.toolCalls.length > 0) {
          assistantMessage.tool_calls = llmResponse.toolCalls;
        }

        this.messages.push(assistantMessage);
      }

      // Process tool calls if the LLM requested any
      if (llmResponse.toolCalls.length > 0) {
        // Execute all tool calls in parallel for efficiency
        const toolResults = await this.executeToolCalls(llmResponse.toolCalls);

        // Add tool results back to the conversation
        // This allows the LLM to see the results and continue reasoning
        for (const result of toolResults) {
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(result.result),
            tool_call_id: result.callId,
          });
        }
      } else {
        // No more tool calls - we have our final response
        finalResponse = llmResponse.content || '';
        break;
      }
    }

    this.console.print(`✓ Complete`);

    return finalResponse;
  }

  /**
   * Execute multiple tool calls in parallel
   * 
   * @param toolCalls - Array of tool calls to execute
   * @returns Array of results with their corresponding call IDs
   * 
   * @private
   */
  private async executeToolCalls(
    toolCalls: Array<{ name: string; arguments: any; id: string }>
  ): Promise<Array<{ result: ToolResult; callId: string }>> {
    // Execute all tool calls in parallel using Promise.all
    // This significantly improves performance when multiple tools are called
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const result = await this.executeToolCall(
          toolCall.name,
          toolCall.arguments,
          toolCall.id
        );
        return { result, callId: toolCall.id };
      })
    );

    return results;
  }

  /**
   * Execute a single tool call
   * 
   * @param name - Name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @param callId - Unique identifier for this tool call
   * @returns The result of the tool execution
   * 
   * @private
   */
  private async executeToolCall(
    name: string,
    args: any,
    callId: string
  ): Promise<ToolResult> {
    // Look up the tool by name
    const tool = this.toolMap.get(name);

    // Handle case where tool doesn't exist
    if (!tool) {
      const result: ToolResult = {
        status: 'not_found',
        error: `Tool ${name} not found`,
      };
      return result;
    }

    // Prepare xray context before execution
    const previousTools = this.trace.map(t => t.tool_name);
    injectXrayContext(
      this,
      this.lastUserPrompt || '',
      this.messages || [],
      this.currentIteration,
      previousTools
    );
    try {
      // If debugger enabled and tool is marked as @xray, pause before execution
      if (this.debugEnabled && (tool as any).xray) {
        const maybeArgs = await this.pauseAtBreakpoint(tool, args);
        if (maybeArgs && (maybeArgs as any).__skip__) {
          const result: ToolResult = { status: 'success', result: '[debugger: skipped]' };
          return result;
        }
        if (maybeArgs) args = maybeArgs;
      }
      // Execute the tool with provided arguments (no catch: let errors surface)
      const t0 = Date.now();
      const output = await tool.run(args);
      const result: ToolResult = { status: 'success', result: output };
      const dt = Date.now() - t0;
      this.trace.push({ tool_name: name, timing: dt, status: 'success', args, result: output, iteration: this.currentIteration });
      if ((tool as any).xray || this.debugEnabled) {
        this.console.printXray(name, args, output, dt, { agent: this.name, iteration: this.currentIteration, userPrompt: this.lastUserPrompt || undefined });
      } else {
        const rs = String(output);
        const preview = rs.length > 120 ? rs.slice(0, 120) + '...' : rs;
        this.console.print(`← Result (${(dt / 1000).toFixed(dt < 100 ? 4 : 1)}s): ${preview}`);
      }
      // Silence unused var warning by referencing callId in a no-op
      void callId;
      return result;
    } finally {
      clearXrayContext();
    }
  }

  /** Pause at @xray breakpoint with basic interactive menu */
  private async pauseAtBreakpoint(tool: Tool, args: any): Promise<any> {
    this.console.print(`@xray breakpoint: ${tool.name}`);
    this.console.print(`arguments: ${JSON.stringify(args)}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const ask = (q: string) => new Promise<string>(res => rl.question(q, ans => res(ans)));
    const cmd = (await ask('debug> [c]ontinue, [e]dit args, [s]kip: ')).trim().toLowerCase();
    if (cmd === 'e' || cmd === 'edit') {
      const text = await ask('args JSON> ');
      rl.close();
      try {
        const parsed = JSON.parse(text);
        return parsed;
      } catch (e) {
        this.console.print(`✗ Invalid JSON, continuing with original args`);
        return args;
      }
    }
    if (cmd === 's' || cmd === 'skip') {
      rl.close();
      return { __skip__: true };
    }
    rl.close();
    return args;
  }

  /** Start a debugging session. If prompt provided, runs single session. */
  async autoDebug(prompt?: string): Promise<string | void> {
    this.debugEnabled = true;
    if (prompt) {
      const res = await this.input(prompt);
      this.debugEnabled = false;
      return res;
    }
    // Interactive loop
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const ask = (q: string) => new Promise<string>(res => rl.question(q, ans => res(ans)));
    this.console.print('Entering interactive debug mode. Press Enter on empty line to exit.');
    while (true) {
      const line = await ask('task> ');
      if (!line.trim()) break;
      try { await this.input(line.trim()); } catch (e) { this.console.print(`✗ Error: ${String(e)}`); }
    }
    rl.close();
    this.debugEnabled = false;
    return;
  }

  /** Get trust configuration */
  getTrust() { return this._trust; }

  /**
   * Get the current in-memory session (messages + tool execution trace)
   */
  getSession() {
    return {
      messages: this.messages || [],
      trace: this.trace,
      iteration: this.currentIteration,
      user_prompt: this.lastUserPrompt || ''
    };
  }

  /**
   * Clear the in-memory tool execution trace for this session
   */
  clearHistory() {
    // No persistent history; clear in-memory trace only
    this.trace = [];
  }

  /**
   * Get all available tools for this agent
   * 
   * @returns Array of Tool objects
   * 
   * @example
   * ```typescript
   * const tools = agent.getTools();
   * console.log('Available tools:');
   * tools.forEach(tool => {
   *   console.log(`- ${tool.name}: ${tool.description}`);
   * });
   * ```
   */
  getTools(): Tool[] {
    return this.tools;
  }

  /**
   * List tool names for quick inspection
   */
  listTools(): string[] {
    return this.tools.map(t => t.name);
  }

  /**
   * Dynamically add a new tool to the agent
   * 
   * @param tool - Tool to add (function, class instance, or Tool object)
   * 
   * @example
   * ```typescript
   * // Add a function as a tool
   * function newTool(param: string): string {
   *   return `Processed: ${param}`;
   * }
   * agent.addTool(newTool);
   * 
   * // Add a class instance
   * class MyService {
   *   getData(): string { return 'data'; }
   * }
   * agent.addTool(new MyService());
   * ```
   */
  addTool(tool: Tool | Function | any): void {
    const processed = processTools([tool]);
    for (const t of processed) {
      this.tools.push(t);
      this.toolMap.set(t.name, t);
    }
  }

  /**
   * Remove a tool by name
   * 
   * @param name - Name of the tool to remove
   * @returns true if the tool was found and removed, false otherwise
   * 
   * @example
   * ```typescript
   * const removed = agent.removeTool('oldTool');
   * if (removed) {
   *   console.log('Tool removed successfully');
   * }
   * ```
   */
  removeTool(name: string): boolean {
    const index = this.tools.findIndex(t => t.name === name);
    if (index !== -1) {
      this.tools.splice(index, 1);
      this.toolMap.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Execute a single tool by name with arguments (manual invocation)
   */
  async executeTool(name: string, args: Record<string, any> = {}): Promise<ToolResult> {
    const callId = `manual_${name}_${Date.now()}`;
    return this.executeToolCall(name, args, callId);
  }

  /**
   * Reset the conversation, keeping tools and configuration intact
   */
  resetConversation(): void {
    this.messages = null;
    this.trace = [];
  }
}
