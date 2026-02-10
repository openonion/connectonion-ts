# ConnectOnion TypeScript Examples

This guide walks you through real-world examples, from simple to complex. Each example includes complete, runnable code that you can copy and use immediately.

---

## Table of Contents
1. [Simple Function Tools](#simple-function-tools)
2. [Class-Based Tools](#class-based-tools) 
3. [Web Scraper Agent](#web-scraper-agent)
4. [Customer Service Bot](#customer-service-bot)
5. [Code Analysis Agent](#code-analysis-agent)
6. [Multi-Agent System](#multi-agent-system)
7. [Custom LLM Provider](#custom-llm-provider)

---

## Simple Function Tools

**Perfect for:** Quick automation, simple calculations, basic utilities

```typescript
import { Agent } from 'connectonion';

// Math utilities
function add(a: number, b: number): number {
  /** Add two numbers together */
  return a + b;
}

function calculateTip(billAmount: number, tipPercentage: number): number {
  /** Calculate tip amount based on bill and percentage */
  return (billAmount * tipPercentage) / 100;
}

// Text utilities  
function reverseText(text: string): string {
  /** Reverse the order of characters in text */
  return text.split('').reverse().join('');
}

function wordCount(text: string): number {
  /** Count the number of words in text */
  return text.trim().split(/\s+/).length;
}

async function main() {
  const agent = new Agent({
    name: 'utility-bot',
    tools: [add, calculateTip, reverseText, wordCount],
    systemPrompt: 'You are a helpful utility assistant.'
  });

  // Examples of what this agent can do
  console.log(await agent.input('What is 150 + 237?'));
  console.log(await agent.input('If my dinner bill is $45.50 and I want to tip 18%, how much should I tip?'));
  console.log(await agent.input('Reverse the text "Hello World" and count how many words it has'));
}

main().catch(console.error);
```

**What makes this example great:**
- Functions are small and focused
- Clear parameter types and return types
- JSDoc comments help the AI understand what each tool does
- Easy to test and debug

---

## Class-Based Tools

**Perfect for:** Managing state, complex business logic, service integrations

```typescript
import { Agent } from 'connectonion';

class ContactManager {
  private contacts: Array<{id: number, name: string, email: string, phone?: string}> = [];
  private nextId = 1;

  addContact(name: string, email: string, phone?: string): string {
    /** Add a new contact to the database */
    const contact = {
      id: this.nextId++,
      name,
      email,
      phone
    };
    this.contacts.push(contact);
    return `Added ${name} with ID ${contact.id}`;
  }

  findContactByName(name: string): any {
    /** Search for a contact by name (case-insensitive) */
    const contact = this.contacts.find(c => 
      c.name.toLowerCase().includes(name.toLowerCase())
    );
    return contact || null;
  }

  listAllContacts(): any[] {
    /** Get all contacts in the database */
    return this.contacts;
  }

  deleteContact(id: number): string {
    /** Delete a contact by ID */
    const index = this.contacts.findIndex(c => c.id === id);
    if (index !== -1) {
      const deleted = this.contacts.splice(index, 1)[0];
      return `Deleted contact: ${deleted.name}`;
    }
    return 'Contact not found';
  }

  updateContactEmail(id: number, newEmail: string): string {
    /** Update a contact's email address */
    const contact = this.contacts.find(c => c.id === id);
    if (contact) {
      contact.email = newEmail;
      return `Updated ${contact.name}'s email to ${newEmail}`;
    }
    return 'Contact not found';
  }
}

async function main() {
  const contactManager = new ContactManager();
  
  const agent = new Agent({
    name: 'contact-assistant',
    tools: [contactManager], // Pass the entire instance
    systemPrompt: `You are a contact management assistant. You can help users:
    - Add new contacts
    - Search for existing contacts
    - Update contact information
    - Delete contacts
    - List all contacts
    
    Always be helpful and confirm actions with the user.`
  });

  // Example conversation
  console.log(await agent.input('Add John Doe with email john@example.com and phone 555-1234'));
  console.log(await agent.input('Add Jane Smith with email jane@work.com'));
  console.log(await agent.input('Find contact information for John'));
  console.log(await agent.input('Show me all my contacts'));
  console.log(await agent.input('Update Jane\'s email to jane.smith@newcompany.com'));
}

main().catch(console.error);
```

**Key benefits of class-based tools:**
- Maintains state between tool calls
- Groups related functionality together
- Only public methods become tools (private methods stay internal)
- Easy to add new functionality

---

## Web Scraper Agent

**Perfect for:** Data collection, research, content analysis

```typescript
import { Agent } from 'connectonion';
import https from 'https';
import { URL } from 'url';

class WebScraper {
  private scraped: Map<string, any> = new Map();

  async fetchWebpage(url: string): Promise<string> {
    /** Fetch the HTML content of a webpage */
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(url);
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'ConnectOnion-Bot/1.0'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            this.scraped.set(url, { content: data, timestamp: Date.now() });
            resolve(data);
          });
        });

        req.on('error', reject);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  extractTitles(htmlContent: string): string[] {
    /** Extract all title tags from HTML content */
    const titleRegex = /<title[^>]*>(.*?)<\/title>/gi;
    const matches = [];
    let match;
    
    while ((match = titleRegex.exec(htmlContent)) !== null) {
      matches.push(match[1].trim());
    }
    
    return matches;
  }

  extractLinks(htmlContent: string): string[] {
    /** Extract all href links from HTML content */
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    const links = [];
    let match;
    
    while ((match = linkRegex.exec(htmlContent)) !== null) {
      links.push(match[1]);
    }
    
    return [...new Set(links)]; // Remove duplicates
  }

  getScrapedSession(): Record<string, any> {
    /** Get history of all scraped pages */
    return Object.fromEntries(this.scraped);
  }

  countWords(text: string): number {
    /** Count words in text content */
    return text.replace(/<[^>]*>/g, '') // Remove HTML tags
      .split(/\s+/)
      .filter(word => word.length > 0).length;
  }
}

async function main() {
  const scraper = new WebScraper();
  
  const agent = new Agent({
    name: 'web-researcher',
    tools: [scraper],
    systemPrompt: `You are a web research assistant. You can:
    - Fetch webpage content
    - Extract titles and links
    - Count words and analyze content
    - Keep track of research history
    
    Always summarize findings in a user-friendly way.`,
    maxIterations: 15 // Allow more iterations for complex research
  });

  // Example research session
  console.log(await agent.input('Please fetch the homepage of example.com and tell me what the title is'));
  console.log(await agent.input('How many links are on that page?'));
  console.log(await agent.input('Show me the research history'));
}

main().catch(console.error);
```

**Advanced features demonstrated:**
- Async tool functions
- Error handling within tools
- State management across tool calls
- Integration with Node.js built-in modules

---

## Customer Service Bot

**Perfect for:** Support systems, FAQ handling, order management

```typescript
import { Agent } from 'connectonion';

interface Customer {
  id: string;
  name: string;
  email: string;
  tier: 'basic' | 'premium' | 'enterprise';
}

interface Order {
  id: string;
  customerId: string;
  items: string[];
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  createdAt: Date;
}

interface Ticket {
  id: string;
  customerId: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Date;
}

class CustomerServiceSystem {
  private customers: Customer[] = [
    { id: 'cust001', name: 'John Doe', email: 'john@example.com', tier: 'premium' },
    { id: 'cust002', name: 'Jane Smith', email: 'jane@example.com', tier: 'basic' },
    { id: 'cust003', name: 'Bob Johnson', email: 'bob@enterprise.com', tier: 'enterprise' }
  ];

  private orders: Order[] = [
    {
      id: 'order001',
      customerId: 'cust001',
      items: ['Laptop Pro', 'Wireless Mouse'],
      status: 'shipped',
      total: 1299.99,
      createdAt: new Date('2024-01-15')
    },
    {
      id: 'order002', 
      customerId: 'cust002',
      items: ['Basic Keyboard'],
      status: 'delivered',
      total: 49.99,
      createdAt: new Date('2024-01-10')
    }
  ];

  private tickets: Ticket[] = [];
  private ticketCounter = 1;

  findCustomerByEmail(email: string): Customer | null {
    /** Look up a customer by their email address */
    return this.customers.find(c => c.email.toLowerCase() === email.toLowerCase()) || null;
  }

  getCustomerOrders(customerId: string): Order[] {
    /** Get all orders for a specific customer */
    return this.orders.filter(o => o.customerId === customerId);
  }

  getOrderStatus(orderId: string): string {
    /** Check the status of a specific order */
    const order = this.orders.find(o => o.id === orderId);
    if (!order) return 'Order not found';
    
    return `Order ${orderId} is ${order.status}. Total: $${order.total}`;
  }

  createSupportTicket(customerId: string, subject: string, description: string, priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium'): string {
    /** Create a new support ticket for a customer */
    const ticket: Ticket = {
      id: `ticket${String(this.ticketCounter++).padStart(3, '0')}`,
      customerId,
      subject,
      description,
      status: 'open',
      priority,
      createdAt: new Date()
    };
    
    this.tickets.push(ticket);
    return `Created support ticket ${ticket.id} with ${priority} priority`;
  }

  getCustomerTickets(customerId: string): Ticket[] {
    /** Get all support tickets for a customer */
    return this.tickets.filter(t => t.customerId === customerId);
  }

  processRefund(orderId: string, reason: string): string {
    /** Process a refund for an order */
    const order = this.orders.find(o => o.id === orderId);
    if (!order) return 'Order not found';
    
    if (order.status === 'delivered') {
      order.status = 'cancelled';
      return `Refund processed for order ${orderId}. Amount: $${order.total}. Reason: ${reason}`;
    }
    
    return 'Order cannot be refunded in current status';
  }

  escalateToSupervisor(ticketId: string): string {
    /** Escalate a ticket to supervisor level */
    const ticket = this.tickets.find(t => t.id === ticketId);
    if (!ticket) return 'Ticket not found';
    
    ticket.priority = 'urgent';
    ticket.status = 'in_progress';
    return `Ticket ${ticketId} has been escalated to supervisor with urgent priority`;
  }
}

async function main() {
  const customerService = new CustomerServiceSystem();
  
  const agent = new Agent({
    name: 'support-agent',
    tools: [customerService],
    systemPrompt: `You are a helpful customer service representative. You can:

    - Look up customers by email
    - Check order status and history
    - Create and manage support tickets  
    - Process refunds
    - Escalate issues to supervisors

    Always be polite, helpful, and thorough. Ask for email addresses to identify customers.
    For refunds, always ask for a reason. For urgent issues, don't hesitate to escalate.
    
    Remember:
    - Premium and Enterprise customers get priority support
    - Always verify customer identity before sharing sensitive information
    - Document all interactions in support tickets`,
    maxIterations: 12
  });

  // Example customer service interactions
  console.log('\n--- Customer Service Demo ---\n');
  
  console.log(await agent.input('Hi, I need help with my recent order. My email is john@example.com'));
  
  console.log(await agent.input('I want to check the status of my order and possibly request a refund because the item was damaged'));
  
  console.log(await agent.input('Please create a support ticket about this damaged item issue and escalate it since I\'m a premium customer'));
}

main().catch(console.error);
```

**Enterprise features showcased:**
- Complex data structures with TypeScript interfaces
- Multi-step workflows
- Business logic implementation
- Priority and escalation handling
- Customer tier management

---

## Code Analysis Agent

**Perfect for:** Development tools, code review, refactoring assistance

```typescript
import { Agent } from 'connectonion';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

class CodeAnalyzer {
  private analysisCache = new Map<string, any>();

  readCodeFile(filePath: string): string {
    /** Read the contents of a code file */
    try {
      if (!existsSync(filePath)) {
        return `File not found: ${filePath}`;
      }
      
      const content = readFileSync(filePath, 'utf-8');
      this.analysisCache.set(filePath, {
        content,
        analyzedAt: new Date(),
        fileSize: content.length
      });
      
      return content;
    } catch (error) {
      return `Error reading file: ${error.message}`;
    }
  }

  analyzeFunction(code: string, functionName: string): any {
    /** Analyze a specific function in the code */
    const functionRegex = new RegExp(
      `(function\\s+${functionName}|const\\s+${functionName}\\s*=|${functionName}\\s*[:=]\\s*function)([\\s\\S]*?)(?=\\n\\s*(?:function|const|class|$))`,
      'i'
    );
    
    const match = code.match(functionRegex);
    if (!match) {
      return { found: false, message: `Function ${functionName} not found` };
    }

    const functionCode = match[0];
    const lines = functionCode.split('\n');
    
    return {
      found: true,
      name: functionName,
      lineCount: lines.length,
      characterCount: functionCode.length,
      hasComments: functionCode.includes('//') || functionCode.includes('/*'),
      parameters: this.extractParameters(functionCode),
      complexity: this.calculateComplexity(functionCode)
    };
  }

  private extractParameters(functionCode: string): string[] {
    const paramMatch = functionCode.match(/\(([^)]*)\)/);
    if (!paramMatch) return [];
    
    return paramMatch[1]
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  private calculateComplexity(code: string): number {
    // Simple cyclomatic complexity calculation
    const complexityKeywords = ['if', 'else', 'while', 'for', 'case', 'catch', '&&', '||'];
    let complexity = 1; // Base complexity
    
    complexityKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = code.match(regex);
      if (matches) complexity += matches.length;
    });
    
    return complexity;
  }

  countCodeLines(code: string): any {
    /** Count different types of lines in code */
    const lines = code.split('\n');
    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed === '') {
        blankLines++;
      } else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        commentLines++;
      } else {
        codeLines++;
      }
    });
    
    return {
      totalLines: lines.length,
      codeLines,
      commentLines,
      blankLines,
      commentRatio: commentLines / (codeLines + commentLines)
    };
  }

  findTodos(code: string): string[] {
    /** Find all TODO comments in the code */
    const todoRegex = /\/\/\s*TODO:?\s*(.+)/gi;
    const todos = [];
    let match;
    
    while ((match = todoRegex.exec(code)) !== null) {
      todos.push(match[1].trim());
    }
    
    return todos;
  }

  analyzeProjectStructure(projectPath: string): any {
    /** Analyze the structure of a project directory */
    if (!existsSync(projectPath)) {
      return { error: 'Project path does not exist' };
    }

    const analysis = {
      totalFiles: 0,
      fileTypes: {} as Record<string, number>,
      directories: [] as string[],
      codeFiles: [] as string[]
    };

    const analyzeDirectory = (dirPath: string, relativePath = '') => {
      const items = readdirSync(dirPath);
      
      items.forEach(item => {
        const itemPath = join(dirPath, item);
        const itemStat = statSync(itemPath);
        const relativeItemPath = join(relativePath, item);
        
        if (itemStat.isDirectory()) {
          analysis.directories.push(relativeItemPath);
          if (!item.startsWith('.') && item !== 'node_modules') {
            analyzeDirectory(itemPath, relativeItemPath);
          }
        } else {
          analysis.totalFiles++;
          const ext = extname(item);
          analysis.fileTypes[ext] = (analysis.fileTypes[ext] || 0) + 1;
          
          if (['.ts', '.js', '.py', '.java', '.cpp', '.c', '.rb'].includes(ext)) {
            analysis.codeFiles.push(relativeItemPath);
          }
        }
      });
    };

    analyzeDirectory(projectPath);
    return analysis;
  }

  getAnalysisSession(): Record<string, any> {
    /** Get history of all analyzed files */
    return Object.fromEntries(this.analysisCache);
  }
}

async function main() {
  const codeAnalyzer = new CodeAnalyzer();
  
  const agent = new Agent({
    name: 'code-reviewer',
    tools: [codeAnalyzer],
    systemPrompt: `You are a senior code reviewer and static analysis expert. You can:

    - Read and analyze code files
    - Analyze specific functions for complexity and quality
    - Count lines of code and calculate metrics
    - Find TODOs and technical debt
    - Analyze project structure
    - Provide code quality insights and suggestions

    Always provide constructive feedback and specific recommendations for improvement.
    Focus on code quality, maintainability, and best practices.`,
    maxIterations: 15
  });

  // Example code review session
  console.log('\n--- Code Analysis Demo ---\n');
  
  // You would replace these with actual file paths in your project
  console.log(await agent.input('Please analyze the project structure of /path/to/project'));
  
  console.log(await agent.input('Read the main agent source file and analyze its code quality'));
  
  console.log(await agent.input('Look for any TODO comments and calculate the code-to-comment ratio'));
}

main().catch(console.error);
```

**Development tool features:**
- File system integration
- Code parsing and analysis
- Metrics calculation
- Project structure analysis
- Caching for performance

---

## Multi-Agent System

**Perfect for:** Complex workflows, specialized agents, collaborative processing

```typescript
import { Agent } from 'connectonion';

// Shared data store for agents to communicate
class SharedWorkspace {
  private data = new Map<string, any>();
  private logs: string[] = [];

  setData(key: string, value: any, agentName: string): string {
    /** Store data in the shared workspace */
    this.data.set(key, { value, timestamp: Date.now(), setBy: agentName });
    this.logs.push(`${agentName} set ${key} at ${new Date().toISOString()}`);
    return `Data stored: ${key}`;
  }

  getData(key: string): any {
    /** Retrieve data from the shared workspace */
    const entry = this.data.get(key);
    return entry ? entry.value : null;
  }

  getAllData(): Record<string, any> {
    /** Get all data in the workspace */
    const result: Record<string, any> = {};
    for (const [key, entry] of this.data) {
      result[key] = entry.value;
    }
    return result;
  }

  getWorkspaceLogs(): string[] {
    /** Get logs of all workspace activity */
    return [...this.logs];
  }

  clearWorkspace(): string {
    /** Clear all data from workspace */
    this.data.clear();
    this.logs.push(`Workspace cleared at ${new Date().toISOString()}`);
    return 'Workspace cleared';
  }
}

class TaskManager {
  private tasks: Array<{id: string, title: string, assignedTo: string, status: string, createdAt: Date}> = [];
  private taskIdCounter = 1;

  createTask(title: string, assignedTo: string): string {
    /** Create a new task and assign it to an agent */
    const task = {
      id: `task_${this.taskIdCounter++}`,
      title,
      assignedTo,
      status: 'pending',
      createdAt: new Date()
    };
    this.tasks.push(task);
    return `Created task ${task.id}: "${title}" assigned to ${assignedTo}`;
  }

  completeTask(taskId: string): string {
    /** Mark a task as completed */
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      return `Task ${taskId} marked as completed`;
    }
    return 'Task not found';
  }

  getTasksFor(agentName: string): any[] {
    /** Get all tasks assigned to a specific agent */
    return this.tasks.filter(t => t.assignedTo === agentName);
  }

  getAllTasks(): any[] {
    /** Get all tasks in the system */
    return this.tasks;
  }
}

async function createMultiAgentSystem() {
  // Shared resources
  const workspace = new SharedWorkspace();
  const taskManager = new TaskManager();

  // Research Agent - Specializes in information gathering
  const researchAgent = new Agent({
    name: 'researcher',
    tools: [workspace, taskManager],
    systemPrompt: `You are a research specialist agent. Your job is to:
    - Gather and analyze information
    - Store findings in the shared workspace
    - Break down complex research questions into smaller tasks
    - Provide detailed, well-researched answers
    
    Always store your findings using meaningful keys in the workspace.`
  });

  // Analysis Agent - Specializes in data analysis
  const analysisAgent = new Agent({
    name: 'analyst', 
    tools: [workspace, taskManager],
    systemPrompt: `You are a data analysis specialist. Your job is to:
    - Retrieve data from the workspace
    - Perform calculations and analysis
    - Identify patterns and insights
    - Generate reports and recommendations
    
    Focus on thorough analysis and clear explanations of your findings.`
  });

  // Coordination Agent - Manages workflow and task assignment
  const coordinatorAgent = new Agent({
    name: 'coordinator',
    tools: [workspace, taskManager], 
    systemPrompt: `You are a project coordinator. Your job is to:
    - Break down complex requests into tasks
    - Assign tasks to appropriate specialist agents
    - Monitor progress and coordinate between agents
    - Synthesize results from multiple agents
    
    You manage the workflow and ensure all agents work together effectively.`
  });

  return { researchAgent, analysisAgent, coordinatorAgent, workspace, taskManager };
}

async function main() {
  const { researchAgent, analysisAgent, coordinatorAgent, workspace } = await createMultiAgentSystem();

  console.log('\n--- Multi-Agent System Demo ---\n');

  // Coordinator starts by breaking down a complex task
  console.log('COORDINATOR: Breaking down the task...');
  const coordinatorResponse = await coordinatorAgent.input(
    `I need to research the TypeScript programming language and analyze its popularity trends. 
     Please break this down into tasks and coordinate with the research and analysis agents.
     
     Store the research in the workspace with key 'typescript_research' and analysis with key 'typescript_analysis'.`
  );
  console.log(coordinatorResponse);
  console.log('\n---\n');

  // Research agent gathers information
  console.log('RESEARCHER: Conducting research...');
  const researchResponse = await researchAgent.input(
    `Please research TypeScript programming language. Focus on:
     - What it is and key features
     - Adoption by major companies  
     - Recent developments
     
     Store your findings in the workspace with key 'typescript_research'.`
  );
  console.log(researchResponse);
  console.log('\n---\n');

  // Analysis agent processes the research
  console.log('ANALYST: Analyzing the research...');
  const analysisResponse = await analysisAgent.input(
    `Please retrieve the TypeScript research from the workspace and analyze it. Focus on:
     - Key strengths and benefits
     - Market position and trends
     - Recommendations for adoption
     
     Store your analysis with key 'typescript_analysis'.`
  );
  console.log(analysisResponse);
  console.log('\n---\n');

  // Coordinator synthesizes the results
  console.log('COORDINATOR: Synthesizing final report...');
  const finalResponse = await coordinatorAgent.input(
    `Please retrieve both the typescript_research and typescript_analysis from the workspace 
     and create a comprehensive final report. Include all tasks that were completed.`
  );
  console.log(finalResponse);

  // Show workspace activity
  console.log('\n--- Workspace Activity Log ---');
  const logs = workspace.getWorkspaceLogs();
  logs.forEach(log => console.log(log));
}

main().catch(console.error);
```

**Advanced coordination features:**
- Multiple specialized agents
- Shared data workspace
- Task assignment and tracking
- Agent-to-agent communication through shared state
- Complex workflow orchestration

---

## Custom LLM Provider

**Perfect for:** Using different models, custom API integrations, specialized providers

```typescript
import { Agent, LLM, LLMResponse, Message, FunctionSchema } from 'connectonion';

// Example custom LLM that could integrate with other providers
class CustomLLMProvider implements LLM {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.custom-llm.com', model: string = 'custom-model-v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async complete(messages: Message[], tools?: FunctionSchema[]): Promise<LLMResponse> {
    /** Make a completion request to the custom LLM provider */
    try {
      // Convert messages to custom provider format
      const customMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        // Add any custom provider specific fields
      }));

      const requestBody = {
        model: this.model,
        messages: customMessages,
        tools: tools || [],
        temperature: 0.7,
        max_tokens: 1000,
        // Add any other custom provider parameters
      };

      // Note: This is a mock implementation
      // In reality, you'd make an HTTP request to your custom provider
      const response = await this.mockCustomLLMCall(requestBody);
      
      return {
        content: response.content,
        toolCalls: response.tool_calls || [],
        rawResponse: response
      };
      
    } catch (error) {
      console.error('Custom LLM provider error:', error);
      return {
        content: 'I apologize, but I encountered an error processing your request.',
        toolCalls: [],
        rawResponse: { error: error.message }
      };
    }
  }

  private async mockCustomLLMCall(requestBody: any): Promise<any> {
    /** Mock implementation - replace with actual API call */
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock response that looks like it used tools
    if (requestBody.tools && requestBody.tools.length > 0) {
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      
      if (lastMessage.content.includes('calculate') || lastMessage.content.includes('add')) {
        return {
          content: null,
          tool_calls: [{
            name: requestBody.tools.find(t => t.name.includes('add'))?.name || 'add',
            arguments: { a: 10, b: 20 },
            id: 'mock_tool_call_1'
          }]
        };
      }
    }
    
    return {
      content: `Mock response from custom LLM provider. Received ${requestBody.messages.length} messages.`,
      tool_calls: []
    };
  }

  // Additional custom methods specific to your provider
  async getModelInfo(): Promise<any> {
    /** Get information about the current model */
    return {
      name: this.model,
      provider: 'Custom LLM Provider',
      capabilities: ['text-completion', 'tool-calling', 'analysis']
    };
  }

  setTemperature(temperature: number): void {
    /** Adjust the creativity/randomness of responses */
    // Implementation would depend on your custom provider's API
    console.log(`Temperature set to ${temperature}`);
  }
}

// Example agent that uses the custom provider
async function main() {
  // Simple math function for testing
  function add(a: number, b: number): number {
    /** Add two numbers together */
    return a + b;
  }

  // Create custom LLM instance
  const customLLM = new CustomLLMProvider('your-api-key-here');
  
  // Create agent with custom LLM
  const agent = new Agent({
    name: 'custom-llm-agent',
    llm: customLLM, // Use custom LLM instead of default OpenAI
    tools: [add],
    systemPrompt: 'You are an assistant powered by a custom LLM provider.'
  });

  // Test the custom provider
  console.log('\n--- Custom LLM Provider Demo ---\n');
  
  console.log('Model info:', await customLLM.getModelInfo());
  
  console.log('\nTesting agent with custom LLM:');
  const response = await agent.input('Can you add 15 and 25 together?');
  console.log('Response:', response);
  
  // Show conversation history to see how tools were used
  console.log('\nConversation history:');
  const { messages, trace } = agent.getSession();
  console.log(JSON.stringify(history, null, 2));
}

main().catch(console.error);
```

**Custom provider capabilities:**
- Implement the LLM interface for any provider
- Add provider-specific features and methods
- Handle different API formats and authentication
- Custom error handling and fallback strategies
- Support for specialized models or fine-tuned versions

---

## Next Steps

Now that you've seen these examples, you're ready to build sophisticated AI agents! Here are some ideas for your next project:

### 🎯 **Beginner Projects**
- **Personal Assistant**: Combine calendar, todo, and note-taking tools
- **Code Formatter**: Build tools to format and analyze code files
- **Data Processor**: Create agents that can parse CSV files and generate reports

### 🚀 **Intermediate Projects**  
- **API Testing Agent**: Tools to make HTTP requests and validate responses
- **Database Agent**: Connect to databases and perform queries
- **Documentation Generator**: Analyze code and generate documentation

### 🔥 **Advanced Projects**
- **CI/CD Agent**: Automate deployment pipelines and testing
- **Security Scanner**: Analyze code for vulnerabilities and compliance
- **Multi-Modal Agent**: Process text, images, and other media types

### 📚 **Learn More**
- **[API Reference](./api.md)** - Complete documentation of all classes and methods
- **[Tools Guide](./tools.md)** - Deep dive into the tool system
- **[Troubleshooting](./troubleshooting.md)** - Solutions to common issues

**Ready to build something amazing?** Start with the example that's closest to your use case and customize it from there!

---

## Related Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, and first agent |
| [API Reference](./api.md) | Complete class/method reference |
| [Tools Guide](./tools.md) | Deep dive into function/class tool conversion |
| [Connect](./connect.md) | Remote Python agent connection via relay |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |
