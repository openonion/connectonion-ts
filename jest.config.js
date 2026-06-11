/** ts-jest is in devDependencies but was never wired up, so every TS-syntax
 * test suite failed to parse and silently never ran. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/e2e/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { rootDir: '.', noUnusedLocals: false, noUnusedParameters: false } }],
  },
};
