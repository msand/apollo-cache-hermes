import gql from 'graphql-tag';

import { loadErrorMessageHandler } from '../src/dev/loadErrorMessageHandler';
import '../src/testing/matchers/index';

// Turn off warnings for repeated fragment names
gql.disableFragmentWarnings();

process.on('unhandledRejection', () => {});

loadErrorMessageHandler();

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
