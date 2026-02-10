# Troubleshooting Guide

Common issues and their solutions when using ConnectOnion TypeScript. This guide will help you quickly resolve problems and get back to building amazing AI agents.

---

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [API Key Problems](#api-key-problems) 
3. [Tool-Related Issues](#tool-related-issues)
4. [Agent Behavior Problems](#agent-behavior-problems)
5. [TypeScript Issues](#typescript-issues)
6. [Performance Problems](#performance-problems)
7. [Debugging Tips](#debugging-tips)
8. [Getting Help](#getting-help)

---

## Installation Issues

### Problem: `npm install connectonion` fails

**Symptoms:**
```bash
npm ERR! 404 Not Found - GET https://registry.npmjs.org/connectonion-ts
```

**Solution:**
The package might not be published yet or you're using the wrong name.

```bash
# Try these alternatives:
npm install connectonion
# or
npm install connectonion-typescript
# or check the exact package name in the repository
```

**Workaround - Install from source:**
```bash
git clone https://github.com/openonion/connectonion-ts
cd connectonion-ts
npm install
npm run build
npm link

# In your project:
npm link connectonion-ts
```

### Problem: TypeScript compilation errors after installation

**Symptoms:**
```
error TS2307: Cannot find module 'connectonion-ts'
```

**Solution:**
1. Make sure TypeScript is installed:
```bash
npm install --save-dev typescript @types/node
```

2. Check your `tsconfig.json`:
```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

3. If using ES modules, try:
```typescript
import { Agent } from 'connectonion';
// instead of
const { Agent } = require('connectonion');
```

---

## API Key Problems

### Problem: OpenAI API key not working

**Symptoms:**
```
Error: Invalid API key provided
```

**Solutions:**

1. **Check your API key format:**
```bash
# API keys start with "sk-" and are 51 characters long
echo $OPENAI_API_KEY | wc -c  # Should output 52 (including newline)
```

2. **Verify environment variable:**
```bash
echo $OPENAI_API_KEY  # Should display your key
```

3. **Set the key properly:**
```bash
# For current session:
export OPENAI_API_KEY=sk-your-actual-key-here

# For permanent setting (add to ~/.bashrc or ~/.zshrc):
echo 'export OPENAI_API_KEY=sk-your-actual-key-here' >> ~/.bashrc
source ~/.bashrc
```

4. **Pass key directly (for testing):**
```typescript
const agent = new Agent({
  name: 'test',
  apiKey: 'sk-your-actual-key-here' // Not recommended for production
});
```

### Problem: API key works elsewhere but not with ConnectOnion

**Symptoms:**
- OpenAI playground works
- Other apps work
- ConnectOnion gives authentication errors

**Solution:**
Check for hidden characters or extra spaces:

```typescript
// Clean the API key
const cleanKey = process.env.OPENAI_API_KEY?.trim();
const agent = new Agent({
  name: 'test',
  apiKey: cleanKey
});
```

### Problem: Rate limiting errors

**Symptoms:**
```
Error: Rate limit reached for requests
```

**Solutions:**

1. **Add retry logic:**
```typescript
async function createAgentWithRetry(config: AgentConfig, maxRetries: number = 3): Promise<Agent> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const agent = new Agent(config);
      await agent.input('test'); // Test the connection
      return agent;
    } catch (error) {
      if (error.message.includes('rate limit') && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        continue;
      }
      throw error;
    }
  }
}
```

2. **Use a different model:**
```typescript
const agent = new Agent({
  name: 'agent',
  model: 'gpt-3.5-turbo' // Often has higher rate limits
});
```

---

## Tool-Related Issues

### Problem: Function not appearing as a tool

**Symptoms:**
- You pass a function to the agent
- The agent says it doesn't have that capability
- `getTools()` doesn't show your function

**Common Causes & Solutions:**

1. **Function is not properly exported/passed:**
```typescript
// ❌ Wrong: Function not in tools array
function myTool(input: string): string { return input; }
const agent = new Agent({ name: 'test' }); // Missing tools

// ✅ Correct: Function in tools array
const agent = new Agent({ 
  name: 'test', 
  tools: [myTool] 
});
```

2. **Function has no parameters (edge case):**
```typescript
// ❌ Might not work: No parameters
function getThing() { return 'thing'; }

// ✅ Better: Add at least one parameter or make it a constant
function getThing(placeholder?: boolean) { 
  return 'thing'; 
}
```

3. **Function is not typed:**
```typescript
// ❌ Poor schema generation
function badTool(input) { return input; }

// ✅ Good schema generation  
function goodTool(input: string): string {
  /** Process a string input */
  return input;
}
```

### Problem: Class methods not becoming tools

**Symptoms:**
- You pass a class instance
- Only some methods appear as tools
- Private methods are included (shouldn't be)

**Solutions:**

1. **Check method visibility:**
```typescript
class MyService {
  // ✅ This becomes a tool (public)
  processData(data: string): string { return data; }
  
  // ❌ This doesn't become a tool (private)
  private helperMethod(): void { }
  
  // ❌ This might not become a tool (getter)
  get status(): string { return 'ready'; }
  
  // ✅ This becomes a tool (public method)
  getStatus(): string { return 'ready'; }
}
```

2. **Check for arrow functions:**
```typescript
class MyService {
  // ❌ Arrow function properties might not be detected
  process = (data: string): string => data;
  
  // ✅ Regular methods are detected
  process(data: string): string { return data; }
}
```

### Problem: Tool execution fails

**Symptoms:**
```
Tool execution failed: TypeError: Cannot read property 'x' of undefined
```

**Solutions:**

1. **Add input validation:**
```typescript
function safeTool(input: string): string {
  /** Process input with validation */
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string');
  }
  return input.toUpperCase();
}
```

2. **Handle async errors:**
```typescript
async function asyncTool(url: string): Promise<string> {
  /** Fetch data from URL */
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}
```

3. **Debug tool calls:**
```typescript
function debugTool(input: any): any {
  console.log('Tool called with:', typeof input, input);
  
  // Your tool logic here
  const result = processInput(input);
  
  console.log('Tool returning:', typeof result, result);
  return result;
}
```

---

## Agent Behavior Problems

### Problem: Agent doesn't use tools when expected

**Symptoms:**
- Agent gives generic responses instead of using tools
- Agent says it doesn't have relevant capabilities
- Tools are present but ignored

**Solutions:**

1. **Improve tool descriptions:**
```typescript
// ❌ Vague description
function calculate(a, b) { return a + b; }

// ✅ Clear, specific description
function addNumbers(a: number, b: number): number {
  /** Add two numbers together and return the sum */
  return a + b;
}
```

2. **Better system prompt:**
```typescript
const agent = new Agent({
  name: 'calculator',
  tools: [addNumbers, multiplyNumbers],
  systemPrompt: `You are a math assistant. When users ask math questions, 
                 always use the available tools to perform calculations. 
                 Never do mental math - always use the tools.`
});
```

3. **Give examples in the system prompt:**
```typescript
systemPrompt: `You have access to math tools. For example:
- To add numbers: use addNumbers(5, 3)
- To multiply: use multiplyNumbers(4, 7)
Always use tools for calculations.`
```

### Problem: Agent uses wrong tools

**Symptoms:**
- Agent calls inappropriate tools for the task
- Tool selection seems random
- Multiple tool calls when one would suffice

**Solutions:**

1. **Make tool names more specific:**
```typescript
// ❌ Ambiguous names
function get(id) { /* gets user */ }
function update(data) { /* updates user */ }

// ✅ Specific names
function getUserById(userId: number) { /* gets user */ }
function updateUserProfile(userId: number, profile: UserProfile) { /* updates user */ }
```

2. **Add constraints in descriptions:**
```typescript
function deleteUser(userId: number): string {
  /** 
   * Permanently delete a user account. 
   * WARNING: This action cannot be undone. Only use when explicitly requested.
   */
  return `User ${userId} deleted`;
}
```

3. **Use focused agents:**
```typescript
// Instead of one agent with all tools
const calculatorAgent = new Agent({
  name: 'calc',
  tools: [mathTools],
  systemPrompt: 'You only do math calculations.'
});

const userAgent = new Agent({
  name: 'user',
  tools: [userTools], 
  systemPrompt: 'You only manage user accounts.'
});
```

### Problem: Agent gets stuck in loops

**Symptoms:**
- Agent keeps calling the same tool repeatedly
- Responses take very long
- Eventually hits maxIterations limit

**Solutions:**

1. **Lower maxIterations:**
```typescript
const agent = new Agent({
  name: 'agent',
  maxIterations: 5 // Default is 10
});
```

2. **Fix tool logic:**
```typescript
// ❌ Tool that might cause loops
function searchData(query: string): string {
  if (noResults) {
    return 'No results found. Try searching again.'; // Agent might search again
  }
  return results;
}

// ✅ Tool that provides clear finality
function searchData(query: string): SearchResult {
  return {
    results: foundItems,
    totalCount: foundItems.length,
    hasMore: false, // Clear signal that search is complete
    query: query
  };
}
```

3. **Add state tracking:**
```typescript
class StatefulTool {
  private callCount = 0;
  
  searchData(query: string): string {
    this.callCount++;
    
    if (this.callCount > 3) {
      throw new Error('Too many search attempts. Please refine your query.');
    }
    
    // Search logic
  }
}
```

---

## TypeScript Issues

### Problem: Type errors with tool parameters

**Symptoms:**
```typescript
error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'
```

**Solutions:**

1. **Use proper parameter types:**
```typescript
// ❌ Any types cause issues
function myTool(param: any): any {
  return param;
}

// ✅ Specific types work better
function myTool(param: string | number): string {
  return String(param);
}
```

2. **Handle union types:**
```typescript
function processMixedInput(input: string | number | boolean): string {
  /** Process various input types */
  if (typeof input === 'string') return input.toUpperCase();
  if (typeof input === 'number') return input.toString();
  if (typeof input === 'boolean') return input ? 'true' : 'false';
  return 'unknown';
}
```

### Problem: Module import/export issues

**Symptoms:**
```
Cannot find module 'connectonion' or its corresponding type declarations
```

**Solutions:**

1. **Check package.json:**
```json
{
  "dependencies": {
    "connectonion-ts": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

2. **Use correct import syntax:**
```typescript
// ES Modules (most cases)
import { Agent, Tool } from 'connectonion';

// CommonJS (if needed)
const { Agent, Tool } = require('connectonion');
```

3. **Check tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true
  }
}
```

---

## Performance Problems

### Problem: Slow agent responses

**Symptoms:**
- Long delays between input and response
- Tools execute quickly but overall response is slow
- High costs from extended conversations

**Solutions:**

1. **Use faster models:**
```typescript
const agent = new Agent({
  name: 'fast-agent',
  model: 'gpt-4o-mini' // Faster and cheaper than gpt-4
});
```

2. **Optimize tool execution:**
```typescript
// ❌ Slow: Sequential processing
async function processItems(items: string[]): Promise<string[]> {
  const results = [];
  for (const item of items) {
    results.push(await slowProcessing(item));
  }
  return results;
}

// ✅ Fast: Parallel processing  
async function processItems(items: string[]): Promise<string[]> {
  return Promise.all(items.map(item => slowProcessing(item)));
}
```

3. **Cache expensive operations:**
```typescript
class CachedTool {
  private cache = new Map<string, any>();
  
  expensiveOperation(input: string): any {
    if (this.cache.has(input)) {
      return this.cache.get(input);
    }
    
    const result = doExpensiveWork(input);
    this.cache.set(input, result);
    return result;
  }
}
```

### Problem: High memory usage

**Symptoms:**
- Node.js process uses increasing memory
- Out of memory errors with long conversations
- Performance degrades over time

**Solutions:**

1. **Clear conversation history periodically:**
```typescript
const agent = new Agent({ name: 'agent' });

// Clear history every 50 interactions
let interactionCount = 0;
async function chat(message: string): Promise<string> {
  const response = await agent.input(message);
  
  interactionCount++;
  if (interactionCount % 50 === 0) {
    agent.clearHistory();
  }
  
  return response;
}
```

2. **Limit conversation length:**
```typescript
class ManagedAgent {
  private agent: Agent;
  private readonly maxHistoryLength: number;
  
  constructor(config: AgentConfig, maxHistoryLength: number = 100) {
    this.agent = new Agent(config);
    this.maxHistoryLength = maxHistoryLength;
  }
  
  async input(message: string): Promise<string> {
    const response = await this.agent.input(message);
    
    const { trace } = this.agent.getSession();
    if (history.length > this.maxHistoryLength) {
      // Keep only recent history
      const recentTrace = trace.slice(-this.maxHistoryLength);
      this.agent.clearHistory();
      // In a real implementation, you'd restore the recent history
    }
    
    return response;
  }
}
```

---

## Debugging Tips

### 1. Enable Detailed Logging

```typescript
// Add debug logging to understand agent behavior
const agent = new Agent({
  name: 'debug-agent',
  tools: [debugTool]
});

// Log all interactions
const originalInput = agent.input;
agent.input = async function(message: string): Promise<string> {
  console.log(`[INPUT] ${new Date().toISOString()}: ${message}`);
  
  const response = await originalInput.call(this, message);
  
  console.log(`[OUTPUT] ${new Date().toISOString()}: ${response}`);
  return response;
};
```

### 2. Inspect Tool Schemas

```typescript
const agent = new Agent({
  name: 'inspect',
  tools: [myTool1, myTool2]
});

// See what tools are available and their schemas
console.log('Available tools:');
agent.getTools().forEach(tool => {
  console.log(`\n${tool.name}:`);
  console.log(`  Description: ${tool.description}`);
  console.log(`  Schema:`, JSON.stringify(tool.toFunctionSchema(), null, 2));
});
```

### 3. Test Tools Individually

```typescript
// Test your tools outside the agent
async function testTools() {
  try {
    const result1 = await myTool('test input');
    console.log('Tool result:', result1);
    
    const result2 = myService.methodName('test');
    console.log('Service result:', result2);
  } catch (error) {
    console.error('Tool error:', error);
  }
}

testTools();
```

### 4. Monitor Behavior History

```typescript
const agent = new Agent({ name: 'monitored' });

async function monitoredChat(message: string): Promise<string> {
  const response = await agent.input(message);
  
  // Check what happened
  const { messages, trace } = agent.getSession();
  const latestEntries = history.slice(-5); // Last 5 entries
  
  console.log('Recent behavior:');
  latestEntries.forEach(entry => {
    console.log(`  ${entry.type}: ${JSON.stringify(entry.data).substring(0, 100)}...`);
  });
  
  return response;
}
```

---

## Getting Help

### Check the Documentation
1. **[Getting Started](./getting-started.md)** - Setup and basic usage
2. **[Examples](./examples.md)** - Real-world code examples  
3. **[API Reference](./api.md)** - Complete API documentation
4. **[Tools Guide](./tools.md)** - Advanced tool patterns

### Search for Similar Issues
Before creating a new issue, search the repository for similar problems:
```bash
# Check GitHub issues
https://github.com/openonion/connectonion-ts/issues

# Search closed issues too - your problem might be solved
```

### Create a Minimal Reproduction

When reporting issues, provide a minimal example:

```typescript
// minimal-reproduction.ts
import { Agent } from 'connectonion';

function problemTool(input: string): string {
  // Demonstrate the issue here
  return input;
}

const agent = new Agent({
  name: 'repro',
  tools: [problemTool]
});

async function reproduce() {
  try {
    const result = await agent.input('test message');
    console.log('Expected: X, Got:', result);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

reproduce();
```

### Include Environment Information

When asking for help, include:

```typescript
// environment-info.ts
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('ConnectOnion version:', require('connectonion-ts/package.json').version);
console.log('TypeScript version:', require('typescript/package.json').version);
```

### Community Support

- **Discord**: Join our [Discord community](https://discord.gg/4xfD9k8AUF)
- **GitHub Issues**: [Report bugs or request features](https://github.com/openonion/connectonion-ts/issues)
- **Stack Overflow**: Tag questions with `connectonion` and `typescript`

### Pro Tips for Getting Help

1. **Be specific**: "Tool doesn't work" vs "getUserById tool throws TypeError on line 15"
2. **Show code**: Include the actual code that's not working
3. **Provide context**: What were you trying to accomplish?
4. **Include errors**: Full error messages and stack traces
5. **Share environment**: Node version, OS, package versions

---

**Still stuck?** Don't worry - the ConnectOnion community is friendly and helpful. Join our [Discord](https://discord.gg/4xfD9k8AUF) and we'll get you unstuck quickly!

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, and first agent |
| [API Reference](./api.md) | Complete class/method reference |
| [Tools Guide](./tools.md) | Deep dive into function/class tool conversion |
| [Examples](./examples.md) | Copy-paste ready code for real-world use cases |
| [Connect](./connect.md) | Remote Python agent connection via relay |
