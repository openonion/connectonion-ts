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

      if (url === `https://oo.openonion.ai/api/relay/agents/${ADDRESS}`) {
        return {
          ok: true,
          json: async () => ({
            endpoints: ['http://10.0.0.2:8000'],
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
});
