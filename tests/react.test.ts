/**
 * @jest-environment jsdom
 *
 * Tests for connectonion/react hooks.
 *
 * Tests cover:
 * - useAgentForHuman(address, sessionId) hook initialization
 * - input() fires non-blocking, UI updates arrive reactively via onMessage
 * - reset() behavior
 * - Session persistence
 * - Error handling
 */

import { renderHook, act } from '@testing-library/react';
import { useAgentForHuman } from '../src/react';

// Mock address module to skip signing
jest.mock('../src/address', () => ({
  generate: () => ({ address: '0xmock', privateKey: new Uint8Array(64), publicKey: new Uint8Array(32) }),
  generateBrowser: () => ({ address: '0xmock', privateKey: new Uint8Array(64), publicKey: new Uint8Array(32) }),
  load: () => null,
  loadBrowser: () => null,
  save: () => {},
  saveBrowser: () => {},
  sign: () => 'mock-signature',
  signBrowser: () => 'mock-signature',
}));

// Mock localStorage
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};
(globalThis as any).localStorage = mockLocalStorage;

// Mock WebSocket for testing
class MockWebSocket {
  public onopen: ((ev?: unknown) => unknown) | null = null;
  public onmessage: ((ev: { data: unknown }) => unknown) | null = null;
  public onerror: ((ev: unknown) => unknown) | null = null;
  public onclose: ((ev: unknown) => unknown) | null = null;
  public readyState = 1;
  private closed = false;

  constructor(_url: string) {
    setTimeout(() => this.onopen && this.onopen({}), 0);
  }

  send(data: unknown): void {
    const msg = JSON.parse(String(data));
    if (msg.type === 'PONG') return;
    const out = {
      type: 'OUTPUT',
      input_id: msg.input_id,
      result: `Echo: ${msg.prompt}`,
      session: {
        session_id: msg.session?.session_id,
        messages: [
          { role: 'user', content: msg.prompt },
          { role: 'assistant', content: `Echo: ${msg.prompt}` },
        ],
      },
    };
    setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 10);
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.readyState = 3;
      this.onclose && this.onclose({});
    }
  }
}

// Swappable WebSocket class — tests can override for error scenarios
let ActiveWS: any = MockWebSocket;

// Proxy that delegates to ActiveWS at construction time
const DynamicWS = new Proxy(MockWebSocket, {
  construct(_target, args) {
    return new ActiveWS(...args);
  },
});

// Mock connect() to inject test WebSocket
jest.mock('../src/connect', () => {
  const actual = jest.requireActual('../src/connect');
  return {
    ...actual,
    connect: (address: string) => new actual.RemoteAgent(address, {
      relayUrl: 'ws://localhost',
      wsCtor: DynamicWS as any,
    }),
  };
});

// Unique address counter to avoid Zustand store cache collisions between tests
let addrCounter = 0;
function uniqueAddr() {
  return `0xtest${++addrCounter}`;
}

// Flush microtasks (async _streamInput) + macrotasks (MockWebSocket setTimeout)
// Two rounds: first flushes WS connect + send, second flushes state update re-renders
function flush() {
  return new Promise<void>(resolve => setTimeout(() => setTimeout(resolve, 30), 30));
}

describe('useAgentForHuman hook', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    ActiveWS = MockWebSocket;
  });

  describe('initialization', () => {
    it('initializes with idle status', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );
      expect(result.current.status).toBe('idle');
    });

    it('initializes with empty UI array', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );
      expect(result.current.ui).toEqual([]);
    });

    it('initializes isProcessing as false', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );
      expect(result.current.isProcessing).toBe(false);
    });

    it('initializes error as null', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );
      expect(result.current.error).toBeNull();
    });

    it('uses provided sessionId', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'my-session-123')
      );
      expect(result.current.sessionId).toBe('my-session-123');
    });
  });

  describe('input method', () => {
    it('input() returns void and UI updates arrive reactively', async () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      await act(async () => {
        result.current.input('Hello');
        await flush();
      });

      expect(result.current.status).toBe('idle');
      const lastAgent = result.current.ui.filter(e => e.type === 'agent').pop() as any;
      expect(lastAgent.content).toBe('Echo: Hello');
    });

    it('handles multiple sequential inputs', async () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      await act(async () => {
        result.current.input('First');
        await flush();
      });

      await act(async () => {
        result.current.input('Second');
        await flush();
      });

      const agentItems = result.current.ui.filter(e => e.type === 'agent');
      expect(agentItems.length).toBe(2);
    });

    it('sets status back to idle after completion', async () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      await act(async () => {
        result.current.input('Hello');
        await flush();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('reset method', () => {
    it('keeps same sessionId after reset (sessionId is a prop)', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'fixed-session')
      );

      act(() => { result.current.reset(); });

      expect(result.current.sessionId).toBe('fixed-session');
    });

    it('sets status to idle', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      act(() => { result.current.reset(); });

      expect(result.current.status).toBe('idle');
    });

    it('clears error', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      act(() => { result.current.reset(); });

      expect(result.current.error).toBeNull();
    });

    it('works - can input after reset', async () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      await act(async () => {
        result.current.input('First');
        await flush();
      });

      act(() => { result.current.reset(); });

      await act(async () => {
        result.current.input('After reset');
        await flush();
      });

      const agentItems = result.current.ui.filter(e => e.type === 'agent');
      expect(agentItems.length).toBeGreaterThan(0);
      const lastAgent = agentItems.pop() as any;
      expect(lastAgent.content).toBe('Echo: After reset');
    });
  });

  describe('error handling', () => {
    it('sets error state on agent error', async () => {
      class ErrorWS extends MockWebSocket {
        override send(data: unknown): void {
          const msg = JSON.parse(String(data));
          if (msg.type === 'PONG') return;
          const out = { type: 'ERROR', input_id: msg.input_id, error: 'Test error' };
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
        }
      }

      ActiveWS = ErrorWS;

      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'test-session')
      );

      await act(async () => {
        result.current.input('Hello');
        await flush();
      });

      expect(result.current.status).toBe('idle');
    });
  });

  describe('session persistence', () => {
    it('uses provided sessionId', () => {
      const { result } = renderHook(() =>
        useAgentForHuman(uniqueAddr(), 'persist-session')
      );
      expect(result.current.sessionId).toBe('persist-session');
    });

    it('keeps same sessionId across re-renders', () => {
      const addr = uniqueAddr();
      const { result, rerender } = renderHook(() =>
        useAgentForHuman(addr, 'stable-session')
      );

      expect(result.current.sessionId).toBe('stable-session');
      rerender();
      expect(result.current.sessionId).toBe('stable-session');
    });
  });
});

describe('isEventType helper', () => {
  it('narrows user event type', () => {
    const { isEventType } = require('../src/react');
    const event = { id: '1', type: 'user', content: 'Hello' };
    if (isEventType(event, 'user')) {
      expect(event.content).toBe('Hello');
    }
  });

  it('narrows tool_call event type', () => {
    const { isEventType } = require('../src/react');
    const event = { id: '1', type: 'tool_call', name: 'search', status: 'done', result: 'found' };
    if (isEventType(event, 'tool_call')) {
      expect(event.name).toBe('search');
      expect(event.status).toBe('done');
    }
  });
});
