import { gql, InMemoryCache } from '@apollo/client';
import type { TypePolicies } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

import { Hermes } from '../../../src';

// Like InMemoryCache, References that read functions return are resolved at
// any depth of their results (not just at the top, or in top-level lists),
// following the field's selection set.
describe(`read functions returning nested References`, () => {
  const items = [
    { __typename: 'Item', id: 1, name: 'one' },
    { __typename: 'Item', id: 2, name: 'two' },
  ];

  function bothCaches(typePolicies: TypePolicies) {
    const caches = [new Hermes({ typePolicies }), new InMemoryCache({ typePolicies })] as const;
    for (const cache of caches) {
      cache.writeQuery({
        query: gql`
          query {
            items {
              id
              name
            }
          }
        `,
        data: { items },
      });
    }
    return caches;
  }

  const connectionQuery = gql`
    query {
      connection {
        edges {
          cursor
          node {
            id
            name
          }
        }
        list {
          id
          name
        }
      }
    }
  `;

  function connectionPolicies(refs: string[]): TypePolicies {
    return {
      Query: {
        fields: {
          connection: {
            read: (_existing, { toReference }) => ({
              __typename: 'Connection',
              edges: refs.map((id, i) => ({ __typename: 'Edge', cursor: `c${i}`, node: toReference(id) })),
              list: refs.map(id => toReference(id)),
            }),
          },
        },
      },
    };
  }

  it(`resolves References in objects and lists within the result`, () => {
    for (const cache of bothCaches(connectionPolicies(['Item:1', 'Item:2']))) {
      const diff = cache.diff<any>({ query: connectionQuery, optimistic: false });
      expect(diff.complete).toBe(true);
      expect(diff.missing).toBeUndefined();
      expect(diff.result).toMatchObject({
        connection: {
          edges: [
            { cursor: 'c0', node: { __typename: 'Item', id: 1, name: 'one' } },
            { cursor: 'c1', node: { __typename: 'Item', id: 2, name: 'two' } },
          ],
          list: [
            { __typename: 'Item', id: 1, name: 'one' },
            { __typename: 'Item', id: 2, name: 'two' },
          ],
        },
      });
    }
  });

  it(`reports dangling References within the result, and drops them from lists`, () => {
    const [hermes, inMemoryCache] = bothCaches(connectionPolicies(['Item:1', 'Item:3']));
    const hermesDiff = hermes.diff<any>({ query: connectionQuery, optimistic: false });
    const inMemoryDiff = inMemoryCache.diff<any>({ query: connectionQuery, optimistic: false });

    expect(hermesDiff.complete).toBe(false);
    expect(hermesDiff.missing?.missing).toEqual(inMemoryDiff.missing?.missing);
    expect(hermesDiff.missing?.missing).toEqual({
      connection: { edges: { 1: { node: 'Dangling reference to missing Item:3 object' } } },
    });
    expect(hermesDiff.result.connection.list).toEqual([items[0]]);
    expect(hermesDiff.result.connection.edges[1].node).toEqual({});
  });

  it(`drops dangling References from lists the read function returns`, () => {
    const query = gql`
      query {
        favorites {
          id
          name
        }
      }
    `;
    const typePolicies: TypePolicies = {
      Query: {
        fields: {
          favorites: { read: (_existing, { toReference }) => [toReference('Item:3'), toReference('Item:2')] },
        },
      },
    };
    for (const cache of bothCaches(typePolicies)) {
      const diff = cache.diff<any>({ query, optimistic: false });
      expect(diff.complete).toBe(true);
      expect(diff.result.favorites).toEqual([items[1]]);
    }
  });

  it(`reports missing fields of the referenced entities`, () => {
    const query = gql`
      query {
        connection {
          edges {
            node {
              id
              price
            }
          }
        }
      }
    `;
    const [hermes, inMemoryCache] = bothCaches(connectionPolicies(['Item:1']));
    const hermesDiff = hermes.diff<any>({ query, optimistic: false });
    const inMemoryDiff = inMemoryCache.diff<any>({ query, optimistic: false });

    expect(hermesDiff.complete).toBe(false);
    expect(hermesDiff.missing?.missing).toEqual(inMemoryDiff.missing?.missing);
    expect(hermesDiff.missing?.message).toBe("Can't find field 'price' on Item:1 object");
  });

  it(`calls the read functions of the referenced entities`, () => {
    const typePolicies: TypePolicies = {
      ...connectionPolicies(['Item:1', 'Item:2']),
      Item: { fields: { name: { read: (name: string) => name.toUpperCase() } } },
    };
    for (const cache of bothCaches(typePolicies)) {
      const result = cache.readQuery<any>({ query: connectionQuery });
      expect(result.connection.edges.map((edge: any) => edge.node.name)).toEqual(['ONE', 'TWO']);
      expect(result.connection.list.map((item: any) => item.name)).toEqual(['ONE', 'TWO']);
    }
  });

  it(`reads fields with arguments from their store field names`, () => {
    const query = gql`
      query {
        wrapper {
          count(min: 2)
          item(id: 2) {
            name
          }
        }
      }
    `;
    const typePolicies: TypePolicies = {
      Query: {
        fields: {
          wrapper: {
            read: (_existing, { toReference }) => ({
              __typename: 'Wrapper',
              'count({"min":2})': 5,
              'item({"id":2})': toReference('Item:2'),
            }),
          },
        },
      },
    };
    for (const cache of bothCaches(typePolicies)) {
      const diff = cache.diff<any>({ query, optimistic: false });
      expect(diff.complete).toBe(true);
      expect(diff.result).toMatchObject({ wrapper: { count: 5, item: { name: 'two' } } });
    }
  });

  it(`reads relayStylePagination connections (with normalized edges)`, () => {
    const query = gql`
      query ($after: String) {
        todos(after: $after) {
          edges {
            id
            cursor
            node {
              id
              title
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    const typePolicies: TypePolicies = { Query: { fields: { todos: relayStylePagination() } } };
    const page = (ids: number[], hasNextPage: boolean) => ({
      todos: {
        __typename: 'TodoConnection',
        edges: ids.map(id => ({
          // (Edges with ids are normalized, so the read function returns References to them.)
          __typename: 'TodoEdge',
          id: `edge${id}`,
          cursor: `cursor${id}`,
          node: { __typename: 'Todo', id, title: `Todo ${id}` },
        })),
        pageInfo: { __typename: 'PageInfo', hasNextPage, endCursor: `cursor${ids[ids.length - 1]}` },
      },
    });
    const results = [new Hermes({ typePolicies }), new InMemoryCache({ typePolicies })].map(cache => {
      cache.writeQuery({ query, data: page([1, 2], true) });
      cache.writeQuery({ query, variables: { after: 'cursor2' }, data: page([3], false) });
      return cache.diff<any>({ query, optimistic: false });
    });

    for (const diff of results) {
      expect(diff.complete).toBe(true);
      expect(diff.result.todos.edges.map((edge: any) => edge.node)).toEqual([
        { __typename: 'Todo', id: 1, title: 'Todo 1' },
        { __typename: 'Todo', id: 2, title: 'Todo 2' },
        { __typename: 'Todo', id: 3, title: 'Todo 3' },
      ]);
    }
    expect(results[0].result).toMatchObject(results[1].result);
  });
});
