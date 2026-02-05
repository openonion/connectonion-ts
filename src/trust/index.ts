/**
 * @purpose Trust-level configuration system (open/careful/strict) with environment-based defaults and prompt templates for future trust agent integration
 *
 * @graph Trust Level Hierarchy
 *
 *                       Trust Levels
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │                                                     │
 *   │   open          careful (default)      strict       │
 *   │   ─────         ────────────────       ──────       │
 *   │                                                     │
 *   │   - Fast        - Verify intent       - Pre-approved│
 *   │     iteration   - Sanity-check          agents only │
 *   │   - Minimal       tools              - Least        │
 *   │     checks      - Review consent       privilege    │
 *   │   - Dev envs    - Staging/test       - Production   │
 *   │                                                     │
 *   │   <──── increasing restriction ────────────────>    │
 *   │                                                     │
 *   └─────────────────────────────────────────────────────┘
 *
 * @graph Trust Level Resolution
 *
 *   CONNECTONION_TRUST env ──set──▶ use env value
 *          │ unset
 *          ▼
 *   default: 'careful'
 *
 * @llm-note
 *   Dependencies: no imports (leaf node) | imported by [src/core/agent.ts] | no tests yet (configuration layer)
 *   Data flow: receives trust level string or object → returns trust config with level + prompt → used by Agent constructor
 *   State/Effects: reads env CONNECTONION_TRUST | no state mutations | pure functions
 *   Integration: exposes createTrustAgent(trust, apiKey, model), getDefaultTrustLevel(), getTrustPrompt(level), TrustLevel type | default level: 'careful' | prompts define trust agent behavior for future policy evaluation
 *   ⚠️ Trust agent not yet implemented - returns config object only | future: could return Agent instance for runtime policy checks
 */

export type TrustLevel = 'open' | 'careful' | 'strict';

const TRUST_PROMPTS: Record<TrustLevel, string> = {
  open: `You are an open trust agent for development environments.
You trust agents to enable rapid iteration and testing.
Use best effort checks but prioritize developer velocity.`,
  careful: `You are a careful trust agent for staging/testing.
Verify agent identity and intent before approval:
1) Require clear purpose, 2) Sanity-check tools, 3) Review consent.
Reject risky actions without context.`,
  strict: `You are a strict trust agent for production.
Only approve actions for pre-approved agents and tools.
Enforce least privilege and strong provenance.`
};

export function getDefaultTrustLevel(): TrustLevel {
  const env = (process.env.CONNECTONION_TRUST || '').toLowerCase();
  if (env === 'open' || env === 'careful' || env === 'strict') return env as TrustLevel;
  return 'careful';
}

export function getTrustPrompt(level: TrustLevel): string {
  return TRUST_PROMPTS[level];
}

/**
 * Create a trust agent or configuration object.
 * For now, return a lightweight object with level and prompt.
 * Future: could return an Agent instance for policy evaluation.
 */
export function createTrustAgent(
  trust?: TrustLevel | { level: TrustLevel; prompt?: string },
  _apiKey?: string,
  _model?: string
) {
  if (!trust) trust = getDefaultTrustLevel();
  const level = typeof trust === 'string' ? trust : trust.level;
  const prompt = typeof trust === 'string' ? getTrustPrompt(trust) : trust.prompt || getTrustPrompt(trust.level);
  return { level, prompt, name: `trust_agent_${level}` };
}

