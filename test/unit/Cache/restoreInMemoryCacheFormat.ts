import { expect } from 'chai';
import { gql } from '@apollo/client';

import { Hermes } from '../../../src';

// Restoring the normalized cache objects that InMemoryCache's extract() produces.
describe(`restore() of InMemoryCache data`, () => {
  const post = { __typename: 'Post', id: 1, title: 'a' };

  describe(`References nested in field values`, () => {
    const query = gql`
      {
        feed(type: "news") {
          id
          title
        }
        posts {
          id
          title
        }
        page(first: 1) {
          items {
            id
            title
          }
        }
        wrapper {
          inner {
            post {
              id
              title
            }
          }
        }
      }
    `;
    const restored = {
      ROOT_QUERY: {
        __typename: 'Query',
        'feed:{"type":"news"}': [{ __ref: 'Post:1' }],
        posts: [{ __ref: 'Post:1' }],
        'page({"first":1})': { items: [{ __ref: 'Post:1' }] },
        wrapper: { inner: { post: { __ref: 'Post:1' } } },
      },
      'Post:1': post,
    };
    const expected = {
      __typename: 'Query',
      feed: [post],
      posts: [post],
      page: { items: [post] },
      wrapper: { inner: { post } },
    };

    function restoredCache() {
      const cache = new Hermes({ typePolicies: { Query: { fields: { feed: { keyArgs: ['type'] } } } } });
      cache.restore(restored);
      return cache;
    }

    it(`are read as the entities they reference`, () => {
      const cache = restoredCache();
      const diff = cache.diff({ query, optimistic: false });
      expect(diff.complete).to.eq(true);
      expect(diff.result).to.deep.eq(expected);
    });

    it(`keep the entities they reference from being garbage collected`, () => {
      const cache = restoredCache();
      expect(cache.gc()).to.deep.eq([]);
      expect(cache.readQuery({ query })).to.deep.eq(expected);
    });

    it(`are references of the nodes holding them`, () => {
      const extracted: any = restoredCache().extract();
      const inbound = extracted['Post:1'].inbound.map(({ id, path }: any) => `${id} ${path.join('.')}`).sort();
      expect(inbound).to.deep.eq([
        'ROOT_QUERY posts.0',
        'ROOT_QUERY wrapper.inner.post',
        'ROOT_QUERY❖["feed"]❖feed:{"type":"news"} 0',
        'ROOT_QUERY❖["page"]❖{"first":1} items.0',
      ]);
    });

    it(`don't modify the restored data`, () => {
      const copy = JSON.parse(JSON.stringify(restored));
      restoredCache();
      expect(restored).to.deep.eq(copy);
    });
  });

  describe(`fields stored per their keyArgs`, () => {
    const restored = {
      ROOT_QUERY: { __typename: 'Query', a: { __ref: 'T:1' } },
      'T:1': { __typename: 'T', id: 1, 'feed:{"type":"x"}': 5 },
    };

    it(`are referenced by their entity only`, () => {
      const cache = new Hermes({ typePolicies: { T: { fields: { feed: { keyArgs: ['type'] } } } } });
      cache.restore(restored);
      const extracted: any = cache.extract();
      expect(extracted['T:1❖["feed"]❖feed:{"type":"x"}'].inbound).to.deep.eq([{ id: 'T:1', path: ['feed'] }]);
    });

    it(`are removed with their entity`, () => {
      const cache = new Hermes({ typePolicies: { T: { fields: { feed: { keyArgs: ['type'] } } } } });
      cache.restore(restored);
      cache.writeQuery({
        query: gql`
          {
            a {
              id
            }
          }
        `,
        data: { a: null },
      });
      expect(Object.keys(cache.extract())).to.deep.eq(['ROOT_QUERY']);
    });
  });

  describe(`__META`, () => {
    const restored = {
      ROOT_QUERY: { __typename: 'Query' },
      'T:9': { __typename: 'T', id: 9, name: 'retained' },
      __META: { extraRootIds: ['T:9'] },
    };

    it(`is not restored as a node`, () => {
      const cache = new Hermes();
      cache.restore(restored);
      expect(Object.keys(cache.extract()).sort()).to.deep.eq(['ROOT_QUERY', 'T:9']);
    });

    it(`retains its extraRootIds, like InMemoryCache`, () => {
      const cache = new Hermes();
      cache.restore(restored);
      expect(cache.gc()).to.deep.eq([]);
      expect(
        cache.readFragment({
          id: 'T:9',
          fragment: gql`
            fragment F on T {
              name
            }
          `,
        }),
      ).to.deep.include({ name: 'retained' });
    });
  });

  it(`restores store objects that have a type field`, () => {
    const cache = new Hermes();
    cache.restore({
      ROOT_QUERY: { __typename: 'Query', post: { __ref: 'Post:1' } },
      'Post:1': { __typename: 'Post', id: 1, type: 1 },
    });
    expect(
      cache.readQuery({
        query: gql`
          {
            post {
              id
              type
            }
          }
        `,
      }),
    ).to.deep.include({
      post: { __typename: 'Post', id: 1, type: 1 },
    });
  });

  it(`prefers a field's value without directives to its values with custom directives`, () => {
    const cache = new Hermes();
    cache.restore({ ROOT_QUERY: { __typename: 'Query', 'name@upperCase': 'BOB', name: 'bob' } });
    expect(
      cache.readQuery({
        query: gql`
          {
            name
          }
        `,
      }),
    ).to.deep.include({ name: 'bob' });
  });

  it(`keeps optimistic updates, like InMemoryCache`, () => {
    const cache = new Hermes();
    const query = gql`
      {
        name
      }
    `;
    cache.writeQuery({ query, data: { name: 'old' } });
    cache.recordOptimisticTransaction(proxy => {
      proxy.writeQuery({ query, data: { name: 'optimistic' } });
    }, 'update');

    cache.restore({ ROOT_QUERY: { __typename: 'Query', name: 'restored' } });

    expect(cache.readQuery<any>({ query }, true)?.name).to.eq('optimistic');
    expect(cache.readQuery<any>({ query }, false)?.name).to.eq('restored');
    cache.removeOptimistic('update');
    expect(cache.readQuery<any>({ query }, true)?.name).to.eq('restored');
  });
});
