/** ts-jest is in devDependencies but was never wired up, so every TS-syntax
 * test suite failed to parse and silently never ran. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  // packages/ holds @connectonion/react — its own package with its own jest run,
  // staged here only until it moves to its own repo.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/e2e/', '/packages/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { rootDir: '.', noUnusedLocals: false, noUnusedParameters: false } }],
  },
};
