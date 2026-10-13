import { gql, InMemoryCache } from '@apollo/client';
import { MissingFieldError } from '@apollo/client/cache';

import { Cache, Hermes } from '../../../src';
import { StaticNodeId } from '../../../src/schema';

// Like InMemoryCache, incomplete reads only return partial data when the
// result has a value for a field the query selects (Hermes' results can hold
// other fields of the object read).
describe(`partial results`, () => {
  function bothCaches() {
    const caches = [new Hermes(), new InMemoryCache()] as const;
    for (const cache of caches)
      cache.writeQuery({
        query: gql`
          {
            b
          }
        `,
        data: { b: 1 },
      });
    return caches;
  }

  it(`are null without any selected field`, () => {
    for (const cache of bothCaches()) {
      const diff = cache.diff({
        query: gql`
          {
            a
          }
        `,
        optimistic: false,
        returnPartialData: true,
      });
      expect([diff.result, diff.complete]).toEqual([null, false]);
      expect(
        cache.readQuery({
          query: gql`
            {
              a
            }
          `,
          returnPartialData: true,
        }),
      ).toBe(null);
    }
  });

  it(`hold the selected fields that were found`, () => {
    for (const cache of bothCaches()) {
      const diff = cache.diff<any>({
        query: gql`
          {
            a
            b
          }
        `,
        optimistic: false,
        returnPartialData: true,
      });
      expect([diff.result.b, diff.complete]).toEqual([1, false]);
    }
  });

  it(`are null for watches without any selected field`, () => {
    for (const cache of bothCaches()) {
      const results: unknown[] = [];
      cache.watch({
        query: gql`
          {
            a
          }
        `,
        optimistic: false,
        returnPartialData: true,
        immediate: true,
        callback: diff => results.push(diff.result),
      });
      expect(results).toEqual([null]);
    }
  });

  it(`count __typename fields the cache adds to fragments`, () => {
    for (const cache of [new Hermes(), new InMemoryCache()]) {
      cache.writeQuery({
        query: gql`
          {
            u {
              id
            }
          }
        `,
        data: { u: { __typename: 'U', id: 1 } },
      });
      const fragment = cache.readFragment<any>({
        id: 'U:1',
        fragment: gql`
          fragment F on U {
            name
          }
        `,
        returnPartialData: true,
      });
      // (Hermes' result also holds the entity's other fields.)
      expect(fragment).toMatchObject({ __typename: 'U' });
    }
  });
});

describe(`readFragment`, () => {
  const fragment = gql`
    fragment F on Query {
      a
    }
  `;

  for (const [description, options] of [
    [`without an id`, {}],
    [`from an object that can't be identified`, { from: { __typename: 'Foo' } }],
  ] as const) {
    it(`reads ROOT_QUERY ${description}, like InMemoryCache`, () => {
      for (const cache of [new Hermes(), new InMemoryCache()]) {
        cache.writeQuery({
          query: gql`
            {
              a
            }
          `,
          data: { a: 1 },
        });
        expect(cache.readFragment({ fragment, ...options })).toEqual({ a: 1 });
      }
    });
  }
});

describe(`missing field errors`, () => {
  it(`are built when first accessed`, () => {
    const cache = new Cache(undefined);
    const result = cache.read({
      rootId: StaticNodeId.QueryRoot,
      document: gql`
        {
          a
        }
      `,
    });
    expect(result.complete).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(result, 'missing')!;
    expect(typeof descriptor.get).toBe('function');
    expect(result.missing).toBeInstanceOf(MissingFieldError);
    expect(result.missing).toBe(result.missing);
    expect(result.missing!.message).toBe("Can't find field 'a' on ROOT_QUERY object");
  });

  it(`are not built for watch results that are not inspected`, () => {
    const cache = new Hermes();
    const diffs: any[] = [];
    cache.watch({
      query: gql`
        {
          a
        }
      `,
      optimistic: true,
      immediate: true,
      callback: diff => diffs.push(diff),
    });
    cache.writeQuery({
      query: gql`
        {
          b
        }
      `,
      data: { b: 1 },
    });
    for (const diff of diffs) {
      expect(typeof Object.getOwnPropertyDescriptor(diff, 'missing')!.get).toBe('function');
    }
  });
});
