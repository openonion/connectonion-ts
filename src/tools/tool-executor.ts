/**
 * @purpose Standalone tool executor with detailed trace entry creation for timing, status, and error tracking (migrated from Python tool_executor.py)
 *
 * @graph Tool Execution & Trace Recording
 *
 *   executeSingleTool(name, args, id, toolMap)
 *        │
 *        ▼
 *   ┌──────────────┐    ┌───────────────────────────────────────┐
 *   │ toolMap.get() │───▶│ Found?                                │
 *   └──────────────┘    └───────┬──────────────┬────────────────┘
 *                            Yes│              │No
 *                               ▼              ▼
 *                    ┌──────────────┐   TraceEntry {
 *                    │  START timer │     status: 'not_found'
 *                    │  Date.now()  │   }
 *                    └──────┬───────┘
 *                           │
 *                           ▼
 *                    ┌──────────────┐
 *                    │ tool.run(args)│
 *                    └──────┬───────┘
 *                      ┌────┴─────┐
 *                      ▼          ▼
 *                   success     error
 *                      │          │
 *                      ▼          ▼
 *                    STOP timer (Date.now() - start)
 *                      │          │
 *                      ▼          ▼
 *                  TraceEntry { TraceEntry {
 *                   status:     status: 'error',
 *                   'success',  error: msg,
 *                   result,     error_type
 *                   timing      }
 *                  }
 *
 * @graph Batch Execution (executeAndRecordTools)
 *
 *   toolCalls[] ──▶ for each ──▶ executeSingleTool() ──▶ TraceEntry[]
 *                   (sequential)
 *
 * @llm-note
 *   Dependencies: imports from [../types, ../console] | imported by [src/core/agent.ts (planned)] | tested by [examples/test-migrations.ts]
 *   Data flow: receives toolName, toolArgs, toolMap from Agent → executes tool.run(args) → measures timing → creates TraceEntry{type, tool_name, arguments, call_id, timing, status, result, iteration, timestamp} → returns to caller
 *   State/Effects: calls console.print() for tool execution logging | awaits tool.run() which may have side effects | creates trace entries but doesn't store them (caller's responsibility)
 *   Integration: exposes executeSingleTool(toolName, toolArgs, toolId, toolMap, agent, console), executeAndRecordTools(toolCalls, toolMap, agent, console), TraceEntry interface | used for manual tool execution and batch processing
 *   Performance: async/await tool execution | timing tracked with Date.now() in milliseconds | sequential execution in executeAndRecordTools
 *   Errors: captures all tool execution errors in TraceEntry{status: 'error', error, error_type} | logs errors via console.print | returns 'not_found' status for missing tools
 */

import { Tool } from '../types';
import { Console } from '../console';

/**
 * Trace entry structure for tool execution
 */
export interface TraceEntry {
  type: 'tool_execution';
  tool_name: string;
  arguments: Record<string, any>;
  call_id: string;
  timing: number;
  status: 'pending' | 'success' | 'error' | 'not_found';
  result: string | null;
  iteration: number;
  timestamp: number;
  error?: string;
  error_type?: string;
}

/**
 * Execute a single tool and return trace entry
 *
 * Migrated directly from Python tool_executor.py:66-195
 *
 * @param toolName - Name of the tool to execute
 * @param toolArgs - Arguments to pass to the tool
 * @param toolId - ID of the tool call
 * @param toolMap - Map of tool names to Tool objects
 * @param agent - Agent instance with current session
 * @param console - Console for output
 * @returns Trace entry with execution details
 */
export async function executeSingleTool(
  toolName: string,
  toolArgs: Record<string, any>,
  toolId: string,
  toolMap: Map<string, Tool>,
  agent: any,
  console: Console
): Promise<TraceEntry> {
  // Console output
  const argsStr = JSON.stringify(toolArgs);
  const argsPreview = argsStr.length > 50 ? argsStr.slice(0, 50) + '...' : argsStr;
  console.print(`→ Tool: ${toolName}(${argsPreview})`);

  // Create single trace entry
  const traceEntry: TraceEntry = {
    type: 'tool_execution',
    tool_name: toolName,
    arguments: toolArgs,
    call_id: toolId,
    timing: 0,
    status: 'pending',
    result: null,
    iteration: agent.currentIteration || 0,
    timestamp: Date.now()
  };

  // Check if tool exists
  const tool = toolMap.get(toolName);
  if (!tool) {
    const errorMsg = `Tool '${toolName}' not found`;
    traceEntry.result = errorMsg;
    traceEntry.status = 'not_found';
    traceEntry.error = errorMsg;
    console.print(`✗ ${errorMsg}`);
    return traceEntry;
  }

  // Execute the tool with timing
  const toolStart = Date.now();
  try {
    const result = await tool.run(toolArgs);
    const toolDuration = Date.now() - toolStart;

    traceEntry.timing = toolDuration;
    traceEntry.result = String(result);
    traceEntry.status = 'success';

    // Console output
    const resultStr = String(result);
    const resultPreview = resultStr.length > 50 ? resultStr.slice(0, 50) + '...' : resultStr;
    const timeStr = toolDuration < 100 ? `${(toolDuration / 1000).toFixed(4)}s` : `${(toolDuration / 1000).toFixed(1)}s`;
    console.print(`← Result (${timeStr}): ${resultPreview}`);

  } catch (e) {
    const toolDuration = Date.now() - toolStart;

    traceEntry.timing = toolDuration;
    traceEntry.status = 'error';
    traceEntry.error = e instanceof Error ? e.message : String(e);
    traceEntry.error_type = e instanceof Error ? e.constructor.name : typeof e;
    traceEntry.result = `Error executing tool: ${traceEntry.error}`;

    const timeStr = toolDuration < 100 ? `${(toolDuration / 1000).toFixed(4)}s` : `${(toolDuration / 1000).toFixed(1)}s`;
    console.print(`✗ Error (${timeStr}): ${traceEntry.error}`);
  }

  return traceEntry;
}

/**
 * Execute multiple tools and record results
 *
 * Migrated from Python tool_executor.py:24-64
 *
 * @param toolCalls - List of tool calls from LLM response
 * @param toolMap - Map of tool names to Tool objects
 * @param agent - Agent instance
 * @param console - Console for output
 */
export async function executeAndRecordTools(
  toolCalls: Array<{ name: string; arguments: any; id: string }>,
  toolMap: Map<string, Tool>,
  agent: any,
  console: Console
): Promise<void> {
  // Execute each tool
  for (const toolCall of toolCalls) {
    const traceEntry = await executeSingleTool(
      toolCall.name,
      toolCall.arguments,
      toolCall.id,
      toolMap,
      agent,
      console
    );

    // Add trace entry to agent session
    if (agent.trace) {
      agent.trace.push(traceEntry);
    }
  }
}
