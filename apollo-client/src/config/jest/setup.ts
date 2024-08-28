import gql from "graphql-tag";
import "@testing-library/jest-dom";
import { loadErrorMessageHandler } from "../../dev/loadErrorMessageHandler";
import "../../testing/matchers/index";
import { areApolloErrorsEqual } from "./areApolloErrorsEqual";
import { areGraphQLErrorsEqual } from "./areGraphQlErrorsEqual";

// Turn off warnings for repeated fragment names
gql.disableFragmentWarnings();

process.on("unhandledRejection", () => {});

loadErrorMessageHandler();

function fail(reason = "fail was called in a test.") {
  expect(reason).toBe(undefined);
}

// @ts-ignore
globalThis.fail = fail;

if (!Symbol.dispose) {
  Object.defineProperty(Symbol, "dispose", {
    value: Symbol("dispose"),
  });
}
if (!Symbol.asyncDispose) {
  Object.defineProperty(Symbol, "asyncDispose", {
    value: Symbol("asyncDispose"),
  });
}

// @ts-ignore
expect.addEqualityTesters([areApolloErrorsEqual, areGraphQLErrorsEqual]);

// @ts-ignore
globalThis.REACT_FALLBACK_THROTTLE_MS = 10;
