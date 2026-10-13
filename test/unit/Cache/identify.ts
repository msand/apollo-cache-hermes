import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';

// Identifying written objects, like InMemoryCache's policies.identify.
describe(`identifying written objects`, () => {
  const caches = { Hermes, InMemoryCache } as const;
  const mutation = gql`
    mutation {
      doIt {
        ok
        query {
          foo
        }
      }
    }
  `;
  const fooQuery = gql`
    {
      foo
    }
  `;

  for (const [name, Cache] of Object.entries(caches)) {
    describe(name, () => {
      it(`writes objects of the root query type to ROOT_QUERY`, () => {
        const cache = new Cache();
        cache.write({
          dataId: 'ROOT_MUTATION',
          query: mutation,
          result: { doIt: { __typename: 'Payload', ok: true, query: { __typename: 'Query', foo: 1 } } },
        });
        expect(cache.readQuery<any>({ query: fooQuery })?.foo).to.eq(1);
      });

      it(`writes objects of a renamed root query type to ROOT_QUERY`, () => {
        const cache = new Cache({ typePolicies: { RootQuery: { queryType: true } } });
        cache.write({
          dataId: 'ROOT_MUTATION',
          query: mutation,
          result: { doIt: { __typename: 'Payload', ok: true, query: { __typename: 'RootQuery', foo: 2 } } },
        });
        expect(cache.readQuery<any>({ query: fooQuery })?.foo).to.eq(2);
        expect(cache.identify({ __typename: 'RootQuery' })).to.eq('ROOT_QUERY');
      });

      it(`passes dataIdFromObject the object's fields by their names, and the context`, () => {
        const contexts: any[] = [];
        const cache = new Cache({
          dataIdFromObject(object: any, context: any) {
            contexts.push(context);
            return object.__typename === 'U' && object.id !== undefined ? `U#${object.id}` : undefined;
          },
        });
        cache.writeQuery({
          query: gql`
            {
              u {
                uid: id
              }
            }
          `,
          data: { u: { __typename: 'U', uid: 1 } },
        });
        expect(Object.keys(cache.extract())).to.include('U#1');
        const context = contexts.find(c => c?.typename === 'U');
        expect(context?.storeObject).to.deep.include({ __typename: 'U', id: 1 });
      });
    });
  }

  it(`keeps ROOT_QUERY when a reference to it is removed`, () => {
    const cache = new Hermes();
    const write = (query: unknown) =>
      cache.write({
        dataId: 'ROOT_MUTATION',
        query: mutation,
        result: { doIt: { __typename: 'Payload', ok: true, query } },
      });
    write({ __typename: 'Query', foo: 1 });
    write(null);
    expect(cache.extract()['ROOT_QUERY']).to.not.eq(undefined);
    expect(cache.readQuery<any>({ query: fooQuery })?.foo).to.eq(1);
  });
});
