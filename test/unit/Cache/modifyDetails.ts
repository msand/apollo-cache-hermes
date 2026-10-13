import { expect } from 'chai';
import { gql, InMemoryCache, Reference } from '@apollo/client';

import { Hermes } from '../../../src';

// The details cache.modify passes to modifiers, like InMemoryCache's.
describe(`cache.modify details`, () => {
  const caches = { Hermes, InMemoryCache } as const;

  describe(`storeFieldName`, () => {
    /** The storeFieldNames modifiers get for the fields of ROOT_QUERY. */
    function storeFieldNames(Cache: typeof Hermes | typeof InMemoryCache) {
      const cache = new Cache({ typePolicies: { Query: { fields: { keyed: { keyArgs: ['type'] } } } } });
      cache.writeQuery({
        query: gql`
          {
            plain
            feed(a: 1, b: "❖") {
              id
            }
            keyed(type: "news", page: 2)
          }
        `,
        data: { plain: 1, feed: [{ __typename: 'P', id: 1 }], keyed: 3 },
      });
      const names: string[] = [];
      cache.modify({
        fields(value, { storeFieldName }) {
          names.push(storeFieldName);
          return value;
        },
      });
      return names.filter(name => name !== '__typename').sort();
    }

    it(`is InMemoryCache's store field name`, () => {
      expect(storeFieldNames(Hermes)).to.deep.eq(['feed({"a":1,"b":"❖"})', 'keyed:{"type":"news"}', 'plain']);
    });

    it(`is the same as InMemoryCache's`, () => {
      expect(storeFieldNames(Hermes)).to.deep.eq(storeFieldNames(InMemoryCache));
    });

    for (const [name, Cache] of Object.entries(caches)) {
      it(`can be passed back to modify (${name})`, () => {
        const cache = new Cache();
        const query = gql`
          {
            feed(a: 1) {
              id
            }
          }
        `;
        cache.writeQuery({ query, data: { feed: [{ __typename: 'P', id: 1 }] } });
        let storeFieldName = '';
        cache.modify({
          fields: {
            feed(value, details) {
              storeFieldName = details.storeFieldName;
              return value;
            },
          },
        });
        cache.modify({ fields: { [storeFieldName]: (_value, { DELETE }) => DELETE } });
        expect(cache.readQuery({ query })).to.eq(null);
      });
    }

    it(`gives modifiers the storage of the field's merge function`, () => {
      let mergeStorage: object | undefined;
      const cache = new Hermes({
        typePolicies: {
          Query: {
            fields: {
              feed: {
                merge(_existing, incoming, { storage }) {
                  mergeStorage = storage;
                  return incoming;
                },
              },
            },
          },
        },
      });
      cache.writeQuery({
        query: gql`
          {
            feed(a: 1)
          }
        `,
        data: { feed: 1 },
      });
      let modifierStorage: object | undefined;
      cache.modify({
        fields: {
          feed(value, { storage }) {
            modifierStorage = storage;
            return value;
          },
        },
      });
      expect(mergeStorage).to.not.eq(undefined);
      expect(modifierStorage).to.eq(mergeStorage);
    });
  });

  for (const [name, Cache] of Object.entries(caches)) {
    it(`toReference accepts an id (${name})`, () => {
      const cache = new Cache();
      cache.writeQuery({
        query: gql`
          {
            book {
              id
            }
          }
        `,
        data: { book: { __typename: 'Book', id: 1 } },
      });
      let reference: Reference | undefined;
      cache.modify({
        fields: {
          book(value, { toReference }) {
            reference = toReference('Book:1');
            return value;
          },
        },
      });
      expect(reference).to.deep.eq({ __ref: 'Book:1' });
    });
  }
});
