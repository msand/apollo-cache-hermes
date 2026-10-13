import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';

// Merge policies (merge: true, and type-level merge functions) behave like
// InMemoryCache's.
describe(`merge policies`, () => {
  const caches = { Hermes, InMemoryCache } as const;

  /** The stored fields of the entity `id`, in both caches' formats. */
  function storedEntity(cache: Hermes | InMemoryCache, id: string) {
    const extracted: any = cache.extract();
    return cache instanceof Hermes ? extracted[id]?.data : extracted[id];
  }

  describe(`merge: true`, () => {
    for (const [name, Cache] of Object.entries(caches)) {
      it(`does not copy the fields of a replaced entity into the new one (${name})`, () => {
        const cache = new Cache({ typePolicies: { Query: { fields: { item: { merge: true } } } } });
        cache.writeQuery({
          query: gql`
            {
              item {
                id
                name
                extra
              }
            }
          `,
          data: { item: { __typename: 'T', id: 'A', name: 'a', extra: 'x' } },
        });
        cache.writeQuery({
          query: gql`
            {
              item {
                id
                name
              }
            }
          `,
          data: { item: { __typename: 'T', id: 'B', name: 'b' } },
        });

        expect(storedEntity(cache, 'T:B')).to.deep.eq({ __typename: 'T', id: 'B', name: 'b' });
      });

      it(`still merges an unidentified object into the entity it replaces (${name})`, () => {
        const cache = new Cache({ typePolicies: { Query: { fields: { item: { merge: true } } } } });
        cache.writeQuery({
          query: gql`
            {
              item {
                id
                name
                extra
              }
            }
          `,
          data: { item: { __typename: 'T', id: 'A', name: 'a', extra: 'x' } },
        });
        cache.writeQuery({
          query: gql`
            {
              item {
                name
              }
            }
          `,
          data: { item: { __typename: 'T', name: 'b' } },
        });

        expect(storedEntity(cache, 'T:A')).to.deep.eq({ __typename: 'T', id: 'A', name: 'b', extra: 'x' });
        expect(
          cache.readQuery({
            query: gql`
              {
                item {
                  id
                  name
                  extra
                }
              }
            `,
          }),
        ).to.deep.eq({
          item: { __typename: 'T', id: 'A', name: 'b', extra: 'x' },
        });
      });

      it(`does not merge objects of different types (${name})`, () => {
        const cache = new Cache({ typePolicies: { Query: { fields: { item: { merge: true } } } } });
        cache.writeQuery({
          query: gql`
            {
              item {
                name
                extra
              }
            }
          `,
          data: { item: { __typename: 'T', name: 'a', extra: 'x' } },
        });
        cache.writeQuery({
          query: gql`
            {
              item {
                name
              }
            }
          `,
          data: { item: { __typename: 'U', name: 'b' } },
        });

        expect(
          cache.readQuery({
            query: gql`
              {
                item {
                  name
                }
              }
            `,
          }),
        ).to.deep.eq({
          item: { __typename: 'U', name: 'b' },
        });
        expect(
          cache.readQuery({
            query: gql`
              {
                item {
                  name
                  extra
                }
              }
            `,
            returnPartialData: true,
          }),
        ).to.deep.eq({
          item: { __typename: 'U', name: 'b' },
        });
      });
    }
  });
});
