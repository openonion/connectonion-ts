module.exports = {
  preset: 'ts-jest',
  // Every suite here drives React hooks against localStorage, so jsdom is the
  // default rather than a per-file @jest-environment docblock.
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    // tsconfig.json sets isolatedModules, so ts-jest transpiles rather than
    // type-checks. That matters here: `connectonion/connect` and friends resolve
    // through the core package's `exports` map, which ts-jest's in-process checker
    // does not honour but jest's own resolver does. Types are still verified —
    // `tsc --noEmit` runs as its own CI step.
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: { rootDir: '.', noUnusedLocals: false, noUnusedParameters: false },
      },
    ],
  },
};
