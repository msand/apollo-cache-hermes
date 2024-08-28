import gql from 'graphql-tag';
//import "@testing-library/jest-dom";
import { loadErrorMessageHandler } from '../../apollo-client/src/dev';
import "../../apollo-client/src/testing/matchers/index";
import { areApolloErrorsEqual } from "../../apollo-client/src/config/jest/areApolloErrorsEqual";
import { areGraphQLErrorsEqual } from "../../apollo-client/src/config/jest/areGraphQlErrorsEqual";

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

// @ts-ignore
expect.addEqualityTesters([areApolloErrorsEqual, areGraphQLErrorsEqual]);

// @ts-ignore
globalThis.REACT_FALLBACK_THROTTLE_MS = 10;

import './base';