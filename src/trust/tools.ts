/**
 * @purpose Trust verification tools for whitelist checks and capability testing (minimal Python parity)
 *
 * @graph Whitelist Check Flow
 *
 *   checkWhitelist(agentId)
 *        │
 *        ▼
 *   ┌──────────────────────────────────┐
 *   │  ~/.connectonion/trusted.txt     │
 *   │                                  │
 *   │  *              ← match all      │
 *   │  0xabc123*      ← prefix match   │
 *   │  0xdef456...    ← exact match    │
 *   └──────────────┬───────────────────┘
 *                  │
 *        ┌─────────┴─────────┐
 *        ▼                   ▼
 *   "allowed"            "not found"
 *
 * @graph Trust Tool Integration
 *
 *   Trust Agent (future)
 *        │
 *        ├──▶ checkWhitelist(id)   → "allowed" / "not found"
 *        ├──▶ testCapability(...)  → capability test result
 *        └──▶ verifyAgent(id)     → verification request
 *
 * @llm-note
 *   Dependencies: imports from [fs, os, path (Node.js built-ins)] | imported by [src/index.ts] | tested manually
 *   Data flow: checkWhitelist(agentId) → reads ~/.connectonion/trusted.txt → matches agentId against patterns (* wildcard, prefix*) → returns allow/deny string | testCapability(agentId, test, expected) → verifies expected behavior
 *   State/Effects: reads ~/.connectonion/trusted.txt synchronously | throws on missing file | no writes | returns strings (not booleans) for agent interpretation
 *   Integration: exposes checkWhitelist(agentId), testCapability(agentId, test, expected), verifyAgent(agentId, agentInfo?) | can be added as tools to trust agents | supports '*' for all and 'prefix*' for wildcards
 *   Performance: reads entire trusted.txt file per check | no caching | synchronous fs.readFileSync | O(n) line matching
 *   Errors: throws if ~/.connectonion/trusted.txt missing | no error handling on fs.readFileSync | no validation on agentId format
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function checkWhitelist(agentId: string): string {
  const file = path.join(os.homedir(), '.connectonion', 'trusted.txt');
  const data = fs.readFileSync(file, 'utf-8');
  const lines = data.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const ok = lines.some(line => {
    if (line === '*') return true;
    if (line.endsWith('*')) return agentId.startsWith(line.slice(0, -1));
    return line === agentId;
  });
  return ok ? `Whitelist: allowed (${agentId})` : `Whitelist: not found (${agentId})`;
}

export function testCapability(agentId: string, test: string, expected: string): string {
  return `Capability test for ${agentId}: ${test} → expected ${expected}`;
}

export function verifyAgent(agentId: string, agentInfo: string = ''): string {
  const info = agentInfo ? ` info=${agentInfo}` : '';
  return `Verification request for ${agentId}.${info}`;
}

