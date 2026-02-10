# Connect to Remote Agents (TypeScript)

Use any remote agent as if it were local. Real-time UI updates included.

## Quick Start

```ts
import { connect } from 'connectonion';

const agent = connect('0x...');

const response = await agent.input('Book a flight to Tokyo');
console.log(response.text);  // "Which date do you prefer?"
console.log(response.done);  // false (agent asked a question)

// Answer the question
const final = await agent.input('March 15');
console.log(final.text);     // "Booked flight for March 15"
console.log(final.done);     // true
```

## Response

```ts
interface Response {
  text: string;   // Agent's response or question
  done: boolean;  // true = complete, false = needs more input
}
```

## Session State

Both server and client have `currentSession` as source of truth:

```ts
agent.currentSession  // Synced from server (read-only)
agent.ui              // Shortcut to currentSession.trace
```

## UI Rendering

`agent.ui` contains all events for rendering. **One type = one component.**

```ts
agent.ui = [
  { id: '1', type: 'user', content: 'Book a flight' },
  { id: '2', type: 'thinking' },
  { id: '3', type: 'tool_call', name: 'search_flights', status: 'running' },
  // ↑ When tool_result arrives, client updates this item to status: 'done'
  { id: '4', type: 'agent', content: 'Found 3 flights...' },
  { id: '5', type: 'ask_user', text: 'Which date?', options: ['Mar 15', 'Mar 16'] },
]
```

### Event Types

| Type | Component | Fields |
|------|-----------|--------|
| `user` | User chat bubble | `content` |
| `agent` | Agent chat bubble | `content` |
| `thinking` | Loading spinner | - |
| `tool_call` | Tool card | `name`, `status`, `result?` |
| `ask_user` | Question form | `text`, `options?` |

### Server → Client Mapping

Server sends two events, client merges into one UI item:

```
Server: tool_call   {id: '3', name: 'search'}     → UI: {id: '3', status: 'running'}
Server: tool_result {id: '3', result: '...'}      → UI: {id: '3', status: 'done', result: '...'}
```

---

## React Integration

For reactive UI updates in React, use the `useAgent` hook:

```tsx
import { useAgent } from 'connectonion/react';

function ChatUI() {
  const { ui, status, input, isProcessing } = useAgent('0x...');

  const handleSend = async (text: string) => {
    const response = await input(text);
    if (!response.done) {
      // Agent asked a follow-up question
      console.log('Question:', response.text);
    }
  };

  return (
    <div>
      {ui.map(item => {
        switch (item.type) {
          case 'user':      return <UserBubble key={item.id} {...item} />;
          case 'agent':     return <AgentBubble key={item.id} {...item} />;
          case 'thinking':  return <Thinking key={item.id} />;
          case 'tool_call': return <ToolCard key={item.id} {...item} />;
          case 'ask_user':  return <QuestionForm key={item.id} {...item} onAnswer={handleSend} />;
        }
      })}
      <Input onSend={handleSend} disabled={isProcessing} />
    </div>
  );
}
```

### Hook Return Value

```ts
const {
  agent,          // RemoteAgent instance
  ui,             // Reactive UIEvent[] - auto updates
  status,         // Reactive 'idle' | 'working' | 'waiting'
  currentSession, // Session state from server
  input,          // (prompt: string) => Promise<Response>
  reset,          // () => void - start fresh
  isProcessing,   // boolean - true when busy
  error,          // Error | null
} = useAgent('0x...');
```

See [react.md](./react.md) for complete React documentation.

## Multi-turn Conversations

```ts
await agent.input('My name is Alice');
await agent.input('Book me a flight');  // Agent remembers context

agent.reset();  // Start fresh
```

## API Reference

### connect()

```ts
function connect(address: string, options?: {
  relayUrl?: string;   // Default: wss://oo.openonion.ai
  sessionId?: string;  // Resume existing session
}): RemoteAgent
```

### RemoteAgent

```ts
class RemoteAgent {
  // Actions
  input(prompt: string): Promise<Response>;
  reset(): void;

  // State (read-only)
  currentSession: Session;
  ui: UIEvent[];
  status: 'idle' | 'working' | 'waiting';
}
```

## Data Types

```ts
interface Response {
  text: string;   // Agent's response
  done: boolean;  // true = complete, false = needs input
}

// Server trace events (what server sends)
interface ServerEvent {
  id: string;
  type: 'user' | 'agent' | 'thinking' | 'tool_call' | 'tool_result' | 'ask_user';
}

// UI events (what client renders) - tool_result merged into tool_call
interface UIEvent {
  id: string;
  type: 'user' | 'agent' | 'thinking' | 'tool_call' | 'ask_user';

  // For user/agent
  content?: string;

  // For tool_call (merged from tool_call + tool_result)
  name?: string;
  status?: 'running' | 'done' | 'error';
  result?: string;

  // For ask_user
  text?: string;
  options?: string[];
}
```

---

## Relay URLs

- Production: `wss://oo.openonion.ai/ws/announce` (default)
- Local: `ws://localhost:8000/ws/announce`

```ts
const agent = connect('0x...', { relayUrl: 'ws://localhost:8000/ws/announce' });
```

Relay URLs accept base (`wss://oo.openonion.ai`), `/ws`, or `/ws/announce`.

Or set `RELAY_URL` environment variable.

## Node.js

```bash
npm i ws
```

SDK auto-detects browser `WebSocket` or falls back to `ws`.

---

## Summary

```ts
// Low-level API (Node.js, any JS)
const agent = connect('0x...');
const response = await agent.input('task');
agent.ui      // All events for UI rendering
agent.status  // 'idle' | 'working' | 'waiting'
```

```tsx
// React (reactive)
import { useAgent } from 'connectonion/react';

const { ui, status, input, isProcessing } = useAgent('0x...');
// ui and status auto-update, triggering re-renders
```

**Server events:** `user`, `agent`, `thinking`, `tool_call`, `tool_result`, `ask_user`

**UI events:** `user`, `agent`, `thinking`, `tool_call`, `ask_user` (tool_result merged into tool_call)

**One UI type = one component.** That's it.

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, and first agent |
| [API Reference](./api.md) | Complete class/method reference |
| [Tools Guide](./tools.md) | Deep dive into function/class tool conversion |
| [Examples](./examples.md) | Copy-paste ready code for real-world use cases |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |
