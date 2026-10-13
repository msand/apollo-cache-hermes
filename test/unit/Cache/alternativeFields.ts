import { gql, InMemoryCache } from '@apollo/client';
import type { ApolloCache } from '@apollo/client';

import { Hermes } from '../../../src';
import { toNormalizedCacheObject } from '../../helpers';

// GraphQL allows a response key to select different fields (or the same field
// with different arguments) under type conditions that cannot apply to the
// same object; like InMemoryCache, Hermes reads and writes the field that
// applies to each object's type.
describe(`response keys selecting different fields for different types`, () => {
  const possibleTypes = { Media: ['Book', 'Movie'] };
  const query = gql`
    query ($limit: Int) {
      search {
        __typename
        ... on Book {
          id
          size: pages
          related(limit: 2) {
            id
          }
          info {
            label: isbn
          }
        }
        ... on Movie {
          id
          size: runtime
          related(limit: $limit) {
            id
          }
          info {
            label: rating
          }
        }
      }
    }
  `;
  const variables = { limit: 1 };
  const data = {
    search: [
      {
        __typename: 'Book',
        id: 1,
        size: 300,
        related: [{ __typename: 'Book', id: 2 }],
        info: { __typename: 'BookInfo', label: '978-3' },
      },
      {
        __typename: 'Movie',
        id: 1,
        size: 120,
        related: [{ __typename: 'Movie', id: 3 }],
        info: { __typename: 'MovieInfo', label: 'PG' },
      },
    ],
  };

  function bothCaches() {
    return [new Hermes({ possibleTypes }), new InMemoryCache({ possibleTypes })] as const;
  }

  const normalized = (cache: ApolloCache): any =>
    cache instanceof Hermes ? toNormalizedCacheObject(cache.extract()) : cache.extract();

  it(`writes each field to the objects of its type`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({ query, variables, data });
    }
    expect(normalized(hermes)).toEqual(normalized(inMemoryCache));
    expect(normalized(hermes)['Book:1']).toMatchObject({ pages: 300, 'related({"limit":2})': [{ __ref: 'Book:2' }] });
    expect(normalized(hermes)['Movie:1']).toMatchObject({
      runtime: 120,
      'related({"limit":1})': [{ __ref: 'Movie:3' }],
    });
  });

  it(`reads each field from the objects of its type`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({ query, variables, data });
    }
    const diff = hermes.diff<any>({ query, variables, optimistic: false });
    expect(diff.complete).toBe(true);
    // (Hermes' results may contain a superset of the selected fields.)
    expect(diff.result).toMatchObject(inMemoryCache.diff<any>({ query, variables, optimistic: false }).result);
    expect(diff.result).toMatchObject(data);
  });

  it(`reports the missing field of each type`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({
        query: gql`
          query {
            search {
              ... on Book {
                id
                pages
              }
              ... on Movie {
                id
              }
            }
          }
        `,
        data: {
          search: [
            { __typename: 'Book', id: 1, pages: 300 },
            { __typename: 'Movie', id: 1 },
          ],
        },
      });
    }
    const sizeQuery = gql`
      query {
        search {
          ... on Book {
            id
            size: pages
          }
          ... on Movie {
            id
            size: runtime
          }
        }
      }
    `;
    const diff = hermes.diff<any>({ query: sizeQuery, optimistic: false });
    expect(diff.complete).toBe(false);
    expect(diff.missing!.missing).toEqual(inMemoryCache.diff({ query: sizeQuery, optimistic: false }).missing!.missing);
    expect(diff.missing!.message).toBe("Can't find field 'runtime' on Movie:1 object");
  });

  it(`applies the read functions of each type's field`, () => {
    const typePolicies = {
      Book: { fields: { pages: { read: (pages: number) => pages * 2 } } },
      Movie: { fields: { runtime: { read: (runtime: number) => runtime + 1 } } },
    };
    const caches = [new Hermes({ possibleTypes, typePolicies }), new InMemoryCache({ possibleTypes, typePolicies })];
    const results = caches.map(cache => {
      cache.writeQuery({ query, variables, data });
      return cache.readQuery<any>({ query, variables });
    });
    expect(results[0].search.map((item: any) => item.size)).toEqual([600, 121]);
    expect(results[0]).toMatchObject(results[1]);
  });

  it(`reads and writes the first alternative for objects of unknown type`, () => {
    const cache = new Hermes({ addTypename: false });
    const untypedQuery = gql`
      query {
        thing {
          ... on Book {
            size: pages
          }
          ... on Movie {
            size: runtime
          }
        }
      }
    `;
    cache.writeQuery({ query: untypedQuery, data: { thing: { size: 300 } } });
    expect(toNormalizedCacheObject(cache.extract()).ROOT_QUERY.thing).toEqual({ pages: 300 });
    expect(cache.readQuery({ query: untypedQuery })).toMatchObject({ thing: { size: 300 } });
  });

  it(`watches the alternatives of root fields`, () => {
    const cache = new Hermes();
    const rootQuery = gql`
      query {
        ... on Other {
          value: second
        }
        ... on Query {
          value: first
        }
      }
    `;
    cache.writeQuery({ query: rootQuery, data: { value: 1 } });
    const diffs: any[] = [];
    cache.watch<any>({ query: rootQuery, optimistic: false, callback: diff => diffs.push(diff.result.value) });
    cache.writeQuery({
      query: gql`
        query {
          first
        }
      `,
      data: { first: 2 },
    });
    expect(diffs).toEqual([2]);
  });
});
