# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ConnectOnion TypeScript SDK - A framework for creating AI agents with behavior tracking. This is the TypeScript implementation of ConnectOnion, providing the same 2-line simplicity as the Python SDK with full type safety and modern async/await patterns.

**Core Philosophy**: "Keep simple things simple, make complicated things possible"

## Development Commands

### Build & Test
```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Build examples
npm run build:examples

# Watch mode for development
npm run watch

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run example tests
npm run test:examples

# Lint code
npm run lint

# Format code
npm run format
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- agent.test.ts

# Run tests with coverage
npm test -- --coverage

# Watch mode for TDD
npm run test:watch
```

## High-Level Architecture

### Core Components

1. **Agent (`src/core/agent.ts`)**: Main orchestrator
   - Combines LLM + tools + history
   - Multi-turn conversation state (lazy-init on first `input()`)
   - Main execution loop at line 221-267: max 10 iterations by default
   - Parallel tool execution via `Promise.all` (line 290)
   - Interactive debugger with `@xray` breakpoints (line 375-421)

2. **LLM Factory (`src/llm/index.ts`)**: Routes model names to providers
   - `claude-*` → Anthropic (default: `claude-3-5-sonnet-20241022`)
   - `gpt-*` / `o*` → OpenAI
   - `gemini-*` → Google Gemini
   - `co/*` → OpenOnion managed keys (dev: localhost:8000, prod: oo.openonion.ai)

3. **Tool System (`src/tools/tool-utils.ts`)**: Automatic function-to-tool conversion
   - `processTools()`: Entry point, handles functions/classes/Tool objects
   - `createToolFromFunction()`: Extracts JSDoc, parameters, types from function source
   - `extractMethodsFromInstance()`: Converts all public class methods to tools
   - `xray()`: Marks functions as debugger breakpoints

4. **Session**: In-memory (messages + trace)
   - No persistence; inspect via `agent.getSession()`
   - Records: inputs, LLM responses, tool calls, outputs
   - Auto-creates directory structure

5. **Console (`src/console.ts`)**: Dual output system
   - Terminal output + optional file logging
   - Default: `.co/logs/{name}.log` in current working directory
   - Override with `CONNECTONION_LOG` env var or `log` config option

6. **Trust System (`src/trust/`)**: Trust-level based verification
   - Three levels: `open`, `careful`, `strict`
   - Bidirectional trust (provider + consumer)
   - Environment-based defaults

### Key Patterns

#### Agent Execution Flow
1. User calls `agent.input(prompt)`
2. Lazy-init conversation messages (system + user)
3. Loop up to `maxIterations` (default 10):
   - Call LLM with conversation + tool schemas
   - If tool calls returned: execute in parallel, add results to conversation
   - If no tool calls: return final response
4. Record all behaviors to history

#### Tool Conversion
- **Functions**: Auto-extract name, JSDoc description, parameter types
- **Classes**: Extract all public methods (skip `_private` and `constructor`)
- **Preserves context**: Class methods maintain `this` binding via `apply()`

#### LLM Provider Pattern
Each provider implements:
- `complete(messages, tools)`: Chat completion with tool support
- `structuredComplete(messages, schema)`: Validated JSON output

### Type System

Core types in `src/types.ts`:
- `AgentConfig`: Agent initialization options
- `Tool`: Unified tool interface with `run()` and `toFunctionSchema()`
- `Message`: OpenAI-compatible message format
- `LLMResponse`: Standardized LLM output (content + toolCalls)
Session trace entries: `{ tool_name, timing, status, args?, result?, iteration? }`

## Environment Variables

```bash
# LLM API Keys (pick one or more)
OPENAI_API_KEY=sk-...           # For gpt-* and o* models
ANTHROPIC_API_KEY=sk-ant-...    # For claude-* models (default)
GEMINI_API_KEY=...              # For gemini-* models
GOOGLE_API_KEY=...              # Alternative for Gemini

# OpenOnion Managed Keys (optional, for co/* models)
OPENONION_API_KEY=oo-...
OPENONION_BASE_URL=https://oo.openonion.ai/v1
OPENONION_DEV=1                 # Use localhost:8000 instead

# Logging
CONNECTONION_LOG=./my-agent.log # Override default log path
```

## Code Architecture Details

### Agent State Management
- **Persistent conversation**: `this.messages` array (lazy-init, persists across `input()` calls)
- **Reset conversation**: `agent.resetConversation()` clears messages and history
- **Session & trace**: In-memory structures for conversation and tool steps

### Tool Execution
- **Parallel execution**: All tool calls in single LLM response run via `Promise.all`
- **Error handling**: Tool errors captured and returned to LLM for retry/adaptation
- **Not found handling**: Unknown tools return `status: 'not_found'` result

### Testing Strategy
- **Mock LLM**: `tests/agent.test.ts` uses MockLLM to simulate responses
- **Unit tests**: Focus on agent behavior, tool processing, error handling
- **No API calls**: All tests use mocks to avoid API dependencies
- **Coverage**: Collect from `src/**/*.ts` excluding `.d.ts` and `index.ts`

## Project Structure

```
src/
├── core/
│   └── agent.ts          # Main Agent class (orchestrator)
├── llm/
│   ├── index.ts          # LLM factory (routes model names)
│   ├── openai.ts         # OpenAI GPT/O-series provider
│   ├── anthropic.ts      # Anthropic Claude provider (default)
│   ├── gemini.ts         # Google Gemini provider
│   ├── noop.ts           # Fallback for missing config
│   └── llm-do.ts         # One-shot llmDo() helper
├── tools/
│   ├── tool-utils.ts     # Function-to-tool conversion
│   ├── tool-executor.ts  # Tool execution + trace recording
│   ├── xray.ts           # Debug context injection (@xray)
│   ├── replay.ts         # Replay decorator for debugging
│   └── email.ts          # Mock email tools for demos/tests
├── trust/
│   ├── index.ts          # Trust levels (open/careful/strict)
│   └── tools.ts          # Whitelist checks & verification
├── connect.ts            # Remote agent connection via relay
├── console.ts            # Dual logging (stderr + file)
├── types.ts              # All TypeScript interfaces
└── index.ts              # Public API exports

tests/
├── agent.test.ts         # Agent tests with MockLLM
├── tools.test.ts         # Tool system tests
└── e2e/
    ├── emailTools.test.ts    # Email tools tests
    ├── exampleAgent.test.ts  # Example agent integration
    └── realProviders.test.ts # Real LLM provider tests

examples/
├── basic-agent.ts        # Simple agent example
├── class-tools.ts        # Class-based tools example
└── test-migrations.ts    # Migration examples
```

## TypeScript Configuration

- **Target**: ES2020
- **Module**: CommonJS
- **Strict mode**: Enabled with all checks
- **Output**: `dist/` directory
- **Declarations**: Generated with source maps

## Key Implementation Notes

### Default Model
The default model is Anthropic Claude Sonnet 3.5 (`claude-3-5-sonnet-20241022`), not OpenAI. This matches the Python SDK.

### Conversation Persistence
Unlike single-turn execution, `this.messages` persists across `input()` calls for multi-turn conversations. Call `resetConversation()` to start fresh.

### Tool Parameter Mapping
Tools receive named arguments as objects, but functions expect positional parameters. The tool system maps `args: {a: 1, b: 2}` to `func(1, 2)` using parameter order from the function signature.

### Behavior Tracking Location
Use `agent.getSession()` to inspect messages and trace at runtime.

### Console Logging
By default, logs to `./.co/logs/{name}.log` in the current working directory. This differs from Python's `~/.connectonion/` default but matches project-local logging expectations.

## Common Patterns

### Creating an Agent
```typescript
import { Agent } from 'connectonion';

// With function tools
function search(query: string): string { }
const agent = new Agent({ name: 'bot', tools: [search] });

// With class tools
class API { getData(): any { } }
const agent = new Agent({ name: 'bot', tools: [new API()] });

// With custom LLM
import { OpenAILLM } from 'connectonion';
const llm = new OpenAILLM('sk-...', 'gpt-4');
const agent = new Agent({ name: 'bot', llm });
```

### Multi-turn Conversations
```typescript
// Conversation persists across calls
await agent.input('My name is Alice');
await agent.input('What is my name?'); // Agent remembers "Alice"

// Start fresh
agent.resetConversation();
await agent.input('What is my name?'); // Agent doesn't remember
```

### Dynamic Tool Management
```typescript
// Add tools at runtime
agent.addTool(newFunction);
agent.addTool(new MyClass());

// Remove tools
agent.removeTool('toolName');

// List tools
console.log(agent.listTools());
```

### Debug with @xray
```typescript
import { xray } from 'connectonion';

function criticalTool(data: any) {
  // Do something important
}

// Mark for debugging
agent.addTool(xray(criticalTool));

// Interactive debug
await agent.autoDebug('Process this data');
// Pauses at criticalTool, allows inspection/editing args
```

### Structured Output
```typescript
const result = await agent.llm.structuredComplete(messages, {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' }
  }
});
// Returns validated object matching schema
```

## Common Issues

### "No supported LLM configured" Error
Set an API key environment variable or pass `apiKey` to Agent config. Default requires `ANTHROPIC_API_KEY`.

### Tool Not Found
Ensure tool names match exactly. Class method names are used as-is. Function names must not be anonymous.

### Type Errors in Tool Arguments
The tool system extracts types from function signatures. Use TypeScript type annotations for proper schema generation.

### Tests Failing
Run `npm run build` before running tests. Jest uses compiled output from `dist/`.

## Philosophy & Principles

### Simplicity First
Every feature should be usable in 2-5 lines. Complex use cases should compose simple primitives, not require complex configuration.

### Functions as Primitives
Regular functions become tools. No schemas, no decorators, no boilerplate.

### Behavior Over Identity
Trust is earned through tracked behavior (history), not granted by authority.

### Fail Fast
Throw errors with context. Let agents retry and adapt. Never silently swallow exceptions unless explicitly required.
