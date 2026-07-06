import { fetchAgentInfo } from '../src/connect/endpoint';

const ADDRESS = `0x${'1'.repeat(64)}`;

describe('fetchAgentInfo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the published relay profile when direct /info is unreachable', async () => {
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);

      if (url === `https://oo.openonion.ai/api/agents/${ADDRESS}`) {
        return {
          ok: true,
          json: async () => ({
            endpoints: ['http://10.0.0.2:8000'],
            relay: 'wss://oo.openonion.ai',
            last_seen: '2026-06-01T00:00:00Z',
            profile: {
              alias: 'agent-4-linkedin',
              model: 'co/test-model',
              version: '0.9.4',
              tools: [{ name: 'bash' }, 'skill'],
              skills: [{ name: 'deploy-smoke', description: 'Smoke test skill' }],
            },
          }),
        };
      }

      if (url === 'http://10.0.0.2:8000/info') {
        throw new Error('direct endpoint is unreachable from browser');
      }

      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const info = await fetchAgentInfo(ADDRESS);

    expect(info).toEqual({
      address: ADDRESS,
      name: 'agent-4-linkedin',
      tools: ['bash', 'skill'],
      skills: [{ name: 'deploy-smoke', description: 'Smoke test skill' }],
      version: '0.9.4',
      model: 'co/test-model',
      online: true,
    });
  });

  it('marks stale DB records offline but keeps the published name', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = String(input);
      if (url === `https://oo.openonion.ai/api/agents/${ADDRESS}`) {
        return {
          ok: true,
          json: async () => ({
            endpoints: ['http://localhost:8000'],
            relay: null,
            last_seen: '2026-06-09T08:51:34Z',
            profile: { alias: 'oo' },
          }),
        };
      }
      // dead localhost endpoint — the direct probe must not flip anything
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;

    const info = await fetchAgentInfo(ADDRESS);

    expect(info.online).toBe(false);
    expect(info.name).toBe('oo');
  });
});
