import { gql } from '@apollo/client';
import type { DocumentNode } from 'graphql';

import { Hermes } from '../../../src';

// Writes set the leaf fields of entities that are new (neither in the cache
// nor written earlier in the write) directly; these check that they store what
// writes over existing entities do.
describe(`writes of new entities`, () => {
  /** What the cache holds after writing `data`, and after writing it again (over existing entities). */
  function written(query: DocumentNode, data: unknown, config: ConstructorParameters<typeof Hermes>[0] = {}) {
    const cache = new Hermes(config);
    cache.writeQuery({ query, data });
    const once = cache.extract();
    cache.writeQuery({ query, data });
    return { cache, once, twice: cache.extract() };
  }

  it(`store the same data as writes over existing entities`, () => {
    const query = gql`
      query {
        viewer {
          __typename
          id
          info {
            city
          }
          name
          nick: name
          friends {
            __typename
            id
            name
            age
          }
        }
      }
    `;
    const data = {
      viewer: {
        __typename: 'User',
        id: 'u1',
        info: { city: 'A' },
        name: 'One',
        nick: 'One',
        // The same entity twice, with different fields.
        friends: [
          { __typename: 'User', id: 'u2', name: 'Two', age: 2 },
          { __typename: 'User', id: 'u2', name: 'Two', age: 2 },
          { __typename: 'User', id: 'u3', name: 'Three', age: 3 },
        ],
      },
    };
    const { cache, once, twice } = written(query, data);
    expect(once).toEqual(twice);
    expect(cache.readQuery({ query })).toMatchObject(data);
    expect(cache.extract()['User:u1'].data).toEqual({
      __typename: 'User',
      id: 'u1',
      info: { city: 'A' },
      name: 'One',
      // (References are left out of extracted data.)
      friends: [undefined, undefined, undefined],
    });
  });

  it(`keep the fields of objects selected before their leaf fields`, () => {
    const query = gql`
      query {
        place {
          location {
            lat
          }
          __typename
          id
          name
        }
      }
    `;
    const data = { place: { location: { lat: 1 }, __typename: 'Place', id: 'p1', name: 'One' } };
    const { cache, once, twice } = written(query, data);
    expect(once).toEqual(twice);
    expect(cache.extract()['Place:p1'].data).toEqual({
      location: { lat: 1 },
      __typename: 'Place',
      id: 'p1',
      name: 'One',
    });
  });

  it(`store unselected fields of the payload`, () => {
    const query = gql`
      query {
        thing {
          __typename
          id
          name
        }
      }
    `;
    const data = { thing: { __typename: 'Thing', id: 1, name: 'One', extra: 'kept' } };
    const { cache, once, twice } = written(query, data);
    expect(once).toEqual(twice);
    expect(cache.extract()['Thing:1'].data).toEqual({ __typename: 'Thing', id: 1, name: 'One', extra: 'kept' });
  });

  it(`store custom scalars serialized`, () => {
    const query = gql`
      query {
        event {
          __typename
          id
          at
        }
      }
    `;
    const config = {
      scalars: {
        Date: {
          coerceToParsed: (value: unknown) => (typeof value === 'string' ? new Date(value) : value),
          coerceToSerialized: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
        } as any,
      },
      typePolicies: { Event: { fields: { at: { scalar: 'Date' } } } },
    };
    const at = new Date('2026-01-01T00:00:00Z');
    const { cache, once, twice } = written(query, { event: { __typename: 'Event', id: 'e1', at } }, config);
    expect(once).toEqual(twice);
    expect(cache.extract()['Event:e1'].data).toMatchObject({ at: '2026-01-01T00:00:00.000Z' });
    expect(cache.readQuery<any>({ query })!.event.at).toEqual(at);
  });

  it(`merge entities written twice in one write`, () => {
    const query = gql`
      query {
        first {
          __typename
          id
          a
        }
        second {
          __typename
          id
          b
        }
      }
    `;
    const data = { first: { __typename: 'T', id: 1, a: 'A' }, second: { __typename: 'T', id: 1, b: 'B' } };
    const { cache } = written(query, data);
    expect(cache.extract()['T:1'].data).toEqual({ __typename: 'T', id: 1, a: 'A', b: 'B' });
  });
});
