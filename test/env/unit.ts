import '@testing-library/jest-dom';
import gql from 'graphql-tag';
import { loadDevMessages } from '@apollo/client/dev';

import { loadErrorMessageHandler } from '../src/dev/loadErrorMessageHandler';
import '../src/testing/matchers/index';

// Turn off warnings for repeated fragment names
gql.disableFragmentWarnings();

process.on('unhandledRejection', () => {});

loadErrorMessageHandler();
// Readable warnings from the @apollo/client package; Hermes tests assert its production error messages.
loadDevMessages();

function fail(reason = 'fail was called in a test.') {
  expect(reason).toBe(undefined);
}

// @ts-ignore
globalThis.fail = fail;

if (!Symbol.dispose) {
  Object.defineProperty(Symbol, 'dispose', {
    value: Symbol('dispose'),
  });
}
if (!Symbol.asyncDispose) {
  Object.defineProperty(Symbol, 'asyncDispose', {
    value: Symbol('asyncDispose'),
  });
}

import './base';

// Hermes: in CI (and release runs), failing tests are retried twice: some of
// Apollo Client's tests (e.g. MockLink's) expect responses within tens of
// milliseconds, which busy CI runners sometimes miss. Retries are logged.
if (process.env.CI) jest.retryTimes(2, { logErrorsBeforeRetry: true });
