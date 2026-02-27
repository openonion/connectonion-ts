import { AgentInfo, ResolvedEndpoint, WebSocketCtor } from './types';

export const DEFAULT_RELAY = 'wss://oo.openonion.ai';

export function defaultWebSocketCtor(): WebSocketCtor {
  const g = globalThis as { WebSocket?: WebSocketCtor };
  if (typeof g.WebSocket === 'function') {
    return g.WebSocket;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WS = require('ws');
  return WS as WebSocketCtor;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isBrowserEnv(): boolean {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
    typeof (globalThis as { localStorage?: unknown }).localStorage !== 'undefined';
}

export function canonicalJSON(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = obj[key];
  }
  return JSON.stringify(sortedObj);
}

export function normalizeRelayBase(relayUrl: string): string {
  let normalized = relayUrl.replace(/\/$/, '');
  if (normalized.endsWith('/ws/announce')) {
    normalized = normalized.slice(0, -('/ws/announce'.length));
  } else if (normalized.endsWith('/ws')) {
    normalized = normalized.slice(0, -('/ws'.length));
  }
  return normalized;
}

function sortEndpoints(endpoints: string[]): string[] {
  return [...endpoints].sort((a, b) => {
    const getPriority = (url: string): number => {
      if (url.includes('localhost') || url.includes('127.0.0.1')) return 0;
      if (url.includes('192.168.') || url.includes('10.') || url.includes('172.16.')) return 1;
      return 2;
    };
    return getPriority(a) - getPriority(b);
  });
}

export async function resolveEndpoint(
  agentAddress: string,
  relayUrl: string,
  timeoutMs = 3000
): Promise<ResolvedEndpoint | null> {
  const normalizedRelay = normalizeRelayBase(relayUrl);
  const httpsRelay = normalizedRelay.replace(/^wss?:\/\//, 'https://');

  let agentInfo: { endpoints?: string[]; relay?: string; last_seen?: string };
  try {
    const response = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    agentInfo = await response.json();
  } catch {
    return null;
  }

  if (!agentInfo.endpoints?.length) {
    return null;
  }

  const sortedEndpoints = sortEndpoints(agentInfo.endpoints);
  const httpEndpoints = sortedEndpoints.filter(ep => ep.startsWith('http://') || ep.startsWith('https://'));

  for (const httpUrl of httpEndpoints) {
    try {
      const infoResponse = await fetch(`${httpUrl}/info`, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!infoResponse.ok) continue;

      const info = await infoResponse.json() as { address?: string };

      if (info.address === agentAddress) {
        const baseUrl = httpUrl.replace(/^https?:\/\//, '');
        const protocol = httpUrl.startsWith('https') ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${baseUrl}/ws`;
        return { httpUrl, wsUrl };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Fetch agent info by resolving through relay then hitting /info endpoint.
 *
 * @param agentAddress - Agent's public address (0x...)
 * @param relayUrl - Relay server URL (default: wss://oo.openonion.ai)
 * @returns Agent info including name, tools, trust level, and online status
 *
 * @example
 * ```typescript
 * import { fetchAgentInfo } from 'connectonion';
 *
 * const info = await fetchAgentInfo('0x3d4017c3...');
 * console.log(info.name);    // "my-agent"
 * console.log(info.online);  // true
 * console.log(info.tools);   // ["search", "calculate"]
 * ```
 */
export async function fetchAgentInfo(
  agentAddress: string,
  relayUrl = DEFAULT_RELAY,
): Promise<AgentInfo> {
  const normalizedRelay = normalizeRelayBase(relayUrl);
  const httpsRelay = normalizedRelay.replace(/^wss?:\/\//, 'https://');

  let agentData: { endpoints?: string[] };
  try {
    const response = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      agentData = { endpoints: ['http://localhost:8000'] };
    } else {
      agentData = await response.json();
    }
  } catch {
    agentData = { endpoints: ['http://localhost:8000'] };
  }

  const endpoints = agentData.endpoints?.length
    ? agentData.endpoints
    : ['http://localhost:8000'];

  const httpEndpoints = sortEndpoints(
    endpoints.filter(ep => ep.startsWith('http://') || ep.startsWith('https://'))
  );

  for (const httpUrl of httpEndpoints) {
    try {
      const infoResponse = await fetch(`${httpUrl}/info`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!infoResponse.ok) continue;

      const info = await infoResponse.json() as {
        name?: string; address?: string; tools?: string[];
        trust?: string; version?: string;
      };

      if (info.address === agentAddress) {
        return {
          address: agentAddress,
          name: info.name,
          tools: info.tools,
          trust: info.trust,
          version: info.version,
          online: true,
        };
      }
    } catch {
      continue;
    }
  }

  return { address: agentAddress, online: false };
}
