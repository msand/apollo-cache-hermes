// Mirrors Apollo Client 3.14.1's src/config/jest/setup.ts, loading Apollo
// Client's matchers and dev tooling from the package.
import { TextEncoder, TextDecoder } from 'util';
import '@testing-library/jest-dom';
import gql from 'graphql-tag';
import { loadDevMessages, loadErrorMessageHandler } from '@apollo/client/dev';
import '@apollo/client/testing/matchers';

import { areApolloErrorsEqual } from '../src/config/jest/areApolloErrorsEqual';
import { areGraphQLErrorsEqual } from '../src/config/jest/areGraphQlErrorsEqual';

global.TextEncoder ??= TextEncoder;
// @ts-ignore
global.TextDecoder ??= TextDecoder;

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

// @ts-ignore
expect.addEqualityTesters([areApolloErrorsEqual, areGraphQLErrorsEqual]);

// not available in JSDOM 🙄
global.structuredClone = val => JSON.parse(JSON.stringify(val));

import './base';
