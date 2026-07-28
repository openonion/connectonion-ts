# 🚀 ConnectOnion TypeScript SDK

> **Connect to Python agents from TypeScript** - Use powerful Python agents in your TypeScript apps

[![npm version](https://img.shields.io/npm/v/connectonion.svg)](https://www.npmjs.com/package/connectonion)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ What is ConnectOnion?

ConnectOnion TypeScript SDK lets you **connect to and use AI agents built with Python**. Build your agents in Python (where the ecosystem is rich), then use them seamlessly from TypeScript/JavaScript applications.

```typescript
// Connect to a Python agent and use it
import { connect } from 'connectonion';

// Connect to a remote agent by address
const agent = connect('0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');

// Use it like a local function
const result = await agent.input('Search for TypeScript tutorials');
console.log(result);
```

**That's it.** No server setup. No complex configuration. Just connect and use.

## 🎯 Why Use This?

### 🐍 **Build Agents in Python**
Python has the richest AI ecosystem - LangChain, LlamaIndex, transformers, and countless ML libraries. Build your agents where the tools are best.

### 📱 **Use Agents in TypeScript**
Your web apps, React frontends, Node.js backends, and Electron apps are in TypeScript. Now you can use powerful Python agents directly.

### 🌐 **Zero Infrastructure**
No servers to manage. No API endpoints to deploy. Agents connect peer-to-peer through the relay network.

### 🔒 **Secure by Design**
Ed25519 cryptographic addressing. No passwords. No auth tokens to leak. Just public/private key pairs.

## 🚀 Quick Start (60 seconds)

### 1. Install
```bash
npm install connectonion
# or
yarn add connectonion
# or
pnpm add connectonion
```

**Building a React app?** The hooks (`useAgentForHuman`, `useVoiceInput`) live in a separate
package as of `0.2.0` — install [`@connectonion/react`](https://www.npmjs.com/package/@connectonion/react)
alongside this one. See [React hooks](#-react-hooks) below.

### 2. Connect to a Python Agent
```typescript
import { connect } from 'connectonion';

// Connect to a remote Python agent
const agent = connect('0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');

// Use it!
const response = await agent.input('Analyze this data and create a report');
console.log(response);
```

### 3. Create the Python Agent (Optional)

If you need to create your own agent in Python:

```python
# pip install connectonion
from connectonion import Agent, announce

def analyze_data(data: str) -> str:
    """Analyze data and create a report"""
    # Your Python logic with pandas, numpy, etc.
    return f"Analysis: {data}"

agent = Agent(
    name="data-analyst",
    tools=[analyze_data]
)

# Announce to the network
announce(agent)
# Prints: Agent address: 0x3d401...
```

Then connect from TypeScript as shown above!

## 🎨 Real-World Examples

### Example 1: Connect to ML Agent from React App
```typescript
// React component using a Python ML agent
import { connect } from 'connectonion';
import { useState } from 'react';

function DataAnalyzer() {
  const [result, setResult] = useState('');
  const agent = connect('0xYourPythonMLAgent');

  const analyze = async () => {
    // Python agent has pandas, scikit-learn, matplotlib, etc.
    const response = await agent.input(
      'Analyze sales data and predict next quarter trends'
    );
    setResult(response);
  };

  return <button onClick={analyze}>Analyze Data</button>;
}
```

### Example 2: Node.js Backend Using Python Agent
```typescript
// Express API using a Python agent for complex processing
import express from 'express';
import { connect } from 'connectonion';

const app = express();
const pythonAgent = connect('0xYourPythonAgent');

app.post('/analyze', async (req, res) => {
  // Offload heavy processing to Python agent
  const result = await pythonAgent.input(req.body.query);
  res.json({ result });
});

app.listen(3000);
```

### Example 3: Electron App with Python Backend
```typescript
// Electron app using Python agent for system operations
import { connect } from 'connectonion';

const systemAgent = connect('0xYourSystemAgent');

async function handleFileOperation() {
  // Python agent has full system access and libraries
  const result = await systemAgent.input(
    'Find all PDFs in Downloads, extract text, and summarize'
  );
  return result;
}
```

## 🔧 Connection Options

### Custom Relay URL
```typescript
// Connect to local development relay
const agent = connect(
  '0xYourAgent',
  'ws://localhost:8000/ws/announce'
);

// Or use environment variable
process.env.RELAY_URL = 'ws://localhost:8000/ws/announce';
const agent = connect('0xYourAgent'); // uses RELAY_URL
```

### Timeout Configuration
```typescript
// Adjust timeout for long-running tasks
const result = await agent.input(
  'Process large dataset',
  60000 // 60 second timeout
);
```

### Multiple Agents
```typescript
// Connect to different specialized agents
const mlAgent = connect('0xMLAgent');
const nlpAgent = connect('0xNLPAgent');
const visionAgent = connect('0xVisionAgent');

// Use them in parallel
const [analysis, sentiment, objects] = await Promise.all([
  mlAgent.input('Analyze time series'),
  nlpAgent.input('Extract sentiment from reviews'),
  visionAgent.input('Detect objects in image')
]);
```

## ⚛️ React Hooks

React hooks ship as their own package, **[`@connectonion/react`](https://www.npmjs.com/package/@connectonion/react)**:

```bash
npm install @connectonion/react connectonion
```

```tsx
import { useAgentForHuman } from '@connectonion/react';

const { ui, input, isProcessing } = useAgentForHuman(address, sessionId);
```

Splitting them out keeps this package free of a React dependency, so Node.js and Electron
consumers don't carry hooks they never call, and the two release on their own cadence.

> **Upgrading from 0.1.x?** The hooks used to be at `connectonion/react`. That subpath is gone
> in `0.2.0` — install `@connectonion/react` and change the import. Nothing else changed:
> same signatures, same `localStorage` keys.

## 📚 Documentation

- **[Getting Started Guide](docs/getting-started.md)** - Complete setup walkthrough
- **[Connect API](docs/connect.md)** - Remote agent connection details
- **[API Reference](docs/api.md)** - Full API documentation
- **[React hooks](https://github.com/openonion/connectonion-react)** - `@connectonion/react`
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues & solutions

### Building Agents in TypeScript (Experimental)

While we recommend building agents in Python, you can also build simple agents directly in TypeScript:

- **[Tool System](docs/tools.md)** - How to create tools in TypeScript
- **[Examples](docs/examples.md)** - TypeScript agent examples

**Important Notes**:
- TypeScript agent features are **experimental** and may have bugs
- Python agent features are **well-tested and fully supported**
- For complex agents with ML, data processing, or extensive Python libraries, use Python and connect via `connect()`
- **Full TypeScript agent support planned for Q1 2026**

If you encounter bugs building agents in TypeScript, please [report them on GitHub](https://github.com/openonion/connectonion-ts/issues).

## 🏗️ Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ConnectOnion TypeScript SDK                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │    Agent      │  │   connect()  │  │      llmDo()           │ │
│  │  (local AI)   │  │  (remote)    │  │  (one-shot LLM call)   │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘ │
│         │                 │                        │             │
│         ▼                 ▼                        │             │
│  ┌─────────────────────────────┐                   │             │
│  │        LLM Factory          │◀──────────────────┘             │
│  │      createLLM(model)       │                                 │
│  └──────────┬──────────────────┘                                 │
│     ┌───────┼──────────┬────────────┐                            │
│     ▼       ▼          ▼            ▼                            │
│  Anthropic  OpenAI   Gemini    OpenOnion                         │
│  (claude-*) (gpt-*)  (gemini-*) (co/*)                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │  Tool System  │  │  Trust   │  │  Console  │  │   Xray    │  │
│  │  func→schema  │  │  Levels  │  │  Logging  │  │  Debugger │  │
│  └──────────────┘  └──────────┘  └───────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Execution Flow

```
  agent.input("What is 2+2?")
       │
       ▼
  ┌─────────────────┐
  │  Init messages   │  [system prompt] + [user message]
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────────────────────┐
  │        Main Loop (max 10 iter)       │
  │                                      │
  │  LLM.complete(messages, tools)       │
  │       │                              │
  │       ├── No tool calls ──▶ EXIT     │
  │       │                              │
  │       └── Tool calls found:          │
  │            Promise.all(              │
  │              tool_1.run(args),       │
  │              tool_2.run(args)        │
  │            )                         │
  │            │                         │
  │            ▼                         │
  │       Append results → LOOP          │
  └─────────────────────────────────────┘
       │
       ▼
  Return final text response
```

### Tool Conversion

```
  Your code                        SDK internals

  function add(a: number,          Tool {
    b: number): number {    ──▶      name: "add",
    return a + b;                    description: "...",
  }                                  run(args) → add(a, b),
                                     toFunctionSchema() → {
  class API {                          type: "object",
    search(q: string) {}   ──▶        properties: {a: {type: "number"}, ...}
    fetch(id: number) {}             }
  }                                }
```

### LLM Provider Routing

```
  createLLM(model)
       │
       ├── "co/*"     ──▶ OpenAI LLM + OpenOnion baseURL
       ├── "claude-*"  ──▶ Anthropic LLM (default)
       ├── "gpt-*"     ──▶ OpenAI LLM
       ├── "o*"        ──▶ OpenAI LLM
       ├── "gemini-*"  ──▶ Gemini LLM
       └── (unknown)   ──▶ Anthropic (fallback) or NoopLLM
```

### Project Structure

```
your-project/
├── src/
│   ├── agents/        # Your agent definitions
│   ├── tools/         # Custom tool implementations
│   └── index.ts       # Main entry point
├── .env               # API keys (never commit!)
├── package.json
└── tsconfig.json
```

### SDK Internal Structure

```
src/
├── core/
│   └── agent.ts            # Main Agent class (orchestrator)
├── llm/
│   ├── index.ts            # LLM factory (routes model names)
│   ├── anthropic.ts        # Anthropic Claude provider (default)
│   ├── openai.ts           # OpenAI GPT/O-series provider
│   ├── gemini.ts           # Google Gemini provider
│   ├── noop.ts             # Fallback for missing config
│   └── llm-do.ts           # One-shot llmDo() helper
├── tools/
│   ├── tool-utils.ts       # Function → Tool conversion
│   ├── tool-executor.ts    # Execution + trace recording
│   ├── xray.ts             # Debug context injection (@xray)
│   ├── replay.ts           # Replay decorator for debugging
│   └── email.ts            # Mock email tools for demos/tests
├── trust/
│   ├── index.ts            # Trust levels (open/careful/strict)
│   └── tools.ts            # Whitelist checks & verification
├── connect/
│   ├── index.ts            # connect() factory + re-exports
│   ├── types.ts            # ChatItem, Response, AgentStatus, ConnectOptions, etc.
│   ├── endpoint.ts         # resolveEndpoint, fetchAgentInfo, utils
│   └── remote-agent.ts     # RemoteAgent class
├── console.ts              # Dual logging (stderr + file)
├── types.ts                # Core TypeScript interfaces
└── index.ts                # Public API exports
```

---

## 💬 Join the Community

[![Discord](https://img.shields.io/discord/1234567890?color=7289da&label=Join%20Discord&logo=discord&logoColor=white&style=for-the-badge)](https://discord.gg/4xfD9k8AUF)

Get help, share agents, and discuss with 1000+ builders in our active community.

---

## ⭐ Show Your Support

If ConnectOnion helps you build better agents, **give it a star!** ⭐

It helps others discover the framework and motivates us to keep improving it.

[⭐ Star on GitHub](https://github.com/openonion/connectonion-ts)

---

## 🤝 Contributing

We love contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup
```bash
# Clone the repo
git clone https://github.com/openonion/connectonion-ts
cd connectonion-ts

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## 📄 License

MIT © [OpenOnion Team](https://github.com/openonion)

## 🔗 Links

- **[Python Version](https://github.com/openonion/connectonion)** - Original Python SDK
- **[Discord Community](https://discord.gg/4xfD9k8AUF)** - Get help & share ideas
- **[Blog](https://connectonion.com/blog)** - Tutorials and updates

## 🌟 Why This Architecture?

### Python for Agents
- **Rich AI Ecosystem**: LangChain, transformers, pandas, scikit-learn, PyTorch, TensorFlow
- **Data Processing**: NumPy, SciPy, matplotlib for complex analysis
- **Mature Libraries**: Decades of proven Python libraries
- **Simple Setup**: `pip install` and you're ready

### TypeScript for Apps
- **Web & Mobile**: React, Next.js, React Native, Electron
- **Type Safety**: Catch errors at compile time
- **IDE Support**: Unmatched IntelliSense and auto-completion
- **NPM Ecosystem**: Access to millions of UI/frontend packages

### Best of Both Worlds
Build agents where the tools are rich (Python), use them where users are (TypeScript apps).

---

<p align="center">
  Built with ❤️ by developers, for developers
</p>

<p align="center">
  <a href="https://github.com/openonion/connectonion-ts">⭐ Star us on GitHub</a>
</p>
