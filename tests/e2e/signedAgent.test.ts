/**
 * E2E test for signed requests to strict trust agents.
 * Tests real connection to the email agent at openonion.ai.
 *
 * @group e2e
 * @group network
 */

import * as address from '../../src/address';

// Email agent details
const EMAIL_AGENT_URL = 'https://email-agent-0x3a3daaa1.agents.openonion.ai';
const EMAIL_AGENT_ADDRESS = '0x6fd297a8689bce547586c1725a0a22b74b980bc4';

describe('Signed Agent Requests (E2E)', () => {
  describe('direct HTTP with signing', () => {
    it('creates valid signed request body', () => {
      const keys = address.generate();
      const payload = {
        prompt: 'test',
        to: EMAIL_AGENT_ADDRESS,
        timestamp: Math.floor(Date.now() / 1000),
      };

      // Create canonical JSON (sorted keys)
      const sortedKeys = Object.keys(payload).sort();
      const sortedPayload: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sortedPayload[key] = payload[key as keyof typeof payload];
      }
      const canonical = JSON.stringify(sortedPayload);

      const signature = address.sign(keys, canonical);
      const requestBody = {
        payload,
        from: keys.address,
        signature,
      };

      // Verify structure
      expect(requestBody.payload.prompt).toBe('test');
      expect(requestBody.payload.to).toBe(EMAIL_AGENT_ADDRESS);
      expect(requestBody.from).toMatch(/^0x[a-f0-9]{64}$/);
      expect(requestBody.signature).toMatch(/^[a-f0-9]{128}$/);

      // Verify signature is valid
      const valid = address.verify(keys.address, canonical, signature);
      expect(valid).toBe(true);
    });

    it('sends signed request to email agent', async () => {
      const keys = address.generate();
      const payload = {
        prompt: 'What can you do?',
        to: EMAIL_AGENT_ADDRESS,
        timestamp: Math.floor(Date.now() / 1000),
      };

      // Create canonical JSON
      const sortedKeys = Object.keys(payload).sort();
      const sortedPayload: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sortedPayload[key] = payload[key as keyof typeof payload];
      }
      const canonical = JSON.stringify(sortedPayload);
      const signature = address.sign(keys, canonical);

      const requestBody = {
        payload,
        from: keys.address,
        signature,
      };

      const response = await fetch(`${EMAIL_AGENT_URL}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      expect(response.ok).toBe(true);

      const data = await response.json() as { status: string; result: string };
      expect(data.status).toBe('done');
      expect(typeof data.result).toBe('string');
      expect(data.result.length).toBeGreaterThan(0);
    }, 30000); // 30s timeout for real API

    it('rejects unsigned request to strict trust agent', async () => {
      const response = await fetch(`${EMAIL_AGENT_URL}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('agent info endpoint', () => {
    it('returns agent metadata', async () => {
      const response = await fetch(`${EMAIL_AGENT_URL}/info`);

      expect(response.ok).toBe(true);

      const data = await response.json() as { name: string; address: string; trust: string };
      expect(data.name).toBe('email-agent');
      expect(data.address).toBe(EMAIL_AGENT_ADDRESS);
      expect(data.trust).toBe('strict');
    });
  });
});
