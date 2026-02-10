/**
 * @purpose Replay decorator for re-executing last tool call with modified arguments during debugging (parity with Python @replay)
 *
 * @graph Replay Mechanism
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │  withReplay(originalFunc) → wrappedFunc          │
 *   │                                                  │
 *   │  1. Extract param names via regex                │
 *   │  2. On each call:                                │
 *   │     ┌──────────────────────────────────────┐    │
 *   │     │ lastCall = {                          │    │
 *   │     │   func: originalFunc,                 │    │
 *   │     │   thisArg,                            │    │
 *   │     │   argsArray: [arg1, arg2, ...],       │    │
 *   │     │   paramNames: ['a', 'b', ...]         │    │
 *   │     │ }                                     │    │
 *   │     └──────────────────────────────────────┘    │
 *   │  3. Execute originalFunc.apply(this, args)       │
 *   └─────────────────────────────────────────────────┘
 *
 *   replay({ b: 99 })
 *        │
 *        ▼
 *   ┌────────────────────────────────────────┐
 *   │ Merge overrides with previous args:    │
 *   │   paramNames: ['a',  'b']              │
 *   │   previous:   [1,    2]                │
 *   │   overrides:  {b: 99}                  │
 *   │   result:     [1,    99]  ◀── merged   │
 *   │                                        │
 *   │ Re-run: func.apply(thisArg, [1, 99])   │
 *   └────────────────────────────────────────┘
 *
 * @llm-note
 *   Dependencies: none (leaf node, no imports) | imported by [src/index.ts, tests/e2e/exampleAgent.test.ts] | tested by interactive debug sessions
 *   Data flow: withReplay decorator wraps function → captures func, thisArg, argsArray, paramNames on each call → stores in module-scoped lastCall → replay(overrides) re-runs with merged arguments
 *   State/Effects: mutates module-scoped lastCall object | executes wrapped functions which may have side effects | singleton pattern (one lastCall per process)
 *   Integration: exposes withReplay decorator, replay(overrides), xrayReplay(tool, overrides) | used in Agent.autoDebug() for interactive debugging | preserves function context with thisArg
 *   Performance: regex parsing of function signature to extract param names | O(1) lastCall storage | function.toString() on each wrap
 *   Errors: throws Error if replay() called before any withReplay function executed | no validation on overrides (passed directly to function)
 */

type LastCall = {
  func: Function;
  thisArg: any;
  argsArray: any[];
  paramNames: string[];
};

let lastCall: LastCall | null = null;

function getParamNames(fn: Function): string[] {
  const src = fn.toString();
  const m = src.match(/\(([^)]*)\)/);
  if (!m) return [];
  const raw = m[1].trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim().replace(/\s*=.*$/, '').replace(/\?$/, ''));
}

export function withReplay<T extends Function>(func: T): T {
  const paramNames = getParamNames(func);
  const wrapped: any = function(this: any, ...args: any[]) {
    // record before execution
    lastCall = { func, thisArg: this, argsArray: args, paramNames };
    return func.apply(this, args);
  };
  Object.defineProperty(wrapped, 'name', { value: func.name, configurable: true });
  // mark for detection if needed
  (wrapped as any).__replay_enabled__ = true;
  return wrapped as T;
}

export function xrayReplay<T extends Function>(func: T): T {
  const f = withReplay(func) as any;
  Object.defineProperty(f, '__xray__', { value: true, configurable: true });
  return f as T;
}

/**
 * Re-run the last @withReplay-decorated function call.
 * If overrides are provided, they are mapped by parameter name; unspecified
 * params keep their previous values.
 */
export function replay(overrides?: Record<string, any>): any {
  if (!lastCall) {
    throw new Error('replay(): no function to replay. Use @withReplay on a tool and call it first.');
  }
  const { func, thisArg, argsArray, paramNames } = lastCall;
  if (!overrides || Object.keys(overrides).length === 0) {
    return func.apply(thisArg, argsArray);
  }
  // Build new args array using param names
  const mapped = paramNames.length > 0
    ? paramNames.map((name, idx) => (name in overrides ? overrides[name] : argsArray[idx]))
    : argsArray;
  return func.apply(thisArg, mapped);
}

