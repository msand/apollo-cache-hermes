import { Hermes } from "../../../../../src";

import type { MockedResponse } from "./mockLink";
import { mockSingleLink } from "./mockLink";
import {QueryManager} from "@apollo/client/core/QueryManager";

// Helper method for the tests that construct a query manager out of a
// a list of mocked responses for a mocked network interface.
export default (...mockedResponses: MockedResponse[]) => {
  return new QueryManager({
    link: mockSingleLink(...mockedResponses),
    cache: new Hermes({ addTypename: false }),
  });
};
