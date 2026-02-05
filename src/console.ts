/**
 * @purpose Dual-output logging system (terminal + optional file) that mirrors Python SDK UX with colored terminal output and @xray tool tracing
 *
 * @graph Dual Output Flow
 *
 *   Agent / Tool Executor
 *        │
 *        ▼
 *   console.print(message)
 *        │
 *        ├──────────────────────────────┐
 *        ▼                              ▼
 *   ┌──────────────────┐     ┌───────────────────────┐
 *   │  stderr (TTY)    │     │  Log File (optional)  │
 *   │                  │     │                       │
 *   │  [HH:MM:SS]     │     │  .co/logs/{name}.log  │
 *   │  + ANSI colors   │     │  plain text, no ANSI  │
 *   │  + dim timestamp │     │  + [timestamp] prefix │
 *   └──────────────────┘     └───────────────────────┘
 *
 * @graph @xray Output Block
 *
 *   printXray(toolName, args, result, timing, context)
 *        │
 *        ▼
 *   ┌───────────────────────────────────────┐
 *   │  @xray: toolName                      │
 *   │    agent: myAgent  iter: 3            │
 *   │    args: { query: "hello" }           │
 *   │    result: "world"                    │
 *   │    timing: 42ms                       │
 *   └───────────────────────────────────────┘
 *
 * @llm-note
 *   Dependencies: imports from [node:fs, node:path] | imported by [src/core/agent.ts, src/tools/tool-executor.ts] | tested by agent tests
 *   Data flow: receives log messages/xray traces → formats with timestamps/colors → writes to stderr + optional file (.co/logs/{name}.log)
 *   State/Effects: writes to stderr via console.error | appends to logFile if configured | creates log directories with fs.mkdirSync
 *   Integration: exposes print(message), printXray(toolName, args, result, timing, context) | used by Agent for all output | ANSI color support via isTTY detection
 */

import * as fs from 'fs';
import * as path from 'path';

export class Console {
  private logPath?: string;
  private colorEnabled: boolean;

  constructor(logFile?: string) {
    this.logPath = logFile;
    this.colorEnabled = !!process.stderr.isTTY || process.env.FORCE_COLOR === '1';
    if (this.logPath) this.initLogFile();
  }

  private initLogFile() {
    const dir = path.dirname(this.logPath!);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const header = `\n============================================================\n` +
      `Session started: ${new Date().toISOString()}\n` +
      `============================================================\n\n`;
    fs.appendFileSync(this.logPath!, header, 'utf-8');
  }

  print(message: string) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const line = `${this.dim(timestamp)} ${this.stylize(message)}`;
    // stderr-like behavior
    console.error(line);
    if (this.logPath) {
      fs.appendFileSync(this.logPath, `[${timestamp}] ${this.toPlain(message)}\n`, 'utf-8');
    }
  }

  printXray(
    toolName: string,
    toolArgs: Record<string, any>,
    result: any,
    timingMs: number,
    context?: { agent?: string; iteration?: number; userPrompt?: string }
  ) {
    // Simple tabular block
    this.print(`@xray: ${toolName}`);
    if (context?.agent) this.print(`  agent: ${context.agent}`);
    if (context?.userPrompt) this.print(`  task: ${context.userPrompt.slice(0, 80)}`);
    if (context?.iteration != null) this.print(`  iteration: ${context.iteration}`);
    for (const [k, v] of Object.entries(toolArgs || {})) {
      const s = String(v);
      this.print(`  ${k}: ${s.length > 120 ? s.slice(0, 120) + '...' : s}`);
    }
    const rs = String(result);
    this.print(`  result: ${rs.length > 120 ? rs.slice(0, 120) + '...' : rs}`);
    this.print(`  timing: ${timingMs.toFixed(1)}ms`);
  }

  private toPlain(message: string): string {
    return message
      .replace(/\[[^\]]+\]/g, '')
      .replace('→', '->')
      .replace('←', '<-')
      .replace('✓', '[OK]')
      .replace('✗', '[ERROR]');
  }

  private stylize(msg: string): string {
    // Simple heuristic coloring similar to Python Rich output
    if (!this.colorEnabled) return msg;
    if (msg.startsWith('→')) return this.yellow(msg);
    if (msg.startsWith('←')) return this.green(msg);
    if (msg.startsWith('✓')) return this.green(msg);
    if (msg.startsWith('✗')) return this.red(msg);
    if (msg.startsWith('@xray')) return this.cyan(msg);
    if (msg.startsWith('INPUT:')) return this.bold(msg);
    return msg;
  }

  // Color helpers
  private code(s: string, c: number) { return this.colorEnabled ? `\x1b[${c}m${s}\x1b[0m` : s; }
  private green(s: string) { return this.code(s, 32); }
  private red(s: string) { return this.code(s, 31); }
  private yellow(s: string) { return this.code(s, 33); }
  private cyan(s: string) { return this.code(s, 36); }
  private dim(s: string) { return this.code(s, 2); }
  private bold(s: string) { return this.code(s, 1); }
}
