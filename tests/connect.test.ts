/**
 * Tests for connect() RemoteAgent with streaming, UI events, and Response type.
 *
 * Tests cover:
 * - Response type (text, done properties)
 * - UI events (user, agent, tool_call, tool_result merging)
 * - Status property (idle, working, waiting)
 * - currentSession property
 * - ask_user handling (status: waiting, UI events)
 * - Signing and relay fallback
 * - PING/PONG keep-alive mechanism
 * - Session recovery via polling
 * - Timeout and error handling with fallback
 */

import { connect, RemoteAgent } from '../src/connect';
import * as address from '../src/address';

// Mock WebSocket that returns OUTPUT immediately
class MockWebSocket {
  public onopen: ((ev?: unknown) => unknown) | null = null;
  public onmessage: ((ev: { data: unknown }) => unknown) | null = null;
  public onerror: ((ev: unknown) => unknown) | null = null;
  public onclose: ((ev: unknown) => unknown) | null = null;
  private closed = false;

  constructor(_url: string) {
    setTimeout(() => this.onopen && this.onopen({}), 0);
  }

  send(data: unknown): void {
    const msg = JSON.parse(String(data));
    const out = {
      type: 'OUTPUT',
      input_id: msg.input_id,
      result: `Echo: ${msg.prompt}`,
      session: { messages: [] },
    };
    setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.onclose && this.onclose({});
    }
  }
}

describe('Response type', () => {
  it('has text and done properties', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    const response = await agent.input('ping');

    expect(response).toHaveProperty('text');
    expect(response).toHaveProperty('done');
    expect(response.text).toBe('Echo: ping');
    expect(response.done).toBe(true);
  });
});

describe('RemoteAgent creation', () => {
  it('creates RemoteAgent with address', () => {
    const agent = connect('0xabc123');

    expect(agent).toBeInstanceOf(RemoteAgent);
    expect(agent.address).toBe('0xabc123');
    expect(agent.agentAddress).toBe('0xabc123'); // backwards compat
  });

  it('accepts signing keys option', () => {
    const keys = address.generate();
    const agent = connect('0xabc123', { keys });

    expect(agent.address).toBe('0xabc123');
  });

  it('accepts custom relay URL', () => {
    const agent = connect('0xabc123', { relayUrl: 'wss://custom.relay/ws' });

    expect(agent.address).toBe('0xabc123');
  });

  it('toString() returns short representation', () => {
    const agent = connect('0x1234567890abcdef');

    expect(agent.toString()).toBe('RemoteAgent(0x1234567890...)');
  });

  it('initializes with idle status', () => {
    const agent = connect('0xabc123');

    expect(agent.status).toBe('idle');
  });

  it('initializes with null currentSession', () => {
    const agent = connect('0xabc123');

    expect(agent.currentSession).toBeNull();
  });

  it('initializes with empty ui array', () => {
    const agent = connect('0xabc123');

    expect(agent.ui).toEqual([]);
  });
});

describe('Status management', () => {
  it('sets status to working during execution', async () => {
    class DelayedWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        const out = {
          type: 'OUTPUT',
          input_id: msg.input_id,
          result: 'done',
          session: {},
        };
        // Delay response to allow status check
        setTimeout(() => {
          this.onmessage && this.onmessage({ data: JSON.stringify(out) });
        }, 10);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: DelayedWS as any,
    });

    const promise = agent.input('test');

    // Give time for WebSocket to open and send
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(agent.status).toBe('working');

    await promise;
    expect(agent.status).toBe('idle');
  });

  it('sets status to waiting on ask_user', async () => {
    class AskUserWS extends MockWebSocket {
      send(_data: unknown): void {
        const out = { type: 'ask_user', text: 'What color?' };
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: AskUserWS as any,
    });

    // Don't await - ask_user keeps the promise pending
    agent.input('Choose');

    // Wait for ask_user event to be processed
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(agent.status).toBe('waiting');

    // Clean up
    agent.reset();
  });

  it('resets status to idle on error', async () => {
    class ErrorWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        const out = { type: 'ERROR', input_id: msg.input_id, error: 'failed' };
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: ErrorWS as any,
    });

    await expect(agent.input('test')).rejects.toThrow();
    expect(agent.status).toBe('idle');
  });
});

describe('UI events', () => {
  it('adds user event on input', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('Hello');

    const userEvents = agent.ui.filter(e => e.type === 'user');
    expect(userEvents.length).toBe(1);
    expect((userEvents[0] as any).content).toBe('Hello');
  });

  it('adds agent event on OUTPUT', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('Hello');

    const agentEvents = agent.ui.filter(e => e.type === 'agent');
    expect(agentEvents.length).toBe(1);
    expect((agentEvents[0] as any).content).toBe('Echo: Hello');
  });

  it('adds tool_call event on tool_call stream', async () => {
    class ToolCallWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        // Send tool_call event
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'tool_call', tool_id: 't1', name: 'search', args: { q: 'test' } })
          });
        }, 0);
        // Then send OUTPUT
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'OUTPUT', input_id: msg.input_id, result: 'done', session: {} })
          });
        }, 5);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: ToolCallWS as any,
    });

    await agent.input('Search');

    const toolEvents = agent.ui.filter(e => e.type === 'tool_call');
    expect(toolEvents.length).toBe(1);
    expect((toolEvents[0] as any).name).toBe('search');
    expect((toolEvents[0] as any).status).toBe('running');
  });

  it('merges tool_result into existing tool_call', async () => {
    class ToolResultWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        // Send tool_call
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'tool_call', tool_id: 't1', name: 'search', args: {} })
          });
        }, 0);
        // Send tool_result with same id
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'tool_result', tool_id: 't1', result: 'Found 3 results', status: 'success' })
          });
        }, 2);
        // Then send OUTPUT
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'OUTPUT', input_id: msg.input_id, result: 'done', session: {} })
          });
        }, 5);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: ToolResultWS as any,
    });

    await agent.input('Search');

    // Should have only ONE tool_call event (merged)
    const toolEvents = agent.ui.filter(e => e.type === 'tool_call');
    expect(toolEvents.length).toBe(1);
    expect((toolEvents[0] as any).status).toBe('done');
    expect((toolEvents[0] as any).result).toBe('Found 3 results');
  });

  it('adds thinking event', async () => {
    class ThinkingWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        setTimeout(() => {
          this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'thinking' }) });
        }, 0);
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'OUTPUT', input_id: msg.input_id, result: 'done', session: {} })
          });
        }, 5);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: ThinkingWS as any,
    });

    await agent.input('Think');

    const thinkingEvents = agent.ui.filter(e => e.type === 'thinking');
    expect(thinkingEvents.length).toBe(1);
  });

  it('adds ask_user event', async () => {
    class AskUserWS extends MockWebSocket {
      send(_data: unknown): void {
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({ type: 'ask_user', text: 'Which color?' })
          });
        }, 0);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: AskUserWS as any,
    });

    // Don't await - ask_user keeps the promise pending (agent waits for respond())
    agent.input('Choose');

    // Wait for ask_user event to be processed
    await new Promise(resolve => setTimeout(resolve, 50));

    const askEvents = agent.ui.filter(e => e.type === 'ask_user');
    expect(askEvents.length).toBe(1);
    expect((askEvents[0] as any).text).toBe('Which color?');

    // Clean up
    agent.reset();
  });

  it('generates unique IDs for events without IDs', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('First');
    await agent.input('Second');

    const ids = agent.ui.map(e => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('Session management', () => {
  it('reset() clears session, UI, and status', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('message');
    expect(agent.ui.length).toBeGreaterThan(0);
    expect(agent.currentSession).not.toBeNull();

    agent.reset();

    expect(agent.ui).toEqual([]);
    expect(agent.currentSession).toBeNull();
    expect(agent.status).toBe('idle');
  });

  it('resetConversation() is alias for reset()', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('message');
    agent.resetConversation();

    expect(agent.ui).toEqual([]);
    expect(agent.currentSession).toBeNull();
  });

  it('syncs currentSession from server', async () => {
    class SessionWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        const out = {
          type: 'OUTPUT',
          input_id: msg.input_id,
          result: 'done',
          session: { messages: [{ role: 'user', content: 'test' }], turn: 1 },
        };
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: SessionWS as any,
    });

    await agent.input('test');

    expect(agent.currentSession).not.toBeNull();
    expect(agent.currentSession?.messages?.length).toBe(1);
    expect(agent.currentSession?.turn).toBe(1);
  });

  it('syncs session from streaming events', async () => {
    class StreamSessionWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        // Send thinking event with session
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({
              type: 'thinking',
              session: { messages: [{ role: 'user', content: 'test' }], turn: 1 },
            })
          });
        }, 0);
        // Then OUTPUT
        setTimeout(() => {
          this.onmessage && this.onmessage({
            data: JSON.stringify({
              type: 'OUTPUT',
              input_id: msg.input_id,
              result: 'done',
              session: { messages: [{ role: 'user', content: 'test' }, { role: 'assistant', content: 'done' }], turn: 1 },
            })
          });
        }, 5);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: StreamSessionWS as any,
    });

    await agent.input('test');

    expect(agent.currentSession).not.toBeNull();
    expect(agent.currentSession?.messages?.length).toBe(2);
  });

  it('preserves session across multiple inputs', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('first');
    const firstSession = agent.currentSession;
    expect(firstSession).not.toBeNull();

    await agent.input('second');
    // Session should still exist (not cleared on success)
    expect(agent.currentSession).not.toBeNull();
  });

  it('works after reset', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    await agent.input('first');
    agent.reset();
    const response = await agent.input('new');

    expect(response.text).toBe('Echo: new');
  });
});

describe('relay fallback', () => {
  it('uses relay WebSocket', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    const response = await agent.input('ping');

    expect(response.text).toBe('Echo: ping');
    expect(response.done).toBe(true);
  });

  it('rejects on ERROR response', async () => {
    class ErrorWS extends MockWebSocket {
      send(data: unknown): void {
        const msg = JSON.parse(String(data));
        const out = { type: 'ERROR', input_id: msg.input_id, error: 'not found' };
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
      }
    }

    const agent = connect('0xdeadbeef', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: ErrorWS as any,
    });

    await expect(agent.input('hello')).rejects.toThrow(/not found/);
  });

  it('times out if no response', async () => {
    class NoReplyWS extends MockWebSocket {
      send(_data: unknown): void {
        // never replies
      }
    }

    const agent = connect('0xabc', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: NoReplyWS as any,
      enablePolling: false, // Disable polling so timeout rejects immediately
    });

    await expect(agent.input('hello', 50)).rejects.toThrow(/timed out/);
  });
});

describe('signed requests', () => {
  it('includes signature when keys provided', async () => {
    const keys = address.generate();
    let capturedMessage: Record<string, unknown> | null = null;

    class CapturingWS extends MockWebSocket {
      send(data: unknown): void {
        capturedMessage = JSON.parse(String(data));
        super.send(data);
      }
    }

    const agent = connect('0xabc123', {
      keys,
      relayUrl: 'ws://localhost:8000',
      wsCtor: CapturingWS as any,
    });

    await agent.input('test');

    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!.from).toBe(keys.address);
    expect(capturedMessage!.signature).toMatch(/^[a-f0-9]{128}$/);
    expect(capturedMessage!.timestamp).toBeGreaterThan(0);
  });

  it('auto-generates keys when none provided', async () => {
    let capturedMessage: Record<string, unknown> | null = null;

    class CapturingWS extends MockWebSocket {
      send(data: unknown): void {
        capturedMessage = JSON.parse(String(data));
        super.send(data);
      }
    }

    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: CapturingWS as any,
    });

    await agent.input('test');

    // Keys are auto-generated on first use, so from and signature should be present
    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!.from).toBeDefined();
    expect(capturedMessage!.signature).toBeDefined();
  });

  it('signature is verifiable', async () => {
    const keys = address.generate();
    let capturedMessage: Record<string, unknown> | null = null;

    class CapturingWS extends MockWebSocket {
      send(data: unknown): void {
        capturedMessage = JSON.parse(String(data));
        super.send(data);
      }
    }

    const agent = connect('0xabc123', {
      keys,
      relayUrl: 'ws://localhost:8000',
      wsCtor: CapturingWS as any,
    });

    await agent.input('hello world');

    // Verify the signature
    const payload = {
      prompt: 'hello world',
      to: '0xabc123',
      timestamp: capturedMessage!.timestamp,
    };
    const sortedKeys = Object.keys(payload).sort();
    const sortedPayload: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedPayload[key] = payload[key as keyof typeof payload];
    }
    const canonical = JSON.stringify(sortedPayload);

    const valid = address.verify(
      keys.address,
      canonical,
      capturedMessage!.signature as string
    );
    expect(valid).toBe(true);
  });
});

describe('signed request body format', () => {
  it('matches expected format for strict trust agents', () => {
    const keys = address.generate();
    const prompt = 'Test prompt';
    const toAddress = '0x' + 'a'.repeat(64);

    const signed = address.createSignedPayload(keys, prompt, toAddress);

    // Verify structure matches what agents expect
    expect(signed).toHaveProperty('payload');
    expect(signed).toHaveProperty('from');
    expect(signed).toHaveProperty('signature');

    expect(signed.payload).toHaveProperty('prompt', prompt);
    expect(signed.payload).toHaveProperty('to', toAddress);
    expect(signed.payload).toHaveProperty('timestamp');

    expect(signed.from).toBe(keys.address);
    expect(typeof signed.signature).toBe('string');
  });
});

describe('inputAsync', () => {
  it('is alias for input', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: MockWebSocket as any,
    });

    const response = await agent.inputAsync('ping');

    expect(response.text).toBe('Echo: ping');
    expect(response.done).toBe(true);
  });
});
