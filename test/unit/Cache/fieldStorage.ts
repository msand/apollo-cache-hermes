import { expect } from 'chai';
import { gql } from '@apollo/client';

import { Hermes } from '../../../src';

// The options.storage of read and merge functions is released with the nodes
// it belongs to, and on reset.
describe(`field storage`, () => {
  const DateScalar = {
    coerceToParsed: (value: unknown) => new Date(value as string),
    coerceToSerialized: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
  };
  const query = gql`
    query ($page: Int) {
      items(page: $page) {
        id
        at
      }
    }
  `;

  /** The ids (and other keys) that field storage is kept for. */
  function storageKeys(cache: Hermes): unknown[] {
    const storage = (cache as any)._queryable._context.fieldStorage;
    return Array.from(storage._strong?.keys() ?? []);
  }

  function cacheWithItems() {
    const cache = new Hermes({
      scalars: { Date: DateScalar as any },
      typePolicies: { Item: { fields: { at: { scalar: 'Date' } } } },
    });
    for (let page = 0; page < 3; page++) {
      const items = [0, 1].map(i => ({ __typename: 'Item', id: `${page}-${i}`, at: new Date(0) }));
      cache.writeQuery({ query, variables: { page }, data: { items } });
      cache.readQuery({ query, variables: { page } });
    }
    return cache;
  }

  it(`is kept for the nodes in the cache`, () => {
    const cache = cacheWithItems();
    expect(storageKeys(cache)).to.include.members(['Item:0-0', 'Item:2-1']);
  });

  it(`is released on reset`, async () => {
    const cache = cacheWithItems();
    await cache.reset();
    expect(storageKeys(cache)).to.deep.eq([]);
  });

  it(`is released when a node is evicted`, () => {
    const cache = cacheWithItems();
    cache.evict({ id: 'Item:0-0' });
    expect(storageKeys(cache)).to.not.include('Item:0-0');
    expect(storageKeys(cache)).to.include('Item:0-1');
  });

  it(`is released when nodes are garbage collected`, () => {
    const cache = cacheWithItems();
    cache.writeQuery({ query, variables: { page: 1 }, data: { items: [] } });
    expect(storageKeys(cache)).to.not.include.members(['Item:1-0', 'Item:1-1']);
    expect(storageKeys(cache)).to.include('Item:2-0');
  });

  it(`starts over after reset, like InMemoryCache's`, async () => {
    const storages: object[] = [];
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            count: {
              merge(_existing, incoming, { storage }) {
                storages.push(storage);
                return incoming;
              },
            },
          },
        },
      },
    });
    const countQuery = gql`
      {
        count
      }
    `;
    cache.writeQuery({ query: countQuery, data: { count: 1 } });
    cache.writeQuery({ query: countQuery, data: { count: 2 } });
    await cache.reset();
    cache.writeQuery({ query: countQuery, data: { count: 3 } });

    expect(storages[0]).to.eq(storages[1]);
    expect(storages[2]).to.not.eq(storages[1]);
  });
});
