// Mirrors Apollo Client 4.3.3's src/config/jest/setup.ts as Apollo runs it in
// CI, against the published package: Apollo Client's dev and error messages are
// loaded, and its matchers and equality testers come from the vendored test
// support code in test/src.
import '@testing-library/jest-dom';
import gql from 'graphql-tag';
import { setLogVerbosity } from '@apollo/client';
import { loadDevMessages, loadErrorMessages } from '@apollo/client/dev';

import '../src/testing/matchers/index';
import { areCombinedGraphQLErrorsEqual } from '../src/config/jest/areCombinedGraphQLErrorsEqual';
import { areCombinedProtocolErrorsEqual } from '../src/config/jest/areCombinedProtocolErrorsEqual';
import { areGraphQLErrorsEqual } from '../src/config/jest/areGraphQlErrorsEqual';
import { areLocalStateErrorsEqual } from '../src/config/jest/areLocalStateErrorsEqual';
import { areMissingFieldErrorsEqual } from '../src/config/jest/areMissingFieldErrorsEqual';
import { areServerErrorsEqual } from '../src/config/jest/areServerErrorsEqual';
import { areWeakRefsEqual } from '../src/config/jest/areWeakRefsEqual';

// @ts-ignore
globalThis.__DEV__ = true;

setLogVerbosity('log');

// Turn off warnings for repeated fragment names
gql.disableFragmentWarnings();

process.on('unhandledRejection', () => {});

loadDevMessages();
loadErrorMessages();

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
expect.addEqualityTesters([
  areServerErrorsEqual,
  areCombinedGraphQLErrorsEqual,
  areCombinedProtocolErrorsEqual,
  areGraphQLErrorsEqual,
  areLocalStateErrorsEqual,
  areMissingFieldErrorsEqual,
  areWeakRefsEqual,
]);

import './base';
