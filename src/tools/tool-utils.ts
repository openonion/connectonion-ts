/**
 * @purpose Auto-convert TypeScript functions and class methods into Agent-compatible Tool objects with schema generation
 *
 * @graph Tool Conversion Pipeline
 *
 *   processTools(tools[])
 *          │
 *          ▼
 *   ┌──────────────────────────────────────────────────────┐
 *   │  For each item in tools[]:                           │
 *   │                                                      │
 *   │   ┌──────────────┐                                   │
 *   │   │ typeof item?  │                                   │
 *   │   └──────┬───────┘                                   │
 *   │     ┌────┼──────────────┐                            │
 *   │     ▼    ▼              ▼                            │
 *   │  Function  Tool obj   Class instance                 │
 *   │     │      (has run)      │                          │
 *   │     ▼      │              ▼                          │
 *   │  createTool│     extractMethodsFromInstance()        │
 *   │  FromFunc()│        │                                │
 *   │     │      │        ▼                                │
 *   │     │      │     For each public method:             │
 *   │     │      │       createToolFromFunction()          │
 *   │     │      │       + bind(this)                      │
 *   │     └──────┴────────┘                                │
 *   │            │                                         │
 *   │            ▼                                         │
 *   │     Tool { name, description, run(), schema() }     │
 *   └──────────────────────────────────────────────────────┘
 *
 * @graph Function → Schema Extraction
 *
 *   func.toString()
 *        │
 *        ▼
 *   ┌────────────────┐    ┌───────────────┐    ┌──────────────┐
 *   │ Extract name   │───▶│ Extract JSDoc │───▶│ Parse params │
 *   │ func.name      │    │ via regex     │    │ name: type   │
 *   └────────────────┘    └───────────────┘    └──────┬───────┘
 *                                                     │
 *                                                     ▼
 *                                              ┌──────────────┐
 *                                              │  TYPE_MAP    │
 *                                              │  string→str  │
 *                                              │  number→num  │
 *                                              │  boolean→bool│
 *                                              └──────┬───────┘
 *                                                     │
 *                                                     ▼
 *                                              FunctionSchema {
 *                                                name, description,
 *                                                parameters: {
 *                                                  type: 'object',
 *                                                  properties: {...}
 *                                                }
 *                                              }
 *
 * @llm-note
 *   Dependencies: imports from [../types] | imported by [src/core/agent.ts, src/index.ts] | tested by [tests/agent.test.ts, examples/test-migrations.ts]
 *   Data flow: receives func: Function or class instance → inspects with func.toString() → extracts name/JSDoc/params via regex → maps types via TYPE_MAP → returns Tool with run(), toFunctionSchema()
 *   State/Effects: no state or side effects | pure transformation functions | regex parsing of function source
 *   Integration: exposes processTools(tools), createToolFromFunction(func), extractMethodsFromInstance(instance), isClassInstance(obj), xray(func) | used by Agent constructor to auto-convert tools | preserves @xray decorator flag
 *   Performance: synchronous regex parsing | TYPE_MAP provides O(1) type lookups | no caching (recreates on each call)
 *   Errors: skips methods without proper signatures | skips private methods (starting with _) | defaults to 'string' type when annotation missing | wraps methods with functools-like context preservation
 */

import { Tool } from '../types';

// Map TypeScript/JavaScript types to JSON Schema types
const TYPE_MAP: Record<string, string> = {
  'string': 'string',
  'number': 'number',
  'boolean': 'boolean',
  'object': 'object',
  'array': 'array',
};

/**
 * Extract parameter information from a function
 * 
 * This function analyzes a JavaScript/TypeScript function to extract:
 * - Function name
 * - Description (from comments if available)
 * - Parameter schema for OpenAI function calling
 * 
 * @param func - The function to analyze
 * @returns Object containing name, description, and parameter schema
 * 
 * @private
 */
function extractFunctionInfo(func: Function): { name: string; description: string; parameters: any } {
  // Get the function name (or 'anonymous' for unnamed functions)
  const name = func.name || 'anonymous';
  
  // Try to extract description from function source
  const funcStr = func.toString();
  const description = extractDescription(funcStr) || `Execute the ${name} tool.`;
  
  // Parse parameters from function signature
  const parameters = extractParameters(funcStr);
  
  return { name, description, parameters };
}

/**
 * Extract description from function comments
 * 
 * Looks for JSDoc comments or single-line comments in the function source.
 * This allows developers to document their tools naturally.
 * 
 * @param funcStr - String representation of the function
 * @returns The extracted description or null if none found
 * 
 * @example
 * ```typescript
 * // This comment will be extracted
 * function myTool() { }
 * 
 * /** This JSDoc will also be extracted *\/
 * function anotherTool() { }
 * ```
 * 
 * @private
 */
function extractDescription(funcStr: string): string | null {
  // Try to extract JSDoc comment (/** ... */)
  const jsdocMatch = funcStr.match(/\/\*\*\s*\n\s*\*\s*(.+?)\n/);
  if (jsdocMatch) {
    return jsdocMatch[1].trim();
  }
  
  // Try to extract single-line comment (// ...)
  const commentMatch = funcStr.match(/\/\/\s*(.+)/);
  if (commentMatch) {
    return commentMatch[1].trim();
  }
  
  return null;
}

/**
 * Extract parameters from function signature
 *
 * Parses the function signature to identify parameters and their TypeScript types.
 * Uses TYPE_MAP to convert TypeScript types to JSON Schema types.
 *
 * @param funcStr - String representation of the function
 * @returns JSON Schema object describing the parameters
 *
 * @private
 */
function extractParameters(funcStr: string): any {
  // Extract parameter names from function signature
  const paramMatch = funcStr.match(/\(([^)]*)\)/);
  if (!paramMatch || !paramMatch[1].trim()) {
    // No parameters found
    return {
      type: 'object',
      properties: {},
    };
  }

  // Split parameters by comma
  const params = paramMatch[1].split(',').map(p => p.trim());
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of params) {
    // Handle parameters with default values (optional)
    // Check for TypeScript optional (?) or default values (=)
    const hasDefault = param.includes('=');
    const hasOptional = param.includes('?');
    const isOptional = hasDefault || hasOptional;

    // Clean the parameter to get just the name
    let cleanParam = param;
    if (hasDefault) {
      cleanParam = param.split('=')[0].trim();
    }

    // Extract parameter name and type annotation
    // Remove optional marker if present
    cleanParam = cleanParam.replace('?', '');
    const parts = cleanParam.split(':').map(p => p.trim());
    const paramName = parts[0];
    const typeAnnotation = parts[1]; // e.g., "string", "number", "boolean"

    // Skip destructured parameters and complex types for now
    if (paramName && !paramName.includes('{') && !paramName.includes('[')) {
      // Use TYPE_MAP to convert TypeScript type to JSON Schema type
      let schemaType = 'string'; // Default fallback

      if (typeAnnotation) {
        // Extract base type (handle complex types like "string[]" or "Promise<string>")
        const baseType = typeAnnotation.replace(/\[\]$/, '').replace(/<.*>/, '').trim();
        schemaType = TYPE_MAP[baseType] || 'string';

        // Handle array types (e.g., "string[]")
        if (typeAnnotation.includes('[]')) {
          schemaType = 'array';
        }
      }

      properties[paramName] = { type: schemaType };

      if (!isOptional) {
        required.push(paramName);
      }
    }
  }

  // Build JSON Schema for parameters
  const schema: any = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

/**
 * Convert a function to a Tool
 * 
 * This is the main function for converting regular TypeScript/JavaScript
 * functions into Tool objects that can be used by agents.
 * 
 * @param func - The function to convert
 * @returns A Tool object wrapping the function
 * 
 * @example
 * ```typescript
 * // Simple function
 * function greet(name: string): string {
 *   return `Hello, ${name}!`;
 * }
 * 
 * // Convert to tool
 * const tool = createToolFromFunction(greet);
 * 
 * // Now it can be used by an agent
 * const agent = new Agent({
 *   name: 'greeter',
 *   tools: [tool] // or just [greet] - automatic conversion
 * });
 * ```
 */
export function createToolFromFunction(func: Function): Tool {
  // Extract metadata from the function
  const { name, description, parameters } = extractFunctionInfo(func);
  
  // Create a Tool object that wraps the function
  const tool: Tool = {
    name,
    description,
    xray: (func as any)?.__xray__ === true,
    
    // The run method executes the actual function with error handling
    run: (args: Record<string, any>) => {
      try {
        // Convert args object to function parameters
        // This handles the mismatch between object-style args and positional parameters
        const paramNames = Object.keys(parameters.properties || {});
        const orderedArgs = paramNames.map(name => args[name]);
        
        // Call the original function with the arguments
        return func(...orderedArgs);
      } catch (error) {
        // Tools should handle errors gracefully
        // Re-throw to let the Agent handle it properly
        throw error;
      }
    },
    
    // Convert to OpenAI function schema format
    toFunctionSchema: () => ({
      name,
      description,
      parameters,
    }),
  };
  
  return tool;
}

/**
 * Mark a function as an @xray breakpoint tool for the interactive debugger.
 */
export function xray<T extends Function>(func: T): T {
  try {
    Object.defineProperty(func, '__xray__', { value: true, configurable: true });
  } catch {
    (func as any).__xray__ = true;
  }
  return func as any;
}

/**
 * Check if an object is a class instance (not a plain object or function)
 * 
 * This helps identify when we should extract methods from a class instance
 * versus treating something as a simple function or object.
 * 
 * @param obj - The object to check
 * @returns true if it's a class instance, false otherwise
 * 
 * @example
 * ```typescript
 * class MyClass { }
 * const instance = new MyClass();
 * 
 * isClassInstance(instance);        // true
 * isClassInstance({});              // false (plain object)
 * isClassInstance(() => {});        // false (function)
 * isClassInstance([]);              // false (array)
 * ```
 */
export function isClassInstance(obj: any): boolean {
  // Basic type checks
  if (!obj || typeof obj !== 'object') return false;
  if (obj.constructor === Object) return false; // Plain object
  if (Array.isArray(obj)) return false; // Array
  
  // If it passes all checks, it's likely a class instance
  return true;
}

/**
 * Extract methods from a class instance
 * 
 * This function extracts all public methods from a class instance
 * and converts them into Tool objects. Private methods (starting with _)
 * and the constructor are automatically excluded.
 * 
 * @param instance - A class instance to extract methods from
 * @returns Array of Tool objects for each public method
 * 
 * @example
 * ```typescript
 * class Calculator {
 *   add(a: number, b: number): number {
 *     return a + b;
 *   }
 *   
 *   multiply(a: number, b: number): number {
 *     return a * b;
 *   }
 *   
 *   private _helper(): void {
 *     // This won't be extracted
 *   }
 * }
 * 
 * const calc = new Calculator();
 * const tools = extractMethodsFromInstance(calc);
 * // tools will contain 'add' and 'multiply' tools
 * ```
 */
export function extractMethodsFromInstance(instance: any): Tool[] {
  const tools: Tool[] = [];
  const prototype = Object.getPrototypeOf(instance);
  
  // Get all property names from both the instance and its prototype
  const propertyNames = new Set([
    ...Object.getOwnPropertyNames(instance),
    ...Object.getOwnPropertyNames(prototype),
  ]);
  
  for (const name of propertyNames) {
    // Skip private methods (convention: start with underscore)
    if (name.startsWith('_') || name === 'constructor') continue;
    
    const method = instance[name];
    
    // Check if it's a function
    if (typeof method !== 'function') continue;
    
    // Create a wrapper function that preserves the method's context
    // This ensures 'this' refers to the original instance
    // Use arrow function to capture the instance context
    const wrappedMethod = (...args: any[]) => {
      return method.apply(instance, args);
    };
    
    // Set the name property for the wrapper
    Object.defineProperty(wrappedMethod, 'name', { 
      value: name,
      configurable: true 
    });
    
    // Convert the wrapped method to a tool
    const tool = createToolFromFunction(wrappedMethod);
    tools.push(tool);
  }
  
  return tools;
}

/**
 * Process various input types and convert them to Tool array
 * 
 * This is the main entry point for tool processing. It handles:
 * - Individual functions
 * - Arrays of functions
 * - Class instances (extracts all methods)
 * - Existing Tool objects
 * - Mixed arrays of the above
 * 
 * @param tools - Single tool or array of tools in various formats
 * @returns Array of processed Tool objects
 * 
 * @example
 * ```typescript
 * // Process a single function
 * const tools1 = processTools(myFunction);
 * 
 * // Process an array of functions
 * const tools2 = processTools([func1, func2, func3]);
 * 
 * // Process a class instance
 * class MyService {
 *   method1() { }
 *   method2() { }
 * }
 * const tools3 = processTools(new MyService());
 * 
 * // Process a mixed array
 * const tools4 = processTools([
 *   myFunction,
 *   new MyService(),
 *   customToolObject
 * ]);
 * ```
 */
export function processTools(tools: Tool[] | Function[] | any[] | any): Tool[] {
  const processed: Tool[] = [];
  
  // Handle empty input
  if (!tools) return processed;
  
  // Normalize to array (handle single tool input)
  const toolsList = Array.isArray(tools) ? tools : [tools];
  
  // Process each tool based on its type
  for (const tool of toolsList) {
    if (isClassInstance(tool)) {
      // Extract all methods from class instance
      const methods = extractMethodsFromInstance(tool);
      processed.push(...methods);
    } else if (typeof tool === 'function') {
      // Convert function to tool
      processed.push(createToolFromFunction(tool));
    } else if (tool && typeof tool === 'object' && 'run' in tool && 'toFunctionSchema' in tool) {
      // Already a Tool object - use as is
      processed.push(tool as Tool);
    }
    // Ignore other types silently
  }
  
  return processed;
}
