/**
 * @jest-environment jsdom
 *
 * Tests for connectonion/react hooks.
 *
 * Tests cover:
 * - useAgent hook initialization
 * - input() returns correct Response
 * - reset() behavior
 * - Session persistence config
 * - Error handling
 */

import { renderHook, act } from '@testing-library/react';
import { useAgent } from '../src/react';

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
      this.onclose && this.onclose({});
    }
  }
}

const mockWsCtor = MockWebSocket as any;

// Unique address counter to avoid Zustand store cache collisions between tests
let addrCounter = 0;
function uniqueAddr() {
  return `0xtest${++addrCounter}`;
}

describe('useAgent hook', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('initialization', () => {
    it('initializes with idle status', () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.status).toBe('idle');
    });

    it('initializes with empty UI array', () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.ui).toEqual([]);
    });

    it('initializes isProcessing as false', () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.isProcessing).toBe(false);
    });

    it('initializes error as null', () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.error).toBeNull();
    });

    it('uses provided sessionId', () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'my-session-123', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.sessionId).toBe('my-session-123');
    });
  });

  describe('input method', () => {
    it('returns Response with text and done', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      let response: any;
      await act(async () => {
        response = await result.current.input('Hello');
      });

      expect(response.text).toBe('Echo: Hello');
      expect(response.done).toBe(true);
    });

    it('handles multiple sequential inputs', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      let r1: any, r2: any;
      await act(async () => {
        r1 = await result.current.input('First');
      });
      await act(async () => {
        r2 = await result.current.input('Second');
      });

      expect(r1.text).toBe('Echo: First');
      expect(r2.text).toBe('Echo: Second');
    });

    it('sets status back to idle after completion', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('Hello');
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('reset method', () => {
    it('keeps same sessionId after reset (sessionId is a prop)', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'fixed-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.sessionId).toBe('fixed-session');
    });

    it('sets status to idle', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.status).toBe('idle');
    });

    it('clears error', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
    });

    it('works - can input after reset', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'test-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('First');
      });

      act(() => {
        result.current.reset();
      });

      let response: any;
      await act(async () => {
        response = await result.current.input('After reset');
      });

      expect(response.text).toBe('Echo: After reset');
    });
  });

  describe('error handling', () => {
    it('throws on agent error', async () => {
      class ErrorWS extends MockWebSocket {
        send(data: unknown): void {
          const msg = JSON.parse(String(data));
          const out = { type: 'ERROR', input_id: msg.input_id, error: 'Test error' };
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
        }
      }

      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), {
          sessionId: 'test-session',
          relayUrl: 'ws://localhost',
          wsCtor: ErrorWS as any,
        })
      );

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.input('Hello');
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain('Test error');
    });
  });

  describe('session persistence', () => {
    it('uses provided sessionId', async () => {
      const { result } = renderHook(() =>
        useAgent(uniqueAddr(), { sessionId: 'persist-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.sessionId).toBe('persist-session');
    });

    it('keeps same sessionId across re-renders', async () => {
      const addr = uniqueAddr();
      const { result, rerender } = renderHook(() =>
        useAgent(addr, { sessionId: 'stable-session', relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
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
