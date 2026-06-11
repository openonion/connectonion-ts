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

type RelayRuntimeMetadata = {
  name?: string;
  tools?: unknown;
  skills?: unknown;
  trust?: string;
  version?: string;
  model?: string;
};

type DirectAgentInfo = {
  name?: string;
  address?: string;
  tools?: unknown;
  skills?: unknown;
  trust?: string;
  version?: string;
  model?: string;
};

function normalizeTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tools = value
    .map((tool) => {
      if (typeof tool === 'string') return tool;
      if (tool && typeof tool === 'object') {
        const name = (tool as { name?: unknown }).name;
        return typeof name === 'string' ? name : undefined;
      }
      return undefined;
    })
    .filter((name): name is string => Boolean(name));

  return tools.length > 0 ? tools : undefined;
}

function normalizeSkills(value: unknown): AgentInfo['skills'] | undefined {
  if (!Array.isArray(value)) return undefined;

  const skills = value
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const skill = item as { name?: unknown; description?: unknown; location?: unknown };
      if (typeof skill.name !== 'string' || !skill.name) return undefined;

      const normalized: NonNullable<AgentInfo['skills']>[number] = {
        name: skill.name,
        description: typeof skill.description === 'string' ? skill.description : '',
      };
      if (typeof skill.location === 'string' && skill.location) {
        normalized.location = skill.location;
      }
      return normalized;
    })
    .filter((skill): skill is NonNullable<AgentInfo['skills']>[number] => Boolean(skill));

  return skills.length > 0 ? skills : undefined;
}

function metadataToAgentInfo(metadata?: RelayRuntimeMetadata | null): Partial<AgentInfo> {
  const info: Partial<AgentInfo> = {};
  const tools = normalizeTools(metadata?.tools);
  const skills = normalizeSkills(metadata?.skills);

  if (metadata?.name) info.name = metadata.name;
  if (tools) info.tools = tools;
  if (skills) info.skills = skills;
  if (metadata?.trust) info.trust = metadata.trust;
  if (metadata?.version) info.version = metadata.version;
  if (metadata?.model) info.model = metadata.model;

  return info;
}

function directInfoToAgentInfo(info: DirectAgentInfo): Partial<AgentInfo> {
  const normalized: Partial<AgentInfo> = {};
  const tools = normalizeTools(info.tools);
  const skills = normalizeSkills(info.skills);

  if (info.name) normalized.name = info.name;
  if (tools) normalized.tools = tools;
  if (skills) normalized.skills = skills;
  if (info.trust) normalized.trust = info.trust;
  if (info.version) normalized.version = info.version;
  if (info.model) normalized.model = info.model;

  return normalized;
}

function mergeAgentInfo(base: AgentInfo, override: Partial<AgentInfo>): AgentInfo {
  return {
    address: base.address,
    name: override.name ?? base.name,
    tools: override.tools ?? base.tools,
    skills: override.skills ?? base.skills,
    trust: override.trust ?? base.trust,
    version: override.version ?? base.version,
    model: override.model ?? base.model,
    online: override.online ?? base.online,
  };
}

export async function resolveEndpoint(
  agentAddress: string,
  relayUrl: string,
  timeoutMs = 3000
): Promise<ResolvedEndpoint | null> {
  const normalizedRelay = normalizeRelayUrl(relayUrl);
  const httpsRelay = normalizedRelay.replace(/^wss?:\/\//, 'https://');

  // Outer lookup — on any fetch failure (DNS/TLS/timeout/CORS) resolve to
  // null so RemoteAgent falls back to the relay /ws/input path. Swallowing
  // here is the contract, not hiding a bug.
  const agentInfo = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(r => r.ok ? r.json() as Promise<{ endpoints?: string[] }> : null)
    .catch(() => null);

  if (!agentInfo?.endpoints?.length) return null;

  const httpEndpoints = sortByProximity(agentInfo.endpoints).filter(ep => ep.startsWith('http'));

  for (const httpUrl of httpEndpoints) {
    // Probe — many advertised endpoints (localhost, docker IPs, NAT-bound
    // public IPs) will fail from the caller's network. A single failure
    // must not abort the loop.
    const info = await fetch(`${httpUrl}/info`, { signal: AbortSignal.timeout(timeoutMs) })
      .then(r => r.ok ? r.json() as Promise<{ address?: string }> : null)
      .catch(() => null);

    if (info?.address === agentAddress) {
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

  // Outer lookup — fetch failures surface as "offline" rather than crashing.
  const relayData = await fetch(`${httpsRelay}/api/relay/agents/${agentAddress}`, {
    signal: AbortSignal.timeout(5000),
  })
    .then(r => r.ok ? r.json() as Promise<{ endpoints?: string[]; last_seen?: string | null; metadata?: RelayRuntimeMetadata | null }> : null)
    .catch(() => null);

  if (!relayData) return { address: agentAddress, online: false };

  const isOnline = Boolean(relayData.last_seen) || Boolean(relayData.endpoints?.length);
  const fallbackInfo: AgentInfo = {
    address: agentAddress,
    ...metadataToAgentInfo(relayData.metadata),
    online: isOnline,
  };

  const httpEndpoints = sortByProximity(
    (relayData.endpoints ?? []).filter(ep => ep.startsWith('http'))
  );

  for (const httpUrl of httpEndpoints) {
    // Probe each endpoint; unreachable ones yield null and we move on.
    const info = await fetch(`${httpUrl}/info`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() as Promise<DirectAgentInfo> : null)
      .catch(() => null);

    if (info?.address === agentAddress) {
      return mergeAgentInfo(fallbackInfo, directInfoToAgentInfo(info));
    }
  }

  return fallbackInfo;
}
