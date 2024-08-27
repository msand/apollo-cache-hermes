import type { Config } from 'jest';

export const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  automock: false,
  collectCoverageFrom: [
    'src/**/*.js',
    'src/**/*.jsx',
    'src/**/*.ts',
    'src/**/*.tsx',
  ],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
  coverageDirectory: 'output/test-unit',
  coverageReporters: ['lcovonly', 'text'],
  coveragePathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/test/',
  ],
  rootDir: '../..',
  setupFilesAfterEnv: ['./test/env/unit.ts'],
  testMatch: ['<rootDir>/test/unit/**/*.js', '<rootDir>/test/**/*.test.js', '<rootDir>/test/**/*.test.jsx', '<rootDir>/test/unit/**/*.ts', '<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
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
  'transformIgnorePatterns': [],
};

export default config;
