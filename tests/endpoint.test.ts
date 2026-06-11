const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

function compileTsFixture(sourcePath, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const source = fs.readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  fs.writeFileSync(outputPath, output);
}

const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'co-ts-endpoint-'));
compileTsFixture(
  path.join(__dirname, '../src/connect/types.ts'),
  path.join(compiledRoot, 'connect/types.js'),
);
compileTsFixture(
  path.join(__dirname, '../src/connect/endpoint.ts'),
  path.join(compiledRoot, 'connect/endpoint.js'),
);

const { fetchAgentInfo } = require(path.join(compiledRoot, 'connect/endpoint.js'));

const ADDRESS = `0x${'1'.repeat(64)}`;

describe('fetchAgentInfo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses relay runtime metadata when direct /info is unreachable', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = String(input);

      if (url === `https://oo.openonion.ai/api/relay/agents/${ADDRESS}`) {
        return {
          ok: true,
          json: async () => ({
            endpoints: ['http://10.0.0.2:8000'],
            last_seen: '2026-06-01T00:00:00Z',
            metadata: {
              name: 'agent-4-linkedin',
              model: 'co/test-model',
              version: '0.9.4',
              tools: [{ name: 'bash' }, 'skill'],
              skills: [{
                name: 'deploy-smoke',
                description: 'Smoke test skill',
                location: '/Users/me/.co/skills/deploy-smoke/SKILL.md',
              }],
            },
          }),
        };
      }

      if (url === 'http://10.0.0.2:8000/info') {
        throw new Error('direct endpoint is unreachable from browser');
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    const info = await fetchAgentInfo(ADDRESS);

    expect(global.fetch).not.toHaveBeenCalledWith(
      `https://oo.openonion.ai/api/relay/agents/${ADDRESS}/profile`,
      expect.anything(),
    );
    expect(info).toEqual({
      address: ADDRESS,
      name: 'agent-4-linkedin',
      tools: ['bash', 'skill'],
      skills: [{
        name: 'deploy-smoke',
        description: 'Smoke test skill',
        location: '/Users/me/.co/skills/deploy-smoke/SKILL.md',
      }],
      version: '0.9.4',
      model: 'co/test-model',
      online: true,
    });
  });
});
