import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';

// evict's broadcast option applies to every kind of eviction.
describe(`evict({ broadcast: false })`, () => {
  for (const [name, Cache] of Object.entries({ Hermes, InMemoryCache })) {
    it(`does not broadcast the eviction of a field's argument variant (${name})`, () => {
      const cache = new Cache();
      const query = gql`
        {
          feed(a: 1)
          other
        }
      `;
      cache.writeQuery({ query, data: { feed: 1, other: 2 } });
      let calls = 0;
      cache.watch({ query, optimistic: true, immediate: false, callback: () => calls++ });

      cache.evict({ fieldName: 'feed', args: { a: 1 }, broadcast: false });
      expect(calls).to.eq(0);
      (cache as any).broadcastWatches();
      expect(calls).to.eq(1);
    });
  }
});
