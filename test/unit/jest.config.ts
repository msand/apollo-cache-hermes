import type { Config } from 'jest';

export const config: Config = {
  preset: 'ts-jest',
  // jsdom plus Node's fetch, Request, Response, Headers and streams globals.
  testEnvironment: 'jest-fixed-jsdom',
  automock: false,
  collectCoverageFrom: ['src/**/*.js'],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  coverageDirectory: 'output/test-unit',
  coverageReporters: ['lcovonly', 'text'],
  coveragePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test/'],
  rootDir: '../..',
  // Only crawl the project sources, not nested checkouts such as .claude/worktrees.
  roots: ['<rootDir>/src', '<rootDir>/test'],
  setupFilesAfterEnv: ['./test/env/unit.js'],
  // Loads @apollo/client from its ES modules; see test/env/resolver.ts.
  resolver: '<rootDir>/test/env/resolver.js',
  snapshotResolver: '<rootDir>/test/env/snapshotResolver.js',
  // The vendored Apollo Client snapshots use the pre-Jest 29 format.
  snapshotFormat: { escapeString: true, printBasicPrototype: true },
  testMatch: ['<rootDir>/test/unit/**/*.js', '<rootDir>/test/**/*.test.js', '<rootDir>/test/src/**/__tests__/**/*.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/test/unit/jest.config.js',
    '<rootDir>/test/src/cache/inmemory/__tests__/helpers.js',
  ],
  reporters: ['default', 'jest-junit'],
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
    __DEV__: true,
  },
  transformIgnorePatterns: [],
};

export default config;
