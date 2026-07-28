# @connectonion/react

React hooks for [ConnectOnion](https://github.com/openonion/connectonion) agents — live chat
over a WebSocket, voice input, and browser identity.

This package is the React layer only. The agent connection, WebSocket protocol, and types
live in [`connectonion`](https://www.npmjs.com/package/connectonion), which this package
takes as a peer dependency.

## Install

```bash
npm install @connectonion/react connectonion
```

`react` (17+) and `connectonion` are peer dependencies — you install them yourself, so there
is exactly one copy of each in your app.

## Quick start

```tsx
import { useAgentForHuman } from '@connectonion/react';

function Chat({ address, sessionId }: { address: string; sessionId: string }) {
  const { ui, input, isProcessing } = useAgentForHuman(address, sessionId);

  return (
    <>
      {ui.map((item) => <ChatItemView key={item.id} item={item} />)}
      <ChatInput onSubmit={input} disabled={isProcessing} />
    </>
  );
}
```

`input()` is fire-and-forget: it dispatches the prompt and the response streams back through
`ui` and `status`. See [`docs/react.md`](docs/react.md) for the full hook surface.

## What's exported

| Export | What it does |
| --- | --- |
| `useAgentForHuman(address, sessionId)` | Live agent session — `ui`, `status`, `input`, `sendMessage`, `setMode`, `reconnect`, `reset`. Persists per session to `localStorage`. |
| `useVoiceInput(options?)` | Records microphone audio and transcribes it. |
| `isChatItemType` / `isEventType` | Type guards for narrowing a `ChatItem` by its `type`. |
| `fetchAgentInfo` | Re-exported from `connectonion` for convenience. |
| `generateBrowser`, `loadBrowser`, `saveBrowser`, `signBrowser`, `createSignedPayloadBrowser` | Ed25519 browser identity, re-exported from `connectonion/address-browser`. |
| Types | `ChatItem`, `AgentStatus`, `ConnectionState`, `ApprovalMode`, `AgentInfo`, `Message`, … |

## Migrating from `connectonion/react`

Up to `connectonion@0.1.x` these hooks shipped inside the core package under the
`connectonion/react` subpath. From `connectonion@0.2.0` they live here.

```diff
-import { useAgentForHuman, useVoiceInput } from 'connectonion/react';
+import { useAgentForHuman, useVoiceInput } from '@connectonion/react';
```

Nothing else changed — same hooks, same signatures, same `localStorage` keys, so existing
sessions carry over. Install `@connectonion/react` alongside `connectonion@^0.2.0`.

## Development

```bash
npm install     # links the local core package (see note below)
npm test        # jest, jsdom
npx tsc --noEmit
npm run build
```

> **Note — while this package still lives inside the `connectonion-ts` repo**, its
> `connectonion` devDependency is `file:../..`, which symlinks the core package next door.
> That requires the core package to have been built first (`cd ../.. && npm run build`).
> When this directory moves to its own repository, change that devDependency to a published
> version (`"connectonion": "^0.2.0"`).

## License

MIT
