import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';
import { toNormalizedCacheObject } from '../../helpers';

// Like InMemoryCache, root objects (ROOT_QUERY, ROOT_MUTATION and
// ROOT_SUBSCRIPTION) are never identified as entities by their data, even when
// they have an id (or their type has keyFields, or dataIdFromObject would
// identify them).
describe(`root objects with an id`, () => {
  const normalized = (cache: Hermes) => toNormalizedCacheObject(cache.extract(), cache.policies.rootTypenamesById);
  const query = gql`
    query ($a: Int) {
      id
      plain
      field(a: $a)
      thing {
        id
        name
      }
    }
  `;
  const variables = { a: 1 };
  const data = {
    id: 'abcd',
    plain: 'plain value',
    field: 'parameterized value',
    thing: { __typename: 'Thing', id: 1, name: 'Thing 1' },
  };

  const configs = {
    'by default': {},
    'with keyFields on the root type': { typePolicies: { Query: { keyFields: ['id'] } } },
    'with a dataIdFromObject that identifies everything': {
      dataIdFromObject: (object: any) => `${object.__typename}#${object.id}`,
    },
    'with a renamed root type': { typePolicies: { RootQuery: { queryType: true as const } } },
  };

  for (const [description, config] of Object.entries(configs)) {
    describe(description, () => {
      const typename = 'typePolicies' in config && 'RootQuery' in config.typePolicies ? 'RootQuery' : 'Query';
      const thingId = 'dataIdFromObject' in config ? 'Thing#1' : 'Thing:1';
      const restored = {
        ROOT_QUERY: {
          __typename: typename,
          id: 'abcd',
          plain: 'plain value',
          'field({"a":1})': 'parameterized value',
          thing: { __ref: thingId },
        },
        [thingId]: { __typename: 'Thing', id: 1, name: 'Thing 1' },
      };

      it(`reads the fields of a restored root`, () => {
        const cache = new Hermes(config as any);
        cache.restore(restored as any);
        expect(cache.readQuery({ query, variables })).to.deep.eq({ ...data, __typename: typename });
        expect(cache.diff({ query, variables, optimistic: false }).complete).to.eq(true);
      });

      it(`writes the fields of a root with an id to the root itself`, () => {
        const cache = new Hermes(config as any);
        const inMemoryCache = new InMemoryCache(config as any);
        for (const each of [cache, inMemoryCache]) {
          each.writeQuery({ query, variables, data: { ...data, __typename: typename } });
        }
        const extracted = normalized(cache);
        expect(Object.keys(extracted).sort()).to.deep.eq(Object.keys(inMemoryCache.extract()).sort());
        expect(extracted.ROOT_QUERY).to.deep.eq(inMemoryCache.extract().ROOT_QUERY);
        expect(cache.readQuery({ query, variables })).to.deep.eq({ ...data, __typename: typename });
      });

      it(`keeps writing to the restored root`, () => {
        const cache = new Hermes(config as any);
        cache.restore(restored as any);
        cache.writeQuery({
          query: gql`
            query {
              other
            }
          `,
          data: { other: 'other value' },
        });
        cache.writeQuery({ query, variables: { a: 2 }, data: { ...data, field: 'second value' } });

        // (Hermes' results may contain a superset of the selected fields.)
        expect(cache.readQuery({ query, variables })).to.deep.include({ ...data, __typename: typename });
        expect(cache.readQuery<any>({ query, variables: { a: 2 } })!.field).to.eq('second value');
        expect(
          cache.readQuery({
            query: gql`
              query {
                other
              }
            `,
          }),
        ).to.deep.include({ other: 'other value' });
        expect(Object.keys(normalized(cache)).sort()).to.deep.eq(Object.keys(restored).sort());
      });

      it(`modifies the fields of the restored root`, () => {
        const cache = new Hermes(config as any);
        cache.restore(restored as any);
        cache.modify({ fields: { plain: () => 'modified' } });
        expect(cache.readQuery<any>({ query, variables })!.plain).to.eq('modified');
        expect(normalized(cache).ROOT_QUERY).to.include({ id: 'abcd', plain: 'modified' });
      });
    });
  }

  it(`writes the fields of a mutation root with an id to the root itself`, () => {
    const mutation = gql`
      mutation {
        id
        doIt
      }
    `;
    const cache = new Hermes();
    const inMemoryCache = new InMemoryCache();
    for (const each of [cache, inMemoryCache]) {
      each.writeQuery({ query: mutation, id: 'ROOT_MUTATION', data: { __typename: 'Mutation', id: 'm', doIt: true } });
    }
    expect(normalized(cache)).to.deep.eq(inMemoryCache.extract());
    expect(normalized(cache).ROOT_MUTATION).to.deep.eq({ __typename: 'Mutation', id: 'm', doIt: true });
  });
});
