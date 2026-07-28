import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextEncoder, TextDecoder } from 'util';

// jest-environment-jsdom ships without TextEncoder/TextDecoder; signing needs them.
// node:util's encoder returns a node-realm Uint8Array that fails `instanceof
// Uint8Array` inside the jsdom realm (jsdom#2524), so re-wrap the output.
const g = globalThis as Record<string, unknown>;
if (!g.TextEncoder) {
  const RealmUint8Array = (globalThis as { Uint8Array: Uint8ArrayConstructor }).Uint8Array;
  class RealmTextEncoder extends TextEncoder {
    encode(input?: string): ReturnType<InstanceType<Uint8ArrayConstructor>['slice']> {
      return new RealmUint8Array(super.encode(input));
    }
  }
  g.TextEncoder = RealmTextEncoder;
  g.TextDecoder = TextDecoder;
}

// Point behavior logs to a writable temp directory for tests
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co-ts-jest-'));
process.env.CONNECTONION_HOME = tmp;

// Tests do not auto-load .env; if the SDK needs keys, let it crash to prompt config
