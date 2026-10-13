import { gql } from '@apollo/client';

import { Hermes } from '../../../src';

// extract() remembers the serialized form of each node (and snapshot); these
// check that a cache that extracted before reports what one that didn't does.
describe(`extract after earlier extracts`, () => {
  const query = gql`
    query {
      thing {
        __typename
        id
        name
        friend {
          __typename
          id
          name
        }
      }
      things(first: 2) {
        __typename
        id
      }
    }
  `;
  const data = {
    thing: { __typename: 'Thing', id: 1, name: 'One', friend: { __typename: 'Thing', id: 2, name: 'Two' } },
    things: [
      { __typename: 'Thing', id: 1 },
      { __typename: 'Thing', id: 3 },
    ],
  };

  function cacheWith(change: (cache: Hermes) => void, extractFirst: boolean) {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    if (extractFirst) cache.extract();
    change(cache);
    return cache.extract();
  }

  function expectLikeFresh(change: (cache: Hermes) => void) {
    expect(cacheWith(change, true)).toEqual(cacheWith(change, false));
  }

  it(`serializes references to evicted entities`, () => {
    expectLikeFresh(cache => cache.evict({ id: 'Thing:2' }));
    expectLikeFresh(cache => cache.evict({ id: 'Thing:3' }));
  });

  it(`serializes references to entities written again after an eviction`, () => {
    const writeBack = (cache: Hermes) =>
      cache.writeFragment({
        id: 'Thing:2',
        fragment: gql`
          fragment F on Thing {
            id
            name
          }
        `,
        data: { __typename: 'Thing', id: 2, name: 'Back' },
      });
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    cache.evict({ id: 'Thing:2' });
    cache.extract();
    writeBack(cache);

    const fresh = new Hermes();
    fresh.writeQuery({ query, data });
    fresh.evict({ id: 'Thing:2' });
    writeBack(fresh);
    expect(cache.extract()).toEqual(fresh.extract());
  });

  it(`serializes changed entities`, () => {
    expectLikeFresh(cache =>
      cache.writeFragment({
        id: 'Thing:2',
        fragment: gql`
          fragment F on Thing {
            name
          }
        `,
        data: { __typename: 'Thing', name: 'Changed' },
      }),
    );
  });

  it(`returns a new object each time`, () => {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    const first = cache.extract();
    delete first['Thing:1'];
    const second = cache.extract();
    expect(second).not.toBe(first);
    expect(second['Thing:1']).toBeDefined();
  });
});
