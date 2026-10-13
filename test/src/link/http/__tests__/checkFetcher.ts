import { checkFetcher } from '@apollo/client/link/http/checkFetcher';
import { loadErrorMessages } from '@apollo/client/dev';

import { voidFetchDuringEachTest } from './helpers';

// Hermes: the published @apollo/client package replaces invariant messages with error
// codes. Load the messages so errors read as they do in Apollo's source tests.
loadErrorMessages();

describe('checkFetcher', () => {
  voidFetchDuringEachTest();

  it('throws if no fetch is present', () => {
    expect(() => checkFetcher(undefined)).toThrow(/has not been found globally/);
  });

  it('does not throws if no fetch is present but a fetch is passed', () => {
    expect(() => checkFetcher((() => {}) as any)).not.toThrow();
  });
});
