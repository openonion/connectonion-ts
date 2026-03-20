/**
 * @llm-note
 *   Dependencies: imports from [src/connect/types] | imported by [src/connect/remote-agent.ts, src/connect/handlers.ts, src/connect/index.ts]
 *   Data flow: resolveEndpoint fetches agent endpoints from relay → verifies identity → returns {httpUrl, wsUrl}
 *   State/Effects: HTTP fetch requests to relay/agent endpoints (timeout-bounded) | no persistent state
 *   Integration: exposes resolveEndpoint(), fetchAgentInfo(), getWebSocketCtor(), generateUUID(), normalizeRelayUrl(), DEFAULT_RELAY
 */
import { AgentInfo, ResolvedEndpoint, WebSocketCtor } from './types';

export const DEFAULT_RELAY = 'wss://oo.openonion.ai';

export function getWebSocketCtor(): WebSocketCtor {
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function normalizeRelayUrl(relayUrl: string): string {
  let normalized = relayUrl.replace(/\/$/, '');
  if (normalized.endsWith('/ws/announce')) {
    normalized = normalized.slice(0, -('/ws/announce'.length));
  } else if (normalized.endsWith('/ws')) {
    normalized = normalized.slice(0, -('/ws'.length));
  }
  return normalized;
}

function sortByProximity(endpoints: string[]): string[] {
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
  const normalizedRelay = normalizeRelayUrl(relayUrl);
  const httpsRelay = normalizedRelay.replace(/^wss?:\/\//, 'https://');

  const response = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;

  const agentInfo = await response.json() as { endpoints?: string[] };
  if (!agentInfo.endpoints?.length) return null;

  const httpEndpoints = sortByProximity(agentInfo.endpoints).filter(ep => ep.startsWith('http'));

  for (const httpUrl of httpEndpoints) {
    const infoResponse = await fetch(`${httpUrl}/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!infoResponse.ok) continue;

    const info = await infoResponse.json() as { address?: string };
    if (info.address === agentAddress) {
      const baseUrl = httpUrl.replace(/^https?:\/\//, '');
      const protocol = httpUrl.startsWith('https') ? 'wss' : 'ws';
      return { httpUrl, wsUrl: `${protocol}://${baseUrl}/ws` };
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
  const httpsRelay = normalizeRelayUrl(relayUrl).replace(/^wss?:\/\//, 'https://');

  const relayRes = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!relayRes.ok) return { address: agentAddress, online: false };

  const { endpoints = [] } = await relayRes.json() as { endpoints?: string[] };
  const httpEndpoints = sortByProximity(endpoints.filter(ep => ep.startsWith('http')));

  for (const httpUrl of httpEndpoints) {
    const infoRes = await fetch(`${httpUrl}/info`, { signal: AbortSignal.timeout(3000) });
    if (!infoRes.ok) continue;

    const info = await infoRes.json() as {
      name?: string; address?: string; tools?: string[];
      skills?: Array<{name: string; description: string; location: string}>;
      trust?: string; version?: string;
    };
    if (info.address === agentAddress) {
      return { address: agentAddress, name: info.name, tools: info.tools, skills: info.skills, trust: info.trust, version: info.version, online: true };
    }
  }

  return { address: agentAddress, online: false };
}
