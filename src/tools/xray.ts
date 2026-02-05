/**
 * @purpose Debugging context injection system for @xray decorated tools (migrated from Python xray.py - simplified version)
 *
 * @graph Xray Debug Lifecycle
 *
 *   Agent.input(prompt) ── main loop iteration ──┐
 *                                                │
 *                                                ▼
 *                                  ┌──────────────────────────┐
 *                                  │  injectXrayContext()      │
 *                                  │  ┌────────────────────┐  │
 *                                  │  │ xrayContext = {     │  │
 *                                  │  │   agent,            │  │
 *                                  │  │   userPrompt,       │  │
 *                                  │  │   messages,         │  │
 *                                  │  │   iteration,        │  │
 *                                  │  │   previousTools     │  │
 *                                  │  │ }                   │  │
 *                                  │  └────────────────────┘  │
 *                                  └────────────┬─────────────┘
 *                                               │
 *                                               ▼
 *                                  ┌──────────────────────────┐
 *                                  │  tool.run(args)          │
 *                                  │  ┌────────────────────┐  │
 *                                  │  │ if @xray marked:   │  │
 *                                  │  │  getXrayContext()   │  │
 *                                  │  │  → inspect/debug    │  │
 *                                  │  │  → pause execution  │  │
 *                                  │  └────────────────────┘  │
 *                                  └────────────┬─────────────┘
 *                                               │
 *                                               ▼
 *                                  ┌──────────────────────────┐
 *                                  │  clearXrayContext()       │
 *                                  │  xrayContext = {null...}  │
 *                                  └──────────────────────────┘
 *
 * @graph trace() Visual Output
 *
 *   trace() ──▶ reads agent session ──▶ stderr output:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Iteration 1:                                │
 *   │   tool_a(args) → result  [42ms] OK         │
 *   │ Iteration 2:                                │
 *   │   tool_b(args) → result  [18ms] OK         │
 *   │   tool_c(args) → error   [5ms]  FAIL       │
 *   └─────────────────────────────────────────────┘
 *
 * @llm-note
 *   Dependencies: none (leaf node) | imported by [src/core/agent.ts, src/index.ts] | tested by [examples/test-migrations.ts]
 *   Data flow: receives from Agent → injectXrayContext(agent, userPrompt, messages, iteration, previousTools) → stores in module-scoped xrayContext → tools access via getXrayContext() → clearXrayContext() after execution
 *   State/Effects: mutates module-scoped xrayContext object | no file I/O | context cleared after tool execution to prevent leakage
 *   Integration: exposes injectXrayContext(), clearXrayContext(), isXrayEnabled(func), getXrayContext(), trace(), XrayContext interface | used by Agent before/after tool execution | trace() displays visual execution history
 *   Performance: lightweight in-memory context storage | trace() uses console.error for stderr-style output
 *   Errors: trace() throws if no active agent context or empty execution history
 */

/**
 * Xray context interface - made available globally during tool execution
 */
export interface XrayContext {
  agent: any | null;
  task: string | null;
  userPrompt: string | null;
  messages: any[];
  iteration: number | null;
  previousTools: string[];
}

/**
 * Global xray context storage
 */
let xrayContext: XrayContext = {
  agent: null,
  task: null,
  userPrompt: null,
  messages: [],
  iteration: null,
  previousTools: []
};

/**
 * Inject debugging context before tool execution
 *
 * Migrated from Python xray.py:430-445
 *
 * @param agent - The Agent instance
 * @param userPrompt - Original user prompt string from agent.input()
 * @param messages - Conversation history
 * @param iteration - Current iteration number
 * @param previousTools - List of previously called tool names
 */
export function injectXrayContext(
  agent: any,
  userPrompt: string,
  messages: any[],
  iteration: number,
  previousTools: string[]
): void {
  xrayContext.agent = agent;
  xrayContext.task = userPrompt;
  xrayContext.userPrompt = userPrompt;
  xrayContext.messages = messages;
  xrayContext.iteration = iteration;
  xrayContext.previousTools = previousTools;
}

/**
 * Clear debugging context after tool execution
 *
 * Migrated from Python xray.py:448-454
 */
export function clearXrayContext(): void {
  xrayContext.agent = null;
  xrayContext.task = null;
  xrayContext.userPrompt = null;
  xrayContext.messages = [];
  xrayContext.iteration = null;
  xrayContext.previousTools = [];
}

/**
 * Check if a function has the @xray decorator
 *
 * Migrated from Python xray.py:457-467
 *
 * @param func - Function to check
 * @returns True if function is decorated with @xray
 */
export function isXrayEnabled(func: any): boolean {
  return (func as any).__xray__ === true;
}

/**
 * Get current xray context (for tools to access)
 */
export function getXrayContext(): XrayContext {
  return xrayContext;
}

/**
 * Print a visual trace of tool execution using the current xray context.
 * Throws if no active context is available.
 */
export function trace(): void {
  if (!xrayContext.agent) {
    throw new Error('xray.trace(): no active agent context');
  }
  const agent: any = xrayContext.agent;
  const task = xrayContext.task || '';
  const history: Array<any> = agent.trace || [];
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('xray.trace(): no tool execution history');
  }

  const head = `Task: ${task}`;
  // Emit compact, readable lines similar to Python output
  const lines: string[] = [head, ''];
  history.forEach((h, idx) => {
    const ms = typeof h.timing === 'number' ? h.timing : 0;
    const timeStr = ms < 100 ? `${(ms / 1000).toFixed(4)}s` : `${(ms / 1000).toFixed(1)}s`;
    const argsPreview = JSON.stringify(h.args ?? {});
    const shortArgs = argsPreview.length > 120 ? argsPreview.slice(0, 120) + '...' : argsPreview;
    const resultStr = (h.result === undefined || h.result === null) ? '' : String(h.result);
    const shortRes = resultStr.length > 120 ? resultStr.slice(0, 120) + '...' : resultStr;
    const status = h.status === 'error' ? 'ERR ✗' : `• ${timeStr}`;
    lines.push(`[${idx + 1}] ${status}  ${h.tool_name}(${shortArgs})`);
    if (shortRes) lines.push(`      OUT ← ${shortRes}`);
  });
  lines.push('');
  // Print to stderr-style to match Console behavior
  console.error(lines.join('\n'));
}
