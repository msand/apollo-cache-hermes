import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';
import { toNormalizedCacheObject } from '../../helpers';

// Like InMemoryCache, optional variables declared without a default value are
// undefined unless passed (not null): they are left out of field arguments and
// store field names.
describe(`optional variables without a default value`, () => {
  const query = gql`
    query ($limit: Int, $filter: String, $sort: String = "asc") {
      items(limit: $limit) {
        id
      }
      search(filter: $filter, sort: $sort)
      nested(where: { name: $filter })
    }
  `;
  const data = {
    items: [{ __typename: 'Item', id: 1 }],
    search: 'found',
    nested: 'deep',
  };

  function bothCaches(config: { typePolicies?: any } = {}) {
    return [new Hermes(config), new InMemoryCache(config)] as const;
  }

  it(`gives fields the store field names InMemoryCache does`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    hermes.writeQuery({ query, data });
    inMemoryCache.writeQuery({ query, data });

    const expected = inMemoryCache.extract().ROOT_QUERY;
    expect(Object.keys(expected!).sort()).to.deep.eq([
      '__typename',
      'items',
      'nested({"where":{}})',
      'search({"sort":"asc"})',
    ]);
    expect(Object.keys(toNormalizedCacheObject(hermes.extract()).ROOT_QUERY!).sort()).to.deep.eq(
      Object.keys(expected!).sort(),
    );
  });

  it(`reads data written with the variables passed as undefined`, () => {
    const [hermes] = bothCaches();
    hermes.writeQuery({ query, data, variables: { limit: undefined } });
    expect(hermes.readQuery({ query })).to.deep.eq(data);
  });

  it(`stores fields apart from those written with null`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({ query, data });
      cache.writeQuery({ query, data: { ...data, search: 'null filter' }, variables: { filter: null } });
    }
    expect(hermes.readQuery({ query })).to.deep.eq(inMemoryCache.readQuery({ query }));
    expect(hermes.readQuery<any>({ query })!.search).to.eq('found');
    expect(hermes.readQuery<any>({ query, variables: { filter: null } })!.search).to.eq('null filter');
  });

  it(`does not read the value stored for undefined arguments for other arguments`, () => {
    const [hermes, inMemoryCache] = bothCaches();
    const searchQuery = gql`
      query ($filter: String) {
        search(filter: $filter)
      }
    `;
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({ query: searchQuery, data: { search: 'unfiltered' } });
    }
    for (const cache of [hermes, inMemoryCache]) {
      expect(cache.readQuery({ query: searchQuery })).to.deep.eq({ search: 'unfiltered' });
      expect(cache.diff({ query: searchQuery, variables: { filter: 'x' }, optimistic: false }).complete).to.eq(false);
    }
  });

  it(`passes them to read functions and keyArgs functions as undefined`, () => {
    const seen: any[] = [];
    const typePolicies = {
      Query: {
        fields: {
          items: {
            keyArgs(args: any) {
              seen.push(['keyArgs', args]);
              return false as const;
            },
          },
          search: {
            read(existing: any, { args }: any) {
              seen.push(['read', args]);
              return existing;
            },
          },
        },
      },
    };
    const [hermes, inMemoryCache] = bothCaches({ typePolicies });
    const results = [hermes, inMemoryCache].map(cache => {
      seen.length = 0;
      cache.writeQuery({ query, data });
      const result = cache.readQuery({ query });
      return { result, seen: seen.slice() };
    });

    expect(results[0].result).to.deep.eq(results[1].result);
    const argsOf = (calls: any[], kind: string) => calls.filter(([k]) => k === kind).map(([, args]) => args);
    expect(argsOf(results[0].seen, 'read')[0]).to.deep.eq({ filter: undefined, sort: 'asc' });
    expect(argsOf(results[0].seen, 'read')[0]).to.have.property('filter', undefined);
    expect(argsOf(results[0].seen, 'keyArgs')[0]).to.have.property('limit', undefined);
    expect(argsOf(results[1].seen, 'keyArgs')[0]).to.have.property('limit', undefined);
  });

  it(`still applies declared default values (also of non-null variables)`, () => {
    const withDefault = gql`
      query ($count: Int! = 3) {
        items(limit: $count) {
          id
        }
      }
    `;
    const [hermes, inMemoryCache] = bothCaches();
    for (const cache of [hermes, inMemoryCache]) {
      cache.writeQuery({ query: withDefault, data: { items: data.items } });
    }
    expect(Object.keys(toNormalizedCacheObject(hermes.extract()).ROOT_QUERY!).sort()).to.deep.eq(
      Object.keys(inMemoryCache.extract().ROOT_QUERY!).sort(),
    );
    expect(toNormalizedCacheObject(hermes.extract()).ROOT_QUERY).to.have.property('items({"limit":3})');
  });
});
