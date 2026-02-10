/**
 * @jest-environment jsdom
 *
 * Tests for connectonion/react hooks.
 *
 * Tests cover:
 * - useAgent hook initialization
 * - Reactive state updates
 * - input() method
 * - reset() method
 * - Session persistence
 */

import { renderHook, act, waitFor } from '@testing-library/react';
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
      session: { messages: [{ role: 'user', content: msg.prompt }, { role: 'assistant', content: `Echo: ${msg.prompt}` }] },
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

// Inject mock WebSocket
const mockWsCtor = MockWebSocket as any;

describe('useAgent hook', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('initialization', () => {
    it('initializes with idle status', () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.status).toBe('idle');
    });

    it('initializes with empty UI array', () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.ui).toEqual([]);
    });

    it('initializes isProcessing as false', () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.isProcessing).toBe(false);
    });

    it('initializes error as null', () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.error).toBeNull();
    });

    it('generates a sessionId', () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      expect(result.current.sessionId).toBeDefined();
      expect(typeof result.current.sessionId).toBe('string');
      expect(result.current.sessionId.length).toBeGreaterThan(0);
    });
  });

  describe('input method', () => {
    it('returns Response with text and done', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      let response: any;
      await act(async () => {
        response = await result.current.input('Hello');
      });

      expect(response.text).toBe('Echo: Hello');
      expect(response.done).toBe(true);
    });

    it('updates UI with user event', async () => {
      // Use unique address to avoid cache collision
      const { result } = renderHook(() =>
        useAgent('0xuser-event-test', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('Hello');
      });

      await waitFor(() => {
        const userEvents = result.current.ui.filter(e => e.type === 'user');
        expect(userEvents.length).toBeGreaterThanOrEqual(1);
        expect((userEvents[0] as any).content).toBe('Hello');
      });
    });

    it('updates UI with agent event', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('Hello');
      });

      await waitFor(() => {
        const agentEvents = result.current.ui.filter(e => e.type === 'agent');
        expect(agentEvents.length).toBe(1);
        expect((agentEvents[0] as any).content).toBe('Echo: Hello');
      });
    });

    it('sets status back to idle after completion', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('Hello');
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('reset method', () => {
    it('clears UI events', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('Hello');
      });

      await waitFor(() => {
        expect(result.current.ui.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.ui).toEqual([]);
    });

    it('generates new sessionId', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      const oldSessionId = result.current.sessionId;

      act(() => {
        result.current.reset();
      });

      expect(result.current.sessionId).not.toBe(oldSessionId);
    });

    it('sets status to idle', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.status).toBe('idle');
    });

    it('clears error', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('error handling', () => {
    it('sets error on failure', async () => {
      class ErrorWS extends MockWebSocket {
        send(data: unknown): void {
          const msg = JSON.parse(String(data));
          const out = { type: 'ERROR', input_id: msg.input_id, error: 'Test error' };
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(out) }), 0);
        }
      }

      const { result } = renderHook(() =>
        useAgent('0xabc123', {
          relayUrl: 'ws://localhost',
          wsCtor: ErrorWS as any,
        })
      );

      await act(async () => {
        try {
          await result.current.input('Hello');
        } catch {
          // Expected
        }
      });

      expect(result.current.error).not.toBeNull();
    });
  });

  describe('multiple inputs', () => {
    it('accumulates UI events', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      await act(async () => {
        await result.current.input('First');
      });

      await act(async () => {
        await result.current.input('Second');
      });

      await waitFor(() => {
        const userEvents = result.current.ui.filter(e => e.type === 'user');
        expect(userEvents.length).toBe(2);
      });
    });

    it('works after reset', async () => {
      const { result } = renderHook(() =>
        useAgent('0xabc123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
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

      await waitFor(() => {
        const userEvents = result.current.ui.filter(e => e.type === 'user');
        expect(userEvents.length).toBe(1);
        expect((userEvents[0] as any).content).toBe('After reset');
      });
    });
  });

  describe('session persistence', () => {
    it('generates and maintains sessionId', async () => {
      const { result } = renderHook(() =>
        useAgent('0xpersist-test', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      const sessionId = result.current.sessionId;
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('keeps same sessionId across re-renders', async () => {
      const { result, rerender } = renderHook(() =>
        useAgent('0xsame123', { relayUrl: 'ws://localhost', wsCtor: mockWsCtor })
      );

      const sessionId = result.current.sessionId;

      rerender();

      expect(result.current.sessionId).toBe(sessionId);
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
