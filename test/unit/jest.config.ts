import type { Config } from 'jest';

export const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  automock: false,
  collectCoverageFrom: [
    'src/**/*.js',
  ],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  extensionsToTreatAsEsm: ['js', 'jsx', 'ts', 'tsx'],
  coverageDirectory: 'output/test-unit',
  coverageReporters: ['lcovonly', 'text'],
  coveragePathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/test/',
  ],
  rootDir: '../..',
  setupFilesAfterEnv: ['./test/env/unit.js'],
  testMatch: ['<rootDir>/test/unit/**/*.js', '<rootDir>/test/**/*.test.js', '<rootDir>/test/**/*.test.jsx'],
  reporters: ['default', 'jest-junit'],
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
      useESM: true,
    },
    __DEV__: true,
  },
  resolver: 'ts-jest-resolver',
  transformIgnorePatterns: ['/node_modules/(?!(@apollo/client|@apollo/client/cache)/)', '@apollo/client'],
};

export default config;
