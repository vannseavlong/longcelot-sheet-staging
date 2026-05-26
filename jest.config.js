module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts', '**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  maxWorkers: 1,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
      diagnostics: { ignoreCodes: [151002] },
    },
  },
};