module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../'],
  testMatch: ['**/e2e/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '<rootDir>/../src/**/*.ts',
    '!<rootDir>/../src/**/*.d.ts',
    '!<rootDir>/../src/**/*.spec.ts',
    '!<rootDir>/../src/**/*.test.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  testTimeout: 30000, // 30 seconds for E2E tests
};
