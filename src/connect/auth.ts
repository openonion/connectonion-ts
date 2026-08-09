/**
 * @llm-note
 *   Dependencies: imports from [src/address] | imported by [src/connect/remote-agent.ts, src/connect/handlers.ts]
 *   Data flow: ensureKeys resolves or generates Ed25519 keypair | signPayload signs messages for authenticated requests
 *   State/Effects: ensureKeys may write to localStorage (browser) | no persistent module state
 */
import * as address from '../address';

export function isBrowser(): boolean {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
    typeof (globalThis as { localStorage?: unknown }).localStorage !== 'undefined';
}

function sortForSigning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSigning);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortForSigning(source[key]);
    }
    return sorted;
  }
  return value;
}

export function sortedStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(sortForSigning(obj));
}

export function ensureKeys(existing?: address.AddressData): address.AddressData {
  if (existing) return existing;
  const inBrowser = isBrowser();
  const loaded = inBrowser ? address.loadBrowser() : address.load();
  if (loaded) return loaded;
  const keys = inBrowser ? address.generateBrowser() : address.generate();
  if (inBrowser) address.saveBrowser(keys);
  return keys;
}

/**
 * Sign a payload with Ed25519 keys.
 * Returns the signed envelope { payload, from, signature, timestamp }
 * or a fallback { prompt } if no keys provided.
 */
export function signPayload(
  keys: address.AddressData | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!keys) {
    return { prompt: payload.prompt };
  }
  const canonicalMessage = sortedStringify(payload);
  const signer = isBrowser() ? address.signBrowser : address.sign;
  const signature = signer(keys, canonicalMessage);
  return {
    payload,
    from: keys.address,
    signature,
    timestamp: payload.timestamp,
  };
}
