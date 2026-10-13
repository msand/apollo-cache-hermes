import { expect } from 'chai';
import { gql } from '@apollo/client';
import type { Reference } from '@apollo/client';
import { concatPagination } from '@apollo/client/utilities';

import { Hermes } from '../../../src';

describe(`keyArgs`, () => {
  const feedQuery = gql`
    query Feed($type: String, $offset: Int) {
      feed(type: $type, offset: $offset)
    }
  `;

  function writeFeed(cache: Hermes, type: string, offset: number, feed: string[]) {
    cache.writeQuery({ query: feedQuery, variables: { type, offset }, data: { feed } });
  }

  function readFeed(cache: Hermes, type: string, offset: number) {
    return cache.readQuery<{ feed: string[] }>({ query: feedQuery, variables: { type, offset } });
  }

  describe(`with a key specifier`, () => {
    function createCache() {
      return new Hermes({
        typePolicies: {
          Query: {
            fields: { feed: { keyArgs: ['type'], merge: (existing = [], incoming) => [...existing, ...incoming] } },
          },
        },
      });
    }

    it(`stores every argument set with the same key arguments in one node`, () => {
      const cache = createCache();
      writeFeed(cache, 'news', 0, ['a', 'b']);
      writeFeed(cache, 'news', 2, ['c']);
      writeFeed(cache, 'sports', 0, ['x']);

      const extracted = cache.extract();
      expect(extracted['ROOT_QUERY'].parameterized).to.deep.eq([
        { id: 'ROOT_QUERY❖["feed"]❖feed:{"type":"news"}', path: ['feed'] },
        { id: 'ROOT_QUERY❖["feed"]❖feed:{"type":"sports"}', path: ['feed'] },
      ]);
      expect(extracted['ROOT_QUERY❖["feed"]❖feed:{"type":"news"}'].data).to.deep.eq(['a', 'b', 'c']);
      expect(readFeed(cache, 'news', 5)).to.deep.eq({ feed: ['a', 'b', 'c'] });
      expect(readFeed(cache, 'sports', 0)).to.deep.eq({ feed: ['x'] });
    });

    it(`passes the full arguments and the InMemoryCache store field name to merge functions`, () => {
      const calls: any[] = [];
      const cache = new Hermes({
        typePolicies: {
          Query: {
            fields: {
              feed: {
                keyArgs: ['type'],
                merge(existing: string[] = [], incoming: string[], { args, storeFieldName }) {
                  calls.push({ existing, args, storeFieldName });
                  return [...existing, ...incoming];
                },
              },
            },
          },
        },
      });
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'news', 1, ['b']);

      expect(calls).to.deep.eq([
        { existing: [], args: { type: 'news', offset: 0 }, storeFieldName: 'feed:{"type":"news"}' },
        { existing: ['a'], args: { type: 'news', offset: 1 }, storeFieldName: 'feed:{"type":"news"}' },
      ]);
    });

    it(`survives an extract() and restore() round trip`, () => {
      const cache = createCache();
      writeFeed(cache, 'news', 0, ['a']);

      const restored = createCache();
      restored.restore(JSON.parse(JSON.stringify(cache.extract())));
      expect(readFeed(restored, 'news', 3)).to.deep.eq({ feed: ['a'] });
      writeFeed(restored, 'news', 1, ['b']);
      expect(readFeed(restored, 'news', 0)).to.deep.eq({ feed: ['a', 'b'] });
    });

    it(`evicts the stored value addressed by the key arguments`, () => {
      const cache = createCache();
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'sports', 0, ['x']);

      expect(cache.evict({ fieldName: 'feed', args: { type: 'news', offset: 7 } })).to.eq(true);
      expect(Object.keys(cache.extract())).to.deep.eq(['ROOT_QUERY', 'ROOT_QUERY❖["feed"]❖feed:{"type":"sports"}']);
    });

    it(`modifies the stored values by field name or by store field name`, () => {
      const cache = createCache();
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'sports', 0, ['x']);

      const storeFieldNames: string[] = [];
      cache.modify({
        fields: {
          feed(value, { storeFieldName }) {
            storeFieldNames.push(storeFieldName);
            return value;
          },
        },
      });
      expect(storeFieldNames).to.deep.eq(['feed:{"type":"news"}', 'feed:{"type":"sports"}']);

      cache.modify<any>({ fields: { 'feed:{"type":"sports"}': (_value: any, { DELETE }: any) => DELETE } });
      expect(readFeed(cache, 'news', 0)).to.deep.eq({ feed: ['a'] });
      expect(cache.extract()['ROOT_QUERY❖["feed"]❖feed:{"type":"sports"}']).to.eq(undefined);
    });

    it(`refers to directives and variables`, () => {
      const cache = new Hermes({
        typePolicies: {
          Query: { fields: { feed: { keyArgs: ['@lang', ['code'], '$region'] } } },
        },
      });
      cache.writeQuery({
        query: gql`
          query Feed($region: String) {
            feed @lang(code: "fi")
          }
        `,
        variables: { region: 'eu' },
        data: { feed: ['a'] },
      });

      expect(Object.keys(cache.extract())).to.include(
        'ROOT_QUERY❖["feed"]❖feed:{"@lang":{"code":"fi"},"$region":"eu"}',
      );
    });
  });

  describe(`with keyArgs: false`, () => {
    it(`stores the field under its name, merging pages with concatPagination`, () => {
      const cache = new Hermes({
        typePolicies: { Query: { fields: { feed: concatPagination() } } },
      });
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'sports', 1, ['b']);

      expect(cache.extract()['ROOT_QUERY']).to.deep.eq({ type: 0, data: { feed: ['a', 'b'] } });
      expect(readFeed(cache, 'news', 0)).to.deep.eq({ feed: ['a', 'b'] });

      // Evicting any argument set evicts the field.
      expect(cache.evict({ fieldName: 'feed', args: { type: 'news' } })).to.eq(true);
      expect(cache.extract()['ROOT_QUERY']).to.deep.eq({ type: 0, data: {} });
    });

    it(`is assumed for fields with read and merge functions`, () => {
      const cache = new Hermes({
        typePolicies: {
          Query: {
            fields: {
              feed: {
                read: (existing: string[] | undefined, { args }) => existing?.slice(args!.offset),
                merge: (existing: string[] = [], incoming: string[]) => [...existing, ...incoming],
              },
            },
          },
        },
      });
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'news', 1, ['b']);

      expect(cache.extract()['ROOT_QUERY'].data).to.deep.eq({ feed: ['a', 'b'] });
      expect(readFeed(cache, 'news', 1)).to.deep.eq({ feed: ['b'] });
    });
  });

  describe(`keyArgs functions`, () => {
    it(`can return a store field name, a key specifier or false`, () => {
      const cache = new Hermes({
        typePolicies: {
          Query: {
            fields: {
              feed: {
                keyArgs: (args, { typename, fieldName }) => {
                  expect(typename).to.eq('Query');
                  expect(fieldName).to.eq('feed');
                  if (args!.type === 'news') return 'latest';
                  if (args!.type === 'sports') return ['type'];
                  return false;
                },
              },
            },
          },
        },
      });
      writeFeed(cache, 'news', 0, ['a']);
      writeFeed(cache, 'sports', 0, ['b']);
      writeFeed(cache, 'other', 0, ['c']);

      const extracted = cache.extract();
      expect(extracted['ROOT_QUERY❖["feed"]❖feed:latest'].data).to.deep.eq(['a']);
      expect(extracted['ROOT_QUERY❖["feed"]❖feed:{"type":"sports"}'].data).to.deep.eq(['b']);
      expect(extracted['ROOT_QUERY'].data).to.deep.eq({ feed: ['c'] });
    });
  });

  describe(`readField`, () => {
    it(`reads the value stored for the key arguments`, () => {
      const cache = new Hermes({
        typePolicies: {
          Query: {
            fields: {
              book: { keyArgs: ['isbn'] },
              favorite: {
                read: (_, { readField }) =>
                  readField<Reference>({ fieldName: 'book', args: { isbn: '1', junk: true } }),
              },
            },
          },
          Book: { keyFields: ['isbn'] },
        },
      });
      cache.writeQuery({
        query: gql`
          query Book($isbn: String, $junk: Boolean) {
            book(isbn: $isbn, junk: $junk) {
              isbn
              title
            }
          }
        `,
        variables: { isbn: '1', junk: false },
        data: { book: { __typename: 'Book', isbn: '1', title: 'One' } },
      });

      const result = cache.readQuery<any>({
        query: gql`
          query {
            favorite {
              title
            }
          }
        `,
      });
      expect(result.favorite.title).to.eq('One');
    });
  });

  describe(`@connection`, () => {
    it(`stores the field under its connection key (and filtered arguments)`, () => {
      const cache = new Hermes();
      cache.writeQuery({
        query: gql`
          query Books($order: String) {
            books(skip: 0, order: $order) @connection(key: "abc", filter: ["order"])
            all: books(skip: 0) @connection(key: "abc")
          }
        `,
        variables: { order: 'popularity' },
        data: { books: ['a'], all: ['b'] },
      });

      expect(Object.keys(cache.extract()).sort()).to.deep.eq([
        'ROOT_QUERY',
        'ROOT_QUERY❖["books"]❖books:abc',
        'ROOT_QUERY❖["books"]❖books:abc({"order":"popularity"})',
      ]);
    });
  });
});
