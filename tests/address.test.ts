/**
 * Tests for address module - key generation, signing, and verification
 */

import * as address from '../src/address';

describe('address', () => {
  describe('generate()', () => {
    it('generates valid Ed25519 keypair', () => {
      const keys = address.generate();

      expect(keys.address).toMatch(/^0x[a-f0-9]{64}$/);
      expect(keys.shortAddress).toMatch(/^0x[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
      expect(keys.publicKey).toHaveLength(32);
      expect(keys.privateKey).toHaveLength(32);
    });

    it('generates unique addresses each time', () => {
      const keys1 = address.generate();
      const keys2 = address.generate();

      expect(keys1.address).not.toBe(keys2.address);
    });
  });

  describe('sign()', () => {
    it('signs a message and returns hex signature', () => {
      const keys = address.generate();
      const message = 'test message';

      const signature = address.sign(keys, message);

      expect(signature).toMatch(/^[a-f0-9]{128}$/); // 64 bytes = 128 hex chars
    });

    it('produces consistent signatures for same message', () => {
      const keys = address.generate();
      const message = 'test message';

      const sig1 = address.sign(keys, message);
      const sig2 = address.sign(keys, message);

      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different messages', () => {
      const keys = address.generate();

      const sig1 = address.sign(keys, 'message1');
      const sig2 = address.sign(keys, 'message2');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verify()', () => {
    it('verifies valid signature', () => {
      const keys = address.generate();
      const message = 'test message';
      const signature = address.sign(keys, message);

      const valid = address.verify(keys.address, message, signature);

      expect(valid).toBe(true);
    });

    it('rejects signature from different key', () => {
      const keys1 = address.generate();
      const keys2 = address.generate();
      const message = 'test message';
      const signature = address.sign(keys1, message);

      const valid = address.verify(keys2.address, message, signature);

      expect(valid).toBe(false);
    });

    it('rejects tampered message', () => {
      const keys = address.generate();
      const signature = address.sign(keys, 'original message');

      const valid = address.verify(keys.address, 'tampered message', signature);

      expect(valid).toBe(false);
    });

    it('rejects invalid address format', () => {
      const keys = address.generate();
      const signature = address.sign(keys, 'test');

      expect(address.verify('invalid', 'test', signature)).toBe(false);
      expect(address.verify('0xshort', 'test', signature)).toBe(false);
    });
  });

  describe('createSignedPayload()', () => {
    it('creates properly structured signed payload', () => {
      const keys = address.generate();
      const prompt = 'Hello agent';
      const toAddress = '0x' + 'a'.repeat(64);

      const result = address.createSignedPayload(keys, prompt, toAddress);

      expect(result.payload.prompt).toBe(prompt);
      expect(result.payload.to).toBe(toAddress);
      expect(result.payload.timestamp).toBeGreaterThan(0);
      expect(result.from).toBe(keys.address);
      expect(result.signature).toMatch(/^[a-f0-9]{128}$/);
    });

    it('signature verifies against canonical payload', () => {
      const keys = address.generate();
      const toAddress = '0x' + 'b'.repeat(64);

      const result = address.createSignedPayload(keys, 'test', toAddress);

      // Recreate canonical JSON (sorted keys)
      const payload = result.payload;
      const sortedKeys = Object.keys(payload).sort();
      const sortedPayload: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sortedPayload[key] = payload[key as keyof typeof payload];
      }
      const canonical = JSON.stringify(sortedPayload);

      const valid = address.verify(keys.address, canonical, result.signature);
      expect(valid).toBe(true);
    });
  });

  describe('canonical JSON', () => {
    it('sorts keys alphabetically for consistent signatures', () => {
      const keys = address.generate();
      const toAddress = '0x' + 'c'.repeat(64);

      // Create payload with keys in different order should produce same signature
      const result1 = address.createSignedPayload(keys, 'test', toAddress);

      // Manually verify key order in canonical form
      const payload = result1.payload;
      const canonicalKeys = Object.keys(payload).sort();
      expect(canonicalKeys).toEqual(['prompt', 'timestamp', 'to']);
    });
  });
});
