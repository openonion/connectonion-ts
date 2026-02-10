# Connect to Remote Agents (TypeScript)

Use any remote agent as if it were local.

## Quick Start

```ts
import { connect } from 'connectonion';

// Connect to a remote agent by address
const remote = connect('0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');

// Use it like a local Agent
const result = await remote.input('Search for TypeScript docs');
console.log(result);
```

## API

- `connect(address: string, relayUrl?: string): RemoteAgent`
  - `address`: Ed25519 public key (hex, `0x...`)
  - `relayUrl`: defaults to `wss://oo.openonion.ai/ws/announce`
- `RemoteAgent.input(prompt: string, timeoutMs = 30000): Promise<string>`

## Relay URLs

- Production (default): `wss://oo.openonion.ai/ws/announce`
- Local dev: `ws://localhost:8000/ws/announce`

```ts
const remote = connect('0xabc...', 'ws://localhost:8000/ws/announce');
const out = await remote.input('ping');
```

Or via environment variable:

```bash
export RELAY_URL=ws://localhost:8000/ws/announce
```

```ts
const remote = connect('0xabc...'); // uses RELAY_URL if set
```

## How It Works

`connect()` opens a WebSocket to the relay input endpoint and sends:

```json
{ "type": "INPUT", "input_id": "uuid", "to": "0x...", "prompt": "..." }
```

It waits for a matching `OUTPUT` message with the same `input_id` and returns `result`.

## Node.js WebSocket

In Node.js, install `ws`:

```bash
npm i ws
```

The SDK auto-detects global `WebSocket` (browser) or falls back to `ws` (Node). If neither is available, it throws a helpful error.

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, and first agent |
| [API Reference](./api.md) | Complete class/method reference |
| [Tools Guide](./tools.md) | Deep dive into function/class tool conversion |
| [Examples](./examples.md) | Copy-paste ready code for real-world use cases |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |
