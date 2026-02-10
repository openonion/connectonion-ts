# ConnectOnion React

React hooks for connecting to remote AI agents with real-time UI updates.

## Installation

```bash
npm install connectonion
```

React is a peer dependency - you need React 17+ in your project.

## Quick Start

```tsx
import { useAgent } from 'connectonion/react';

function ChatBot() {
  const { ui, status, input, isProcessing } = useAgent('0x123abc');

  const handleSubmit = async (text: string) => {
    await input(text);
  };

  return (
    <div>
      {/* Render UI events */}
      {ui.map(event => (
        <UIEvent key={event.id} event={event} />
      ))}

      {/* Show status */}
      {isProcessing && <div>Processing...</div>}

      {/* Input form */}
      <ChatInput onSubmit={handleSubmit} disabled={isProcessing} />
    </div>
  );
}
```

## The `useAgent` Hook

```tsx
const {
  agent,          // RemoteAgent instance
  status,         // 'idle' | 'working' | 'waiting'
  ui,             // UIEvent[] - events for rendering
  currentSession, // Session state from server
  input,          // (prompt: string) => Promise<Response>
  reset,          // () => void - start fresh
  isProcessing,   // boolean - true when status !== 'idle'
  error,          // Error | null - last error
} = useAgent(address, options);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `string` | Agent's public address (0x...) |
| `options` | `UseAgentOptions` | Optional configuration |

### Options

```tsx
interface UseAgentOptions {
  // Connection options (passed to connect())
  keys?: AddressData;        // Signing keys for strict trust
  relayUrl?: string;         // Custom relay URL

  // Callbacks
  onStatusChange?: (status: AgentStatus) => void;
  onUIEvent?: (event: UIEvent) => void;
  onComplete?: (response: Response) => void;
  onAskUser?: (question: string) => void;
  onError?: (error: Error) => void;
}
```

## UI Events

The `ui` array contains events for rendering the conversation. Each event has:
- `id`: Unique identifier
- `type`: Event type

### Event Types

| Type | Description | Properties |
|------|-------------|------------|
| `user` | User message | `content: string` |
| `agent` | Agent response | `content: string` |
| `thinking` | Thinking indicator | - |
| `tool_call` | Tool execution | `name`, `args`, `status`, `result` |
| `ask_user` | Agent question | `text: string` |

### Tool Call Status

Tool calls have a `status` field:
- `'running'`: Tool is executing
- `'done'`: Tool completed successfully
- `'error'`: Tool failed

When a tool completes, its result is merged into the existing event (no duplicates).

### Type-Safe Event Rendering

```tsx
import { isEventType, UIEvent } from 'connectonion/react';

function EventRenderer({ event }: { event: UIEvent }) {
  if (isEventType(event, 'user')) {
    return <UserMessage>{event.content}</UserMessage>;
  }

  if (isEventType(event, 'agent')) {
    return <AgentMessage>{event.content}</AgentMessage>;
  }

  if (isEventType(event, 'thinking')) {
    return <ThinkingIndicator />;
  }

  if (isEventType(event, 'tool_call')) {
    return (
      <ToolCard
        name={event.name}
        status={event.status}
        result={event.result}
      />
    );
  }

  if (isEventType(event, 'ask_user')) {
    return <Question>{event.text}</Question>;
  }

  return null;
}
```

## Response Object

The `input()` function returns a `Response`:

```tsx
interface Response {
  text: string;  // Agent's response or question
  done: boolean; // true = complete, false = needs more input
}
```

### Handling Follow-up Questions

When `done: false`, the agent is asking for more information:

```tsx
const handleSubmit = async (text: string) => {
  const response = await input(text);

  if (!response.done) {
    // Agent asked a follow-up question
    // The question is in response.text and also in ui as 'ask_user' event
    console.log('Agent asks:', response.text);
  }
};
```

## Examples

### Basic Chat Interface

```tsx
import { useAgent } from 'connectonion/react';

function Chat() {
  const { ui, input, isProcessing, reset } = useAgent('0x123abc');
  const [text, setText] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isProcessing) return;

    const prompt = text;
    setText('');
    await input(prompt);
  };

  return (
    <div className="chat">
      <button onClick={reset}>New Chat</button>

      <div className="messages">
        {ui.map(event => (
          <Message key={event.id} event={event} />
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={isProcessing}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={isProcessing}>
          Send
        </button>
      </form>
    </div>
  );
}
```

### With Callbacks

```tsx
import { useAgent } from 'connectonion/react';
import { toast } from 'your-toast-library';

function AgentWithNotifications() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { ui, input } = useAgent('0x123abc', {
    onStatusChange: (status) => {
      console.log('Agent status:', status);
    },
    onUIEvent: () => {
      // Auto-scroll on new events
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    },
    onComplete: (response) => {
      toast.success('Task completed!');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <div>
      {ui.map(e => <Event key={e.id} event={e} />)}
      <div ref={messagesEndRef} />
    </div>
  );
}
```

### With Signing Keys (Strict Trust)

```tsx
import { useAgent } from 'connectonion/react';
import { address } from 'connectonion';

function SecureAgent() {
  // Generate or load keys
  const [keys] = useState(() => address.generate());

  const { input } = useAgent('0x123abc', { keys });

  // Your public address for the agent to verify
  console.log('My address:', keys.address);

  return <div>...</div>;
}
```

### Tool Execution Visualization

```tsx
function ToolCard({ event }: { event: ToolCallUIEvent }) {
  return (
    <div className={`tool-card status-${event.status}`}>
      <div className="tool-name">{event.name}</div>

      {event.status === 'running' && (
        <div className="spinner">Running...</div>
      )}

      {event.status === 'done' && (
        <div className="result">{event.result}</div>
      )}

      {event.status === 'error' && (
        <div className="error">{event.result}</div>
      )}
    </div>
  );
}
```

## TypeScript Types

All types are exported for convenience:

```tsx
import type {
  Response,
  UIEvent,
  UIEventType,
  UserUIEvent,
  AgentUIEvent,
  ThinkingUIEvent,
  ToolCallUIEvent,
  AskUserUIEvent,
  AgentStatus,
  UseAgentOptions,
  UseAgentReturn,
} from 'connectonion/react';
```

## Server-Side Rendering (SSR)

The hook is safe for SSR - it initializes with empty state and only connects on the client:

```tsx
// Works in Next.js, Remix, etc.
function Page() {
  const { ui, input } = useAgent('0x123abc');

  // ui is [] on server, populated on client
  return <div>{ui.map(...)}</div>;
}
```

## Comparison with Low-Level API

| Feature | `useAgent()` | `connect()` |
|---------|--------------|-------------|
| Reactive updates | Automatic | Manual polling |
| State management | Built-in | You manage |
| Callbacks | `onComplete`, etc. | None |
| SSR safe | Yes | Yes |
| Framework | React only | Any JS |

Use `useAgent()` for React apps. Use `connect()` for Node.js, Vue, Svelte, or custom implementations.

## See Also

- [connect.md](./connect.md) - Low-level connection API
- [getting-started.md](./getting-started.md) - General setup
- [examples.md](./examples.md) - More examples
