# 🚀 Getting Started with ConnectOnion TypeScript

Connect to Python agents from TypeScript in **60 seconds** - we timed it!

## Table of Contents
- [Installation](#installation)
- [Connect to Python Agents](#connect-to-python-agents)
- [Building Agents in TypeScript (Optional)](#building-agents-in-typescript-optional)
- [Understanding Tools](#understanding-tools)
- [Configuration Options](#configuration-options)
- [Common Patterns](#common-patterns)
- [Next Steps](#next-steps)

## Installation

### Prerequisites
- Node.js 16+ installed
- TypeScript 4.5+ (optional, but recommended)

### Install the Package

```bash
# Using npm
npm install connectonion

# Using yarn
yarn add connectonion

# Using pnpm
pnpm add connectonion
```

### TypeScript Setup (if needed)

```bash
# Install TypeScript
npm install -D typescript @types/node

# Create tsconfig.json
npx tsc --init
```

## Connect to Python Agents

### Step 1: Connect to a Remote Agent

The **primary use case** for ConnectOnion-TS is connecting to Python agents:

```typescript
import { connect } from 'connectonion';

// Connect to a Python agent by its address
const agent = connect('0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');

// Use it like a local function
async function main() {
  const result = await agent.input('Analyze this dataset and generate insights');
  console.log(result);
}

main().catch(console.error);
```

### Step 2: Run It

```bash
# If using TypeScript
npx ts-node src/connect-example.ts

# Or compile and run
npx tsc
node dist/connect-example.js
```

**🎉 Congratulations!** You're now using a Python agent from TypeScript!

### Step 3: Create Your Own Python Agent (Optional)

Want to create your own agent? Use Python:

```python
# pip install connectonion
from connectonion import Agent, announce

def analyze_data(data: str) -> str:
    """Use pandas, numpy, scikit-learn, etc."""
    import pandas as pd
    # Your complex Python logic here
    return f"Analysis complete: {data}"

agent = Agent(
    name="data-analyst",
    tools=[analyze_data]
)

# Start listening for connections
announce(agent)
# Prints: Agent address: 0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c
```

Then connect from TypeScript as shown in Step 1!

## Building Agents in TypeScript (Experimental)

**⚠️ Note**: Building agents in TypeScript is experimental. **We strongly recommend using Python** for building agents because:

- Python agent features are **well-tested and fully supported**
- Python has the richest AI ecosystem (LangChain, transformers, pandas, numpy, etc.)
- TypeScript agent features may have bugs
- **Full TypeScript agent support is planned for Q1 2026**

**If you choose to build agents in TypeScript and encounter issues, please [report bugs on GitHub](https://github.com/openonion/connectonion-ts/issues).** Your feedback helps us improve!

### When to Build in TypeScript
- Simple tools that don't require Python libraries
- TypeScript-specific integrations (Node.js APIs, npm packages)
- Quick prototypes when Python is not available

### When to Use Python Instead (Recommended)
- **Any serious agent work** - Python is the primary platform
- Machine learning and data science tasks
- Complex data processing
- When you need reliable, well-tested features

### Simple TypeScript Agent Example

```typescript
import { Agent } from 'connectonion';

// Simple TypeScript tools
function getCurrentTime(): string {
  return new Date().toLocaleString();
}

// Create agent (requires API key)
const agent = new Agent({
  name: 'simple-assistant',
  tools: [getCurrentTime],
  systemPrompt: 'You are a simple assistant.'
});

async function main() {
  const response = await agent.input('What time is it?');
  console.log(response);
}

main().catch(console.error);
```

**Requires API key**:
```bash
# .env file
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

**Remember**: For production agents, use Python and connect via `connect()`!

## Understanding Tools

### What Makes a Tool?

In ConnectOnion, **any function can be a tool**. The agent automatically:
- Extracts the function name
- Reads JSDoc comments as descriptions
- Understands parameters
- Knows when to call it

### Tool Examples

```typescript
// Simple tool - synchronous function
function getCurrentTime(): string {
  /** Get the current time */
  return new Date().toLocaleTimeString();
}

// Async tool - returns a Promise
async function fetchWeather(city: string): Promise<string> {
  /** Fetch weather for a city */
  const response = await fetch(`https://api.weather.com/${city}`);
  return await response.text();
}

// Tool with multiple parameters
function sendEmail(
  to: string,
  subject: string,
  body: string,
  urgent: boolean = false
): string {
  /** Send an email to someone */
  // Email logic here
  return `Email sent to ${to}`;
}

// Arrow function tool
const calculateAge = (birthYear: number): number => {
  /** Calculate age from birth year */
  return new Date().getFullYear() - birthYear;
};
```

### Class-Based Tools

Turn entire classes into tool sets:

```typescript
class FileManager {
  /**
   * Each public method becomes a tool!
   */
  
  readFile(path: string): string {
    /** Read contents of a file */
    return fs.readFileSync(path, 'utf-8');
  }
  
  writeFile(path: string, content: string): void {
    /** Write content to a file */
    fs.writeFileSync(path, content);
  }
  
  listFiles(directory: string): string[] {
    /** List all files in a directory */
    return fs.readdirSync(directory);
  }
  
  private helper(): void {
    // Private methods are NOT exposed as tools
  }
}

// Use the entire class as tools
const agent = new Agent({
  name: 'file-agent',
  tools: [new FileManager()], // All public methods become tools!
});
```

## Configuration Options

### Basic Configuration

```typescript
const agent = new Agent({
  // Required: unique name for behavior tracking
  name: 'my-agent',
  
  // Optional: array of tools (functions, classes, or Tool objects)
  tools: [tool1, tool2],
  
  // Optional: system prompt defining behavior
  systemPrompt: 'You are a helpful assistant',
  
  // Optional: OpenAI API key (uses env var if not provided)
  apiKey: 'sk-...',
  
  // Optional: model to use (default: 'gpt-4o-mini')
  model: 'gpt-4',
  
  // Optional: max iterations for tool calling (default: 10)
  maxIterations: 15
});
```

### Environment Variables

ConnectOnion automatically loads from `.env`:

```bash
# .env file
OPENAI_API_KEY=sk-your-key
DEFAULT_MODEL=gpt-4
MAX_ITERATIONS=20
```

### Using Different Models

```typescript
// Fast and cheap
const fastAgent = new Agent({
  name: 'fast',
  model: 'gpt-3.5-turbo'
});

// Powerful and smart
const smartAgent = new Agent({
  name: 'smart',
  model: 'gpt-4'
});

// Latest mini model (recommended for most use cases)
const efficientAgent = new Agent({
  name: 'efficient',
  model: 'gpt-4o-mini'  // Default
});
```

## Common Patterns

### Pattern 1: Database Agent

```typescript
import { Agent } from 'connectonion';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class DatabaseTools {
  async findUser(email: string) {
    return await prisma.user.findUnique({ where: { email } });
  }
  
  async createUser(email: string, name: string) {
    return await prisma.user.create({
      data: { email, name }
    });
  }
  
  async updateUser(id: number, data: any) {
    return await prisma.user.update({
      where: { id },
      data
    });
  }
}

const dbAgent = new Agent({
  name: 'database-assistant',
  tools: [new DatabaseTools()],
  systemPrompt: 'You help manage user data. Be careful with updates.'
});

// Natural language database operations
await dbAgent.input('Find the user with email john@example.com');
await dbAgent.input('Create a new user Alice with email alice@example.com');
```

### Pattern 2: API Integration Agent

```typescript
class APITools {
  private apiKey = process.env.API_KEY;
  
  async searchProducts(query: string) {
    const response = await fetch(`https://api.store.com/search?q=${query}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    return await response.json();
  }
  
  async getProductDetails(productId: string) {
    const response = await fetch(`https://api.store.com/products/${productId}`);
    return await response.json();
  }
  
  async placeOrder(productId: string, quantity: number) {
    // Order placement logic
    return { orderId: '12345', status: 'confirmed' };
  }
}

const shopAgent = new Agent({
  name: 'shopping-assistant',
  tools: [new APITools()],
  systemPrompt: 'You are a helpful shopping assistant.'
});

// Natural shopping experience
await shopAgent.input('Find me the best wireless headphones under $200');
```

### Pattern 3: Multi-Tool Agent

```typescript
// Combine different tool sources
const agent = new Agent({
  name: 'multi-tool',
  tools: [
    // Individual functions
    calculateTax,
    formatCurrency,
    
    // Class instance (all methods become tools)
    new DatabaseTools(),
    
    // Another class instance
    new EmailService(),
    
    // Custom tool object
    {
      name: 'customTool',
      description: 'A custom tool',
      run: async (args) => { /* ... */ },
      toFunctionSchema: () => ({ /* ... */ })
    }
  ]
});
```

## Session & Trace

Agents keep an in-memory session (messages + tool execution trace):

```typescript
const agent = new Agent({ name: 'runtime-session' });
await agent.input('Hello!');
const { messages, trace } = agent.getSession();
console.log(`Messages: ${messages.length}, tool steps: ${trace.length}`);
// Clear the in-memory trace if needed
agent.clearHistory();
```

## Error Handling

```typescript
try {
  const response = await agent.input('Do something');
  console.log(response);
} catch (error) {
  if (error.message.includes('API key')) {
    console.error('Invalid API key');
  } else if (error.message.includes('rate limit')) {
    console.error('Rate limited, please wait');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Tool Error Handling

Tools that throw errors are handled gracefully:

```typescript
function riskyTool(input: string): string {
  if (!input) {
    throw new Error('Input is required!');
  }
  return `Processed: ${input}`;
}

const agent = new Agent({
  name: 'error-handler',
  tools: [riskyTool]
});

// Agent will handle the error and potentially retry or work around it
await agent.input('Use the risky tool');
```

## Next Steps

### 📚 Learn More
- [API Reference](./api.md) - Complete API documentation
- [Examples](./examples.md) - Real-world examples
- [Tool System](./tools.md) - Deep dive into tools
- [Troubleshooting](./troubleshooting.md) - Common issues

### 🎯 Best Practices

1. **Name your agents clearly** - The name is used for behavior tracking
2. **Write descriptive comments** - They become tool descriptions
3. **Handle errors in tools** - Return error messages rather than throwing
4. **Use appropriate models** - gpt-4o-mini for most tasks, gpt-4 for complex reasoning
5. **Set reasonable iterations** - Simple tasks: 5-10, Complex tasks: 15-30

### 🚀 Build Something Amazing!

Now that you understand the basics, try building:
- A customer service bot
- A data analysis assistant  
- A code review agent
- A content generator
- A DevOps automation tool

The possibilities are endless! 🌟

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [API Reference](./api.md) | Complete class/method reference |
| [Tools Guide](./tools.md) | Deep dive into function/class tool conversion |
| [Examples](./examples.md) | Copy-paste ready code for real-world use cases |
| [Connect](./connect.md) | Remote Python agent connection via relay |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |

---

<p align="center">
  <strong>Need help?</strong> Check our <a href="./troubleshooting.md">Troubleshooting Guide</a> or <a href="https://discord.gg/4xfD9k8AUF">join our Discord</a>
</p>
