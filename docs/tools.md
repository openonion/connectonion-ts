# Tools Guide

The tool system is the heart of ConnectOnion. It automatically converts your TypeScript functions and classes into AI-accessible tools with zero configuration. This guide covers everything from basic usage to advanced patterns.

---

## Table of Contents

1. [Tool Fundamentals](#tool-fundamentals)
2. [Function Tools](#function-tools)
3. [Class-Based Tools](#class-based-tools)
4. [Custom Tool Interface](#custom-tool-interface)
5. [Advanced Patterns](#advanced-patterns)
6. [Best Practices](#best-practices)
7. [Troubleshooting Tools](#troubleshooting-tools)

---

## Tool Fundamentals

### What Makes a Good Tool?

Tools are the **actions** your agent can take. Think of them as the agent's hands and senses in your application.

**Great tools are:**
- **Focused**: Do one thing well
- **Typed**: Use TypeScript types for parameters and returns
- **Documented**: Include JSDoc comments for descriptions
- **Predictable**: Same inputs produce same outputs when possible

### How Tools Work

1. **Automatic Conversion**: ConnectOnion analyzes your functions/classes and generates OpenAI-compatible schemas
2. **Type Safety**: TypeScript types become parameter validation
3. **Smart Descriptions**: JSDoc comments become tool descriptions for the AI
4. **Seamless Execution**: The agent calls tools and receives results automatically

```typescript
// This function...
function calculateTax(amount: number, rate: number): number {
  /** Calculate tax amount based on principal and rate */
  return amount * (rate / 100);
}

// ...automatically becomes this tool schema:
{
  name: "calculateTax",
  description: "Calculate tax amount based on principal and rate",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number" },
      rate: { type: "number" }
    },
    required: ["amount", "rate"]
  }
}
```

---

## Function Tools

The simplest and most common way to create tools. Any TypeScript function can become a tool.

### Basic Function Tools

```typescript
import { Agent } from 'connectonion';

// Simple synchronous tool
function add(a: number, b: number): number {
  /** Add two numbers together */
  return a + b;
}

// Async tool for I/O operations
async function saveToFile(filename: string, content: string): Promise<string> {
  /** Save content to a file and return confirmation */
  await fs.writeFile(filename, content, 'utf8');
  return `Saved ${content.length} characters to ${filename}`;
}

// Tool with optional parameters
function formatText(text: string, uppercase: boolean = false, prefix?: string): string {
  /** Format text with optional transformations */
  let result = text;
  if (uppercase) result = result.toUpperCase();
  if (prefix) result = `${prefix}: ${result}`;
  return result;
}

const agent = new Agent({
  name: 'function-demo',
  tools: [add, saveToFile, formatText]
});
```

### Advanced Function Patterns

#### Union Types
```typescript
function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): string {
  /** Set the application log level */
  console.log(`Log level set to: ${level}`);
  return `Logging level changed to ${level}`;
}
```

#### Complex Return Types
```typescript
interface UserProfile {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

function createUser(name: string, email: string): UserProfile {
  /** Create a new user profile */
  return {
    id: Math.floor(Math.random() * 1000),
    name,
    email,
    isActive: true
  };
}
```

#### Error Handling in Tools
```typescript
function divideNumbers(a: number, b: number): number {
  /** Divide two numbers (throws error if division by zero) */
  if (b === 0) {
    throw new Error("Cannot divide by zero");
  }
  return a / b;
}

// The agent will receive the error message and can explain it to the user
```

#### Tools with Default Values
```typescript
function searchUsers(query: string, limit: number = 10, includeInactive: boolean = false): UserProfile[] {
  /** Search for users with optional filters */
  // Implementation here
  return []; // Mock return
}
```

---

## Class-Based Tools

When you have related functionality, group it into classes. All **public methods** automatically become tools.

### Basic Class Tools

```typescript
class TaskManager {
  private tasks: Array<{id: number, title: string, completed: boolean}> = [];
  private nextId = 1;

  // PUBLIC methods become tools
  addTask(title: string): string {
    /** Add a new task to the list */
    const task = { id: this.nextId++, title, completed: false };
    this.tasks.push(task);
    return `Added task "${title}" with ID ${task.id}`;
  }

  completeTask(id: number): string {
    /** Mark a task as completed */
    const task = this.tasks.find(t => t.id === id);
    if (!task) return 'Task not found';
    
    task.completed = true;
    return `Task "${task.title}" marked as completed`;
  }

  listTasks(showCompleted: boolean = true): Array<{id: number, title: string, completed: boolean}> {
    /** Get all tasks, optionally filtering completed ones */
    return showCompleted ? this.tasks : this.tasks.filter(t => !t.completed);
  }

  // PRIVATE methods are NOT exposed as tools
  private generateId(): number {
    return this.nextId++;
  }
}

const taskManager = new TaskManager();
const agent = new Agent({
  name: 'task-agent',
  tools: [taskManager] // Pass the entire instance
});
```

### Advanced Class Patterns

#### Service Classes
```typescript
class EmailService {
  private sentEmails: Array<{to: string, subject: string, timestamp: Date}> = [];

  async sendEmail(to: string, subject: string, body: string): Promise<string> {
    /** Send an email to a recipient */
    // Mock sending logic
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.sentEmails.push({ to, subject, timestamp: new Date() });
    return `Email sent to ${to} with subject "${subject}"`;
  }

  getEmailHistory(recipient?: string): Array<{to: string, subject: string, timestamp: Date}> {
    /** Get history of sent emails, optionally filtered by recipient */
    return recipient 
      ? this.sentEmails.filter(email => email.to === recipient)
      : this.sentEmails;
  }

  validateEmail(email: string): boolean {
    /** Check if an email address is valid */
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
```

#### Stateful Services
```typescript
class DatabaseConnection {
  private connected = false;
  private data = new Map<string, any>();

  connect(): string {
    /** Connect to the database */
    this.connected = true;
    return 'Database connected successfully';
  }

  disconnect(): string {
    /** Disconnect from the database */
    this.connected = false;
    return 'Database disconnected';
  }

  store(key: string, value: any): string {
    /** Store a key-value pair in the database */
    if (!this.connected) throw new Error('Database not connected');
    
    this.data.set(key, value);
    return `Stored data with key: ${key}`;
  }

  retrieve(key: string): any {
    /** Retrieve data by key from the database */
    if (!this.connected) throw new Error('Database not connected');
    
    const value = this.data.get(key);
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return value;
  }

  isConnected(): boolean {
    /** Check if database is connected */
    return this.connected;
  }
}
```

#### Multiple Class Instances
```typescript
// Create specialized instances
const userDB = new DatabaseConnection();
const sessionDB = new DatabaseConnection();
const emailService = new EmailService();

const agent = new Agent({
  name: 'multi-service-agent',
  tools: [userDB, sessionDB, emailService], // Multiple services
  systemPrompt: 'You manage user data, sessions, and email communications.'
});
```

---

## Custom Tool Interface

For maximum control, implement the `Tool` interface directly.

### Basic Custom Tool

```typescript
import { Tool, FunctionSchema } from 'connectonion';

const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  
  run: async (args: Record<string, any>) => {
    const { city, units = 'fahrenheit' } = args;
    
    // Your custom logic here
    const response = await fetch(`https://api.weather.com/v1/current?city=${city}&units=${units}`);
    const data = await response.json();
    
    return `Weather in ${city}: ${data.temperature}°${units === 'celsius' ? 'C' : 'F'}, ${data.description}`;
  },
  
  toFunctionSchema: (): FunctionSchema => ({
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: {
        city: { 
          type: 'string', 
          description: 'City name' 
        },
        units: { 
          type: 'string', 
          enum: ['celsius', 'fahrenheit'], 
          default: 'fahrenheit',
          description: 'Temperature units'
        }
      },
      required: ['city']
    }
  })
};

const agent = new Agent({
  name: 'weather-agent',
  tools: [weatherTool]
});
```

### Advanced Custom Tools

#### Tool with Complex Parameters
```typescript
const searchTool: Tool = {
  name: 'advanced_search',
  description: 'Search with advanced filtering options',
  
  run: async (args) => {
    const { query, filters, sorting, pagination } = args;
    
    // Complex search logic
    return {
      results: [], // Search results
      totalCount: 0,
      page: pagination?.page || 1,
      appliedFilters: filters
    };
  },
  
  toFunctionSchema: () => ({
    name: 'advanced_search',
    description: 'Search with advanced filtering options',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        filters: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            priceMin: { type: 'number' },
            priceMax: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } }
          }
        },
        sorting: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['name', 'price', 'date'] },
            direction: { type: 'string', enum: ['asc', 'desc'] }
          }
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100 }
          }
        }
      },
      required: ['query']
    }
  })
};
```

#### Tool with State Management
```typescript
class StatefulTool implements Tool {
  private state = new Map<string, any>();
  
  name = 'stateful_operations';
  description = 'Perform operations with persistent state';
  
  async run(args: Record<string, any>) {
    const { operation, key, value } = args;
    
    switch (operation) {
      case 'set':
        this.state.set(key, value);
        return `Set ${key} = ${value}`;
        
      case 'get':
        return this.state.get(key) || null;
        
      case 'delete':
        const deleted = this.state.delete(key);
        return deleted ? `Deleted ${key}` : `Key ${key} not found`;
        
      case 'list':
        return Array.from(this.state.entries());
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  toFunctionSchema(): FunctionSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { 
            type: 'string', 
            enum: ['set', 'get', 'delete', 'list'],
            description: 'Operation to perform'
          },
          key: { type: 'string', description: 'Key for set/get/delete operations' },
          value: { description: 'Value for set operation' }
        },
        required: ['operation']
      }
    };
  }
}
```

---

## Advanced Patterns

### Dynamic Tool Registration

```typescript
class DynamicAgent {
  private agent: Agent;
  private availableTools = new Map<string, Tool>();
  
  constructor() {
    this.agent = new Agent({ name: 'dynamic' });
  }
  
  registerTool(tool: Tool): void {
    this.availableTools.set(tool.name, tool);
    this.agent.addTool(tool);
  }
  
  unregisterTool(toolName: string): void {
    this.availableTools.delete(toolName);
    this.agent.removeTool(toolName);
  }
  
  listAvailableTools(): string[] {
    return Array.from(this.availableTools.keys());
  }
  
  async input(message: string): Promise<string> {
    return this.agent.input(message);
  }
}

// Usage
const dynamicAgent = new DynamicAgent();

// Register tools based on conditions
if (userHasPermission('database')) {
  dynamicAgent.registerTool(databaseTool);
}

if (featureEnabled('email')) {
  dynamicAgent.registerTool(emailTool);
}
```

### Tool Composition

```typescript
// Compose multiple tools into workflows
class WorkflowTool implements Tool {
  name = 'user_onboarding_workflow';
  description = 'Complete user onboarding process';
  
  constructor(
    private userService: UserService,
    private emailService: EmailService,
    private auditService: AuditService
  ) {}
  
  async run(args: Record<string, any>) {
    const { name, email, role } = args;
    
    try {
      // Step 1: Create user
      const user = await this.userService.createUser(name, email, role);
      
      // Step 2: Send welcome email
      await this.emailService.sendWelcomeEmail(email, name);
      
      // Step 3: Log the event
      await this.auditService.logEvent('user_created', user.id);
      
      return {
        success: true,
        userId: user.id,
        message: `User ${name} successfully onboarded`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  toFunctionSchema(): FunctionSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User full name' },
          email: { type: 'string', description: 'User email address' },
          role: { type: 'string', enum: ['user', 'admin', 'moderator'] }
        },
        required: ['name', 'email', 'role']
      }
    };
  }
}
```

### Conditional Tools

```typescript
class ConditionalToolProvider {
  static createToolsForUser(user: User): Tool[] {
    const tools: Tool[] = [];
    
    // Basic tools for all users
    tools.push(profileTool, searchTool);
    
    // Admin-only tools
    if (user.role === 'admin') {
      tools.push(userManagementTool, systemConfigTool);
    }
    
    // Premium features
    if (user.subscription === 'premium') {
      tools.push(advancedAnalyticsTool, exportTool);
    }
    
    // Feature flag based tools
    if (featureFlags.get('new_feature')) {
      tools.push(betaFeatureTool);
    }
    
    return tools;
  }
}

// Usage
const userTools = ConditionalToolProvider.createToolsForUser(currentUser);
const agent = new Agent({
  name: 'personalized-agent',
  tools: userTools
});
```

---

## Best Practices

### 1. Naming and Documentation

```typescript
// ✅ Good: Clear name, typed parameters, JSDoc
function calculateMonthlyPayment(loanAmount: number, annualRate: number, years: number): number {
  /** 
   * Calculate monthly mortgage payment
   * @param loanAmount - Total loan amount in dollars
   * @param annualRate - Annual interest rate as percentage (e.g., 5.5 for 5.5%)
   * @param years - Loan term in years
   */
  const monthlyRate = annualRate / 100 / 12;
  const numberOfPayments = years * 12;
  
  return (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments)) /
         (Math.pow(1 + monthlyRate, numberOfPayments) - 1);
}

// ❌ Avoid: Unclear name, no types, no documentation
function calc(a, b, c) {
  return (a * b * Math.pow(1 + b, c)) / (Math.pow(1 + b, c) - 1);
}
```

### 2. Error Handling

```typescript
// ✅ Good: Meaningful error messages
function processPayment(amount: number, cardNumber: string): string {
  /** Process a credit card payment */
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  
  if (!isValidCardNumber(cardNumber)) {
    throw new Error('Invalid credit card number format');
  }
  
  // Process payment...
  return `Payment of $${amount} processed successfully`;
}

// ✅ Good: Return error information instead of throwing
function validateAddress(address: string): {valid: boolean, errors: string[]} {
  /** Validate a postal address and return detailed results */
  const errors: string[] = [];
  
  if (!address.trim()) errors.push('Address cannot be empty');
  if (address.length < 10) errors.push('Address seems too short');
  if (!/\d/.test(address)) errors.push('Address should contain a street number');
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

### 3. Input Validation

```typescript
function scheduleAppointment(date: string, time: string, duration: number): string {
  /** Schedule an appointment with validation */
  
  // Validate date format
  const appointmentDate = new Date(date);
  if (isNaN(appointmentDate.getTime())) {
    throw new Error('Invalid date format. Please use YYYY-MM-DD');
  }
  
  // Validate time format
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    throw new Error('Invalid time format. Please use HH:MM (24-hour)');
  }
  
  // Validate duration
  if (duration <= 0 || duration > 480) {
    throw new Error('Duration must be between 1 and 480 minutes');
  }
  
  // Business logic...
  return `Appointment scheduled for ${date} at ${time} for ${duration} minutes`;
}
```

### 4. Async Tool Patterns

```typescript
// ✅ Good: Proper async handling with timeout
async function fetchUserData(userId: number): Promise<User> {
  /** Fetch user data from external API with timeout */
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`/api/users/${userId}`, {
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ✅ Good: Batch operations
async function processMultipleItems(items: string[]): Promise<string[]> {
  /** Process multiple items in parallel with concurrency limit */
  
  const limit = 5; // Max concurrent operations
  const results: string[] = [];
  
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map(item => processIndividualItem(item))
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

### 5. Tool Organization

```typescript
// ✅ Good: Group related functionality
class UserManagement {
  // User CRUD operations
  createUser(data: UserData): User { /* ... */ }
  getUserById(id: number): User { /* ... */ }
  updateUser(id: number, updates: Partial<UserData>): User { /* ... */ }
  deleteUser(id: number): boolean { /* ... */ }
  
  // User queries
  searchUsers(query: string): User[] { /* ... */ }
  listActiveUsers(): User[] { /* ... */ }
}

class NotificationService {
  // Different notification channels
  sendEmail(to: string, subject: string, body: string): Promise<string> { /* ... */ }
  sendSMS(phone: string, message: string): Promise<string> { /* ... */ }
  sendPushNotification(userId: number, title: string, body: string): Promise<string> { /* ... */ }
}

// Create specialized agents
const userAgent = new Agent({
  name: 'user-manager',
  tools: [new UserManagement()],
  systemPrompt: 'You manage user accounts and profiles.'
});

const notificationAgent = new Agent({
  name: 'notification-sender',
  tools: [new NotificationService()],
  systemPrompt: 'You send notifications through various channels.'
});
```

---

## Troubleshooting Tools

### Common Issues

#### Tool Not Found
```typescript
// ❌ Problem: Private method won't become a tool
class MyService {
  private doSomething(): string {
    return 'This won\'t be available as a tool';
  }
}

// ✅ Solution: Make it public
class MyService {
  doSomething(): string {
    /** This will be available as a tool */
    return 'This is now a tool!';
  }
}
```

#### Schema Generation Issues
```typescript
// ❌ Problem: No types = poor schema
function badTool(param) {
  return `Got: ${param}`;
}

// ✅ Solution: Add proper types
function goodTool(param: string): string {
  /** Process a string parameter */
  return `Got: ${param}`;
}
```

#### Tool Execution Errors
```typescript
// ❌ Problem: Unhandled errors crash the agent
function riskyTool(input: string): string {
  const result = JSON.parse(input); // Might throw
  return result.value;
}

// ✅ Solution: Handle errors gracefully  
function saferTool(input: string): string {
  /** Parse JSON input safely */
  try {
    const result = JSON.parse(input);
    return result.value || 'No value found';
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error.message}`);
  }
}
```

### Debugging Tools

```typescript
// Add logging to understand tool usage
function debuggingTool(input: string): string {
  /** A tool with debug logging */
  console.log(`Tool called with input: ${input}`);
  
  const result = `Processed: ${input}`;
  console.log(`Tool returning: ${result}`);
  
  return result;
}

// Check tool schemas
const agent = new Agent({ name: 'debug', tools: [debuggingTool] });
const tools = agent.getTools();

console.log('Available tools:');
tools.forEach(tool => {
  console.log(`- ${tool.name}: ${tool.description}`);
  console.log(JSON.stringify(tool.toFunctionSchema(), null, 2));
});
```

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, and first agent |
| [API Reference](./api.md) | Complete class/method reference |
| [Examples](./examples.md) | Copy-paste ready code for real-world use cases |
| [Connect](./connect.md) | Remote Python agent connection via relay |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |
