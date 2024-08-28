import type { QueryManagerOptions } from "../../../core/QueryManager";
import { QueryManager } from "../../../core/QueryManager";
import type { MockedResponse } from "./mockLink";
import { mockSingleLink } from "./mockLink";
import { LocalState } from "../../../core/LocalState";
import { Hermes } from "apollo-cache-hermes";

export const getDefaultOptionsForQueryManagerTests = <TStore>(
  options: Pick<QueryManagerOptions<TStore>, "cache" | "link"> &
    Partial<QueryManagerOptions<TStore>>
) => ({
  defaultOptions: Object.create(null),
  documentTransform: undefined,
  queryDeduplication: false,
  onBroadcast: undefined,
  ssrMode: false,
  clientAwareness: {},
  localState: new LocalState({ cache: options.cache }),
  assumeImmutableResults: !!options.cache.assumeImmutableResults,
  defaultContext: undefined,
  ...options,
});

// Helper method for the tests that construct a query manager out of a
// a list of mocked responses for a mocked network interface.
export default (...mockedResponses: MockedResponse[]) => {
  return new QueryManager(
    getDefaultOptionsForQueryManagerTests({
      link: mockSingleLink(...mockedResponses),
      cache: new Hermes({ addTypename: false }),
    })
  );
};
