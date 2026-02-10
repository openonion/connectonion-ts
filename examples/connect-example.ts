/**
 * Example: Connect to a Python agent from TypeScript
 *
 * This demonstrates the primary use case of ConnectOnion-TS:
 * connecting to Python agents from TypeScript applications.
 *
 * Setup:
 * 1. Create a Python agent with `announce(agent)` (see Python example below)
 * 2. Copy the agent address printed by announce()
 * 3. Run this TypeScript code to connect and use the agent
 */

import { connect } from '../src/connect';

// Example Python agent code:
/*
from connectonion import Agent, announce

def analyze_data(query: str) -> str:
    """Analyze data using pandas, numpy, etc."""
    import pandas as pd
    # Your Python logic here
    return f"Analysis result for: {query}"

agent = Agent(
    name="data-analyst",
    tools=[analyze_data]
)

# This prints the agent address
announce(agent)
# Agent address: 0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c
*/

async function main() {
    // Connect to the Python agent
    // Replace with your agent's address from announce()
    const agentAddress = '0x3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c';

    // For local development, use:
    // const agent = connect(agentAddress, { relayUrl: 'ws://localhost:8000' });

    // For production, use default (wss://oo.openonion.ai):
    const agent = connect(agentAddress);

    console.log('Connected to Python agent:', agent.toString());

    try {
        // Use the agent like a local function
        const result = await agent.input('Analyze sales data for Q4 2024');
        console.log('Result:', result);
    } catch (error) {
        console.error('Error:', error.message);
        console.log('\nMake sure:');
        console.log('1. Python agent is running with announce(agent)');
        console.log('2. Agent address matches');
        console.log('3. Relay is accessible (default: wss://oo.openonion.ai)');
    }
}

// Run example
if (require.main === module) {
    main().catch(console.error);
}

export { main };
