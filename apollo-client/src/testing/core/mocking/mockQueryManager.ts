import { QueryManager } from "../../../core/QueryManager";
import type { MockedResponse } from "./mockLink";
import { mockSingleLink } from "./mockLink";
import { Hermes } from "../../../../../src";

// Helper method for the tests that construct a query manager out of a
// a list of mocked responses for a mocked network interface.
export default (...mockedResponses: MockedResponse[]) => {
  return new QueryManager({
    link: mockSingleLink(...mockedResponses),
    // @ts-ignore
    cache: new Hermes({ addTypename: false }),
  });
};
