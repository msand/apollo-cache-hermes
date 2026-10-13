import { expect } from 'chai';
import { gql } from '@apollo/client';

import { Hermes } from '../../../src';

// Optimistic updates that are re-applied (when the baseline changes, or when
// an update is removed) keep retained nodes, as they did when first applied.
describe(`re-applied optimistic updates`, () => {
  const query = gql`
    {
      a {
        id
        partner {
          id
          partner {
            id
          }
        }
      }
      other
    }
  `;
  const cycle = {
    __typename: 'T',
    id: 'A',
    partner: { __typename: 'T', id: 'B', partner: { __typename: 'T', id: 'A' } },
  };

  /** A cache with a retained reference cycle (T:A ⇄ T:B), dropped by an optimistic update. */
  function cacheWithDroppedCycle() {
    const cache = new Hermes();
    cache.writeQuery({ query, data: { a: cycle, other: 1 } });
    cache.retain('T:A');
    cache.recordOptimisticTransaction(proxy => {
      proxy.writeQuery({ query, data: { a: null, other: 2 } });
    }, 'drop');
    expect(cache.extract(true)['T:A']).to.not.eq(undefined);
    return cache;
  }

  it(`keep retained cycles when the baseline is written`, () => {
    const cache = cacheWithDroppedCycle();
    cache.writeQuery({
      query: gql`
        {
          other
        }
      `,
      data: { other: 3 },
    });
    expect(cache.extract(true)['T:A']).to.not.eq(undefined);
    expect(cache.extract(true)['T:B']).to.not.eq(undefined);
    expect(cache.extract(false)['T:A']).to.not.eq(undefined);
  });

  it(`keep retained cycles when an update above them is removed`, () => {
    const cache = cacheWithDroppedCycle();
    cache.recordOptimisticTransaction(proxy => {
      proxy.writeQuery({
        query: gql`
          {
            other
          }
        `,
        data: { other: 4 },
      });
    }, 'above');
    cache.removeOptimistic('above');
    expect(cache.extract(true)['T:A']).to.not.eq(undefined);
    expect(cache.extract(true)['T:B']).to.not.eq(undefined);
  });
});
