import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { DocumentNode } from 'graphql';
import { gql } from 'graphql-tag';
import type { ApolloCache, Cache, InMemoryCache, StoreObject } from '@apollo/client/cache';
import { EntityStore, MissingFieldError, Policies } from '@apollo/client/cache';
import type { Reference, StoreValue } from '@apollo/client/utilities';
import { isReference } from '@apollo/client/utilities';
import { makeReference, stringifyForDisplay } from '@apollo/client/utilities/internal';
import { InvariantError } from '@apollo/client/utilities/invariant';
// not exported
import { supportsResultCaching } from '@apollo/client/cache/inmemory/entityStore'; // eslint-disable-line import/no-unresolved

import { spyOnConsole } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../../src';
import { toNormalizedCacheObject } from '../../../../helpers';

describe('EntityStore', () => {
  // Hermes: this tests InMemoryCache's internal EntityStore. Its Policies only
  // hold on to the cache (whose config EntityStore reads to check for custom
  // scalars), so a Hermes cache stands in for the InMemoryCache.
  it('should support result caching if so configured', () => {
    const policies = new Policies({
      cache: Object.assign(new Hermes(), { config: {} }) as unknown as InMemoryCache,
    });

    const storeWithResultCaching = new EntityStore.Root({
      policies,
      resultCaching: true,
    });

    const storeWithoutResultCaching = new EntityStore.Root({
      policies,
      resultCaching: false,
    });

    expect(supportsResultCaching({ some: 'arbitrary object ' })).toBe(false);
    expect(supportsResultCaching(storeWithResultCaching)).toBe(true);
    expect(supportsResultCaching(storeWithoutResultCaching)).toBe(false);

    const layerWithCaching = storeWithResultCaching.addLayer('with caching', () => {});
    expect(supportsResultCaching(layerWithCaching)).toBe(true);
    const anotherLayer = layerWithCaching.addLayer('another layer', () => {});
    expect(supportsResultCaching(anotherLayer)).toBe(true);
    expect(anotherLayer.removeLayer('with caching').removeLayer('another layer')).toBe(storeWithResultCaching.stump);
    expect(supportsResultCaching(storeWithResultCaching)).toBe(true);

    const layerWithoutCaching = storeWithoutResultCaching.addLayer('with caching', () => {});
    expect(supportsResultCaching(layerWithoutCaching)).toBe(false);
    expect(layerWithoutCaching.removeLayer('with caching')).toBe(storeWithoutResultCaching.stump);
    expect(supportsResultCaching(storeWithoutResultCaching)).toBe(false);
  });

  function newBookAuthorCache() {
    const cache = new Hermes({
      dataIdFromObject(value: any) {
        switch (value && value.__typename) {
          case 'Book':
            return `Book:${value.isbn}`;
          case 'Author':
            return `Author:${value.name}`;
        }
      },
    });

    const query: TypedDocumentNode<{
      book: {
        __typename: string;
        title: string;
        isbn: string;
        author: {
          __typename: string;
          name: string;
        };
      };
    }> = gql`
      query {
        book {
          title
          author {
            name
          }
        }
      }
    `;

    return {
      cache,
      query,
    };
  }

  it('should respect optimistic updates, when active', () => {
    const { cache, query } = newBookAuthorCache();

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
          author: {
            __typename: 'Author',
            name: 'Ray Bradbury',
          },
        },
      },
    });

    expect(cache.gc()).toEqual([]);

    // Orphan the F451 / Ray Bradbury data, but avoid collecting garbage yet.
    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '1980719802',
          title: '1984',
          author: {
            __typename: 'Author',
            name: 'George Orwell',
          },
        },
      },
    });

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: 'Author:Ray Bradbury',
        fragment: gql`
          fragment AuthorBooks on Author {
            books {
              title
            }
          }
        `,
        data: {
          books: [
            {
              __typename: 'Book',
              isbn: '9781451673319',
              title: 'Fahrenheit 451',
            },
          ],
        },
      });
    }, 'ray books');

    // Hermes: references are inbound/outbound edges, and extract() has no
    // __META.extraRootIds (Hermes does not retain written ids). Hermes also
    // deletes orphaned nodes eagerly: the second write above already removed
    // the F451 / Ray Bradbury data, so the optimistic layer holds only the
    // fields it wrote.
    const georgeOrwellAndRootQuery = {
      ROOT_QUERY: {
        type: 0,
        outbound: [{ id: 'Book:1980719802', path: ['book'] }],
        data: { book: undefined },
      },
      'Book:1980719802': {
        type: 0,
        outbound: [{ id: 'Author:George Orwell', path: ['author'] }],
        inbound: [{ id: 'ROOT_QUERY', path: ['book'] }],
        data: {
          __typename: 'Book',
          isbn: '1980719802',
          title: '1984',
          author: undefined,
        },
      },
      'Author:George Orwell': {
        type: 0,
        inbound: [{ id: 'Book:1980719802', path: ['author'] }],
        data: {
          __typename: 'Author',
          name: 'George Orwell',
        },
      },
    };

    expect(cache.extract(true)).toEqual({
      ...georgeOrwellAndRootQuery,
      'Author:Ray Bradbury': {
        type: 0,
        outbound: [{ id: 'Book:9781451673319', path: ['books', 0] }],
        data: {
          books: [undefined],
        },
      },
      'Book:9781451673319': {
        type: 0,
        inbound: [{ id: 'Author:Ray Bradbury', path: ['books', 0] }],
        data: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
        },
      },
    });

    // Nothing can be reclaimed while the optimistic update is retaining
    // Fahrenheit 451.
    expect(cache.gc()).toEqual([]);

    cache.removeOptimistic('ray books');

    // Hermes: the optimistic books field has disappeared, and with it the
    // (already orphaned and deleted) F451 / Ray Bradbury data, so there is
    // nothing left for gc() to collect.
    expect(cache.extract(true)).toEqual(georgeOrwellAndRootQuery);

    expect(cache.gc()).toEqual([]);

    expect(cache.extract(true)).toEqual(georgeOrwellAndRootQuery);

    expect(cache.gc()).toEqual([]);
  });

  // Hermes: relies on per-layer retain counts (retain(id, true) on InMemoryCache's optimistic EntityStore layer)
  it.skip('should respect retain/release methods', () => {
    const { query, cache } = newBookAuthorCache();

    const eagerBookData = {
      __typename: 'Book',
      isbn: '1603589082',
      title: 'Eager',
      subtitle: 'The Surprising, Secret Life of Beavers and Why They Matter',
      author: {
        __typename: 'Author',
        name: 'Ben Goldfarb',
      },
    };

    const spinelessBookData = {
      __typename: 'Book',
      isbn: '0735211280',
      title: 'Spineless',
      subtitle: 'The Science of Jellyfish and the Art of Growing a Backbone',
      author: {
        __typename: 'Author',
        name: 'Juli Berwald',
      },
    };

    cache.writeQuery({
      query,
      data: {
        book: spinelessBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        book: {
          __ref: 'Book:0735211280',
        },
      },
      'Book:0735211280': {
        __typename: 'Book',
        author: {
          __ref: 'Author:Juli Berwald',
        },
        title: 'Spineless',
      },
      'Author:Juli Berwald': {
        __typename: 'Author',
        name: 'Juli Berwald',
      },
    });

    cache.writeQuery({
      query,
      data: {
        book: eagerBookData,
      },
    });

    const snapshotWithBothBooksAndAuthors = {
      ROOT_QUERY: {
        __typename: 'Query',
        book: {
          __ref: 'Book:1603589082',
        },
      },
      'Book:0735211280': {
        __typename: 'Book',
        author: {
          __ref: 'Author:Juli Berwald',
        },
        title: 'Spineless',
      },
      'Author:Juli Berwald': {
        __typename: 'Author',
        name: 'Juli Berwald',
      },
      'Book:1603589082': {
        __typename: 'Book',
        author: {
          __ref: 'Author:Ben Goldfarb',
        },
        title: 'Eager',
      },
      'Author:Ben Goldfarb': {
        __typename: 'Author',
        name: 'Ben Goldfarb',
      },
    };

    expect(cache.extract(true)).toEqual(snapshotWithBothBooksAndAuthors);

    expect(cache.retain('Book:0735211280')).toBe(1);

    expect(cache.gc()).toEqual([]);

    expect(cache.retain('Author:Juli Berwald')).toBe(1);

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: 'Author:Juli Berwald',
        fragment: gql`
          fragment AuthorBooks on Author {
            books {
              title
            }
          }
        `,
        data: {
          books: [
            {
              __typename: 'Book',
              isbn: '0735211280',
              title: 'Spineless',
            },
          ],
        },
      });
    }, 'juli books');

    // Retain the Spineless book on the optimistic layer (for the first time)
    // but release it on the root layer.
    expect(cache.retain('Book:0735211280' /* TODO , true*/)).toBe(1);
    expect(cache.release('Book:0735211280')).toBe(0);

    // The Spineless book is still protected by the reference from author Juli
    // Berwald's optimistically-added author.books field.
    expect(cache.gc()).toEqual([]);

    const juliBookMeta = {
      extraRootIds: ['Author:Juli Berwald', 'Book:0735211280'],
    };

    expect(cache.extract(true)).toEqual({
      __META: juliBookMeta,
      ROOT_QUERY: {
        __typename: 'Query',
        book: {
          __ref: 'Book:1603589082',
        },
      },
      'Book:0735211280': {
        __typename: 'Book',
        author: {
          __ref: 'Author:Juli Berwald',
        },
        title: 'Spineless',
      },
      'Author:Juli Berwald': {
        __typename: 'Author',
        name: 'Juli Berwald',
        // Note this extra optimistic field.
        books: [
          {
            __ref: 'Book:0735211280',
          },
        ],
      },
      'Book:1603589082': {
        __typename: 'Book',
        author: {
          __ref: 'Author:Ben Goldfarb',
        },
        title: 'Eager',
      },
      'Author:Ben Goldfarb': {
        __typename: 'Author',
        name: 'Ben Goldfarb',
      },
    });

    const juliMeta = {
      extraRootIds: ['Author:Juli Berwald'],
    };

    // A non-optimistic snapshot will not have the extra books field.
    expect(cache.extract(false)).toEqual({
      ...snapshotWithBothBooksAndAuthors,
      __META: juliMeta,
    });

    cache.removeOptimistic('juli books');

    // The optimistic books field is gone now that we've removed the optimistic
    // layer that added it.
    expect(cache.extract(true)).toEqual({
      ...snapshotWithBothBooksAndAuthors,
      __META: juliMeta,
    });

    // The Spineless book is no longer retained or kept alive by any other root
    // IDs, so it can finally be collected.
    expect(cache.gc()).toEqual(['Book:0735211280']);

    expect(cache.release('Author:Juli Berwald')).toBe(0);

    // Now that Juli Berwald's author entity is no longer retained, garbage
    // collection cometh for her. Look out, Juli!
    expect(cache.gc()).toEqual(['Author:Juli Berwald']);

    expect(cache.gc()).toEqual([]);
  });

  it('allows cache eviction', () => {
    const { cache, query } = newBookAuthorCache();

    const cuckoosCallingBook = {
      __typename: 'Book',
      isbn: '031648637X',
      title: "The Cuckoo's Calling",
      author: {
        __typename: 'Author',
        name: 'Robert Galbraith',
      },
    };

    expect(cache.identify(cuckoosCallingBook)).toBe('Book:031648637X');

    cache.writeQuery({
      query,
      data: {
        book: cuckoosCallingBook,
      },
    });

    expect(cache.evict({ id: 'Author:J.K. Rowling' })).toBe(false);

    const bookAuthorFragment = gql`
      fragment BookAuthor on Book {
        author {
          name
        }
      }
    `;

    const fragmentResult = cache.readFragment<StoreObject>({
      id: cache.identify(cuckoosCallingBook)!,
      fragment: bookAuthorFragment,
    });

    // Hermes: results may contain a superset of the selected fields.
    expect(fragmentResult).toMatchObject({
      __typename: 'Book',
      author: {
        __typename: 'Author',
        name: 'Robert Galbraith',
      },
    });

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: cache.identify(cuckoosCallingBook)!,
        fragment: bookAuthorFragment,
        data: {
          ...fragmentResult,
          author: {
            __typename: 'Author',
            name: 'J.K. Rowling',
          },
        },
      });
    }, 'real name');

    // Hermes: references are inbound/outbound edges, and extract() has no
    // __META.extraRootIds (Hermes does not serialize retained ids).
    const snapshotWithBothNames = {
      ROOT_QUERY: {
        data: { book: undefined },
        outbound: [{ id: 'Book:031648637X', path: ['book'] }],
        type: 0,
      },
      'Book:031648637X': {
        data: {
          __typename: 'Book',
          title: "The Cuckoo's Calling",
          isbn: '031648637X',
          author: undefined,
        },
        inbound: [{ id: 'ROOT_QUERY', path: ['book'] }],
        outbound: [{ id: 'Author:J.K. Rowling', path: ['author'] }],
        type: 0,
      },
      // Hermes: the optimistic write orphaned Author:Robert Galbraith, and
      // Hermes deletes orphaned entities right away (rather than in gc()), so
      // it is only in the non-optimistic snapshot.
      'Author:J.K. Rowling': {
        data: {
          __typename: 'Author',
          name: 'J.K. Rowling',
        },
        inbound: [{ id: 'Book:031648637X', path: ['author'] }],
        type: 0,
      },
    };

    expect(cache.extract(true)).toEqual(snapshotWithBothNames);

    expect(cache.gc()).toEqual([]);

    expect(cache.retain('Author:Robert Galbraith')).toBe(1);

    expect(cache.gc()).toEqual([]);

    expect(cache.evict({ id: 'Author:Robert Galbraith' })).toBe(true);

    expect(cache.gc()).toEqual([]);

    cache.removeOptimistic('real name');

    const rootQueryNode = {
      data: { book: undefined },
      outbound: [{ id: 'Book:031648637X', path: ['book'] }],
      type: 0,
    };
    const bookNode = (authorId: string) => ({
      data: {
        __typename: 'Book',
        title: "The Cuckoo's Calling",
        isbn: '031648637X',
        author: undefined,
      },
      inbound: [{ id: 'ROOT_QUERY', path: ['book'] }],
      outbound: [{ id: authorId, path: ['author'] }],
      type: 0,
    });

    // Hermes: no __META.extraRootIds (Hermes does not serialize retained ids).
    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: rootQueryNode,
      // A dangling reference to the evicted Author:Robert Galbraith.
      'Book:031648637X': bookNode('Author:Robert Galbraith'),
      // The Robert Galbraith Author record is no longer here because
      // cache.evict evicts data from all EntityStore layers.
    });

    cache.writeFragment({
      id: cache.identify(cuckoosCallingBook)!,
      fragment: bookAuthorFragment,
      data: {
        ...fragmentResult,
        author: {
          __typename: 'Author',
          name: 'J.K. Rowling',
        },
      },
    });

    const rowlingNode = (inbound: object[] | undefined) => ({
      data: {
        __typename: 'Author',
        name: 'J.K. Rowling',
      },
      ...(inbound ? { inbound } : {}),
      type: 0,
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: rootQueryNode,
      'Book:031648637X': bookNode('Author:J.K. Rowling'),
      'Author:J.K. Rowling': rowlingNode([{ id: 'Book:031648637X', path: ['author'] }]),
    });

    expect(cache.retain('Author:Robert Galbraith')).toBe(2);

    expect(cache.gc()).toEqual([]);

    expect(cache.release('Author:Robert Galbraith')).toBe(1);
    expect(cache.release('Author:Robert Galbraith')).toBe(0);

    expect(cache.gc()).toEqual([]);

    function checkFalsyEvictId(id: any) {
      expect(id).toBeFalsy();
      expect(
        cache.evict({
          // Accidentally passing a falsy/undefined options.id to
          // cache.evict (perhaps because cache.identify failed) should
          // *not* cause the ROOT_QUERY object to be evicted! In order for
          // cache.evict to default to ROOT_QUERY, the options.id property
          // must be *absent* (not just undefined).
          id,
        }),
      ).toBe(false);
    }
    checkFalsyEvictId(void 0);
    checkFalsyEvictId(null);
    checkFalsyEvictId(false);
    checkFalsyEvictId(0);
    checkFalsyEvictId('');

    // In other words, this is how you evict the entire ROOT_QUERY
    // object. If you're ever tempted to do this, you probably want to use
    // cache.clear() instead, but evicting the ROOT_QUERY should work.
    expect(cache.evict({})).toBe(true);

    expect(cache.extract(true)).toEqual({
      'Book:031648637X': { ...bookNode('Author:J.K. Rowling'), inbound: undefined },
      'Author:J.K. Rowling': rowlingNode([{ id: 'Book:031648637X', path: ['author'] }]),
    });

    const ccId = cache.identify(cuckoosCallingBook)!;
    expect(cache.retain(ccId)).toBe(2);
    expect(cache.release(ccId)).toBe(1);
    expect(cache.release(ccId)).toBe(0);

    expect(cache.gc().sort()).toEqual(['Author:J.K. Rowling', ccId]);
  });

  // Hermes: retain() counts are not persisted through extract()/restore() (no __META in Hermes' serialization)
  it.skip('ignores retainment count for ROOT_QUERY', () => {
    const { cache, query } = newBookAuthorCache();

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '1982156945',
          title: 'Solutions and Other Problems',
          author: {
            __typename: 'Author',
            name: 'Allie Brosh',
          },
        },
      },
    });

    const allieId = cache.identify({
      __typename: 'Author',
      name: 'Allie Brosh',
    })!;
    expect(allieId).toBe('Author:Allie Brosh');
    expect(cache.retain(allieId)).toBe(1);

    const snapshot = cache.extract();
    expect(snapshot).toMatchSnapshot();

    expect(cache.gc()).toEqual([]);

    const cache2 = newBookAuthorCache().cache;
    cache2.restore(snapshot);

    expect(cache2.extract()).toEqual(snapshot);

    expect(cache2.gc()).toEqual([]);

    // Evicting the whole ROOT_QUERY object is probably a terrible idea in
    // any real application, but it's worthwhile to test that eviction is
    // stronger than retainment.
    expect(
      cache2.evict({
        id: 'ROOT_QUERY',
      }),
    ).toBe(true);

    expect(cache2.gc().sort()).toEqual(['Book:1982156945']);

    expect(cache2.extract()).toMatchSnapshot();

    expect(cache2.release(allieId)).toBe(0);

    expect(cache2.gc().sort()).toEqual(['Author:Allie Brosh']);

    expect(cache2.extract()).toEqual({});
  });

  // Hermes: mutates InMemoryCache's internal EntityStore (cache.data, store.refs)
  it.skip('cache.gc is not confused by StoreObjects with stray __ref fields', () => {
    const cache = new Hermes({
      typePolicies: {
        Person: {
          keyFields: ['name'],
        },
      },
    });

    const query = gql`
      query {
        parent {
          name
          child {
            name
          }
        }
      }
    `;

    const data = {
      parent: {
        __typename: 'Person',
        name: 'Will Smith',
        child: {
          __typename: 'Person',
          name: 'Jaden Smith',
        },
      },
    };

    cache.writeQuery({ query, data });

    expect(cache.gc()).toEqual([]);

    const willId = cache.identify(data.parent)!;
    const store = cache['data'];
    const storeRootData = store['data'];
    // Hacky way of injecting a stray __ref field into the Will Smith Person
    // object, clearing store.refs (which was populated by the previous GC).
    storeRootData[willId]!.__ref = willId;
    store['refs'] = {};

    expect(cache.extract()).toEqual({
      'Person:{"name":"Jaden Smith"}': {
        __typename: 'Person',
        name: 'Jaden Smith',
      },
      'Person:{"name":"Will Smith"}': {
        __typename: 'Person',
        name: 'Will Smith',
        child: {
          __ref: 'Person:{"name":"Jaden Smith"}',
        },
        // This is the bogus line that makes this Person object look like a
        // Reference object to the garbage collector.
        __ref: 'Person:{"name":"Will Smith"}',
      },
      ROOT_QUERY: {
        __typename: 'Query',
        parent: {
          __ref: 'Person:{"name":"Will Smith"}',
        },
      },
    });

    // Ensure the garbage collector is not confused by the stray __ref.
    expect(cache.gc()).toEqual([]);
  });

  it('allows evicting specific fields', () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
        publisherOfBook(isbn: $isbn) {
          name
          yearOfFounding
        }
      }
    `;

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            authorOfBook: {
              keyArgs: ['isbn'],
            },
          },
        },
        Author: {
          keyFields: ['name'],
        },
        Publisher: {
          keyFields: ['name'],
        },
      },
    });

    const TedChiangData = {
      __typename: 'Author',
      name: 'Ted Chiang',
      hobby: 'video games',
    };

    const KnopfData = {
      __typename: 'Publisher',
      name: 'Alfred A. Knopf',
      yearOfFounding: 1915,
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
        publisherOfBook: KnopfData,
      },
      variables: {
        isbn: '1529014514',
      },
    });

    // Hermes: parameterized fields are separate nodes linked to ROOT_QUERY
    // (identified by their keyArgs store field names, when they have keyArgs),
    // and references are inbound/outbound edges.
    const fieldId = (fieldName: string, isbn: string) =>
      fieldName === 'authorOfBook'
        ? `ROOT_QUERY❖["authorOfBook"]❖authorOfBook:{"isbn":"${isbn}"}`
        : `ROOT_QUERY❖["${fieldName}"]❖{"isbn":"${isbn}"}`;
    const fieldRef = (fieldName: string, isbn: string) => ({ id: fieldId(fieldName, isbn), path: [fieldName] });
    const fieldNode = (fieldName: string, entityId: string) => ({
      data: null,
      inbound: [{ id: 'ROOT_QUERY', path: [fieldName] }],
      outbound: [{ id: entityId, path: [] }],
      type: 1,
    });
    const entityNode = (data: object, fieldName: string, isbn: string) => ({
      data,
      inbound: [{ id: fieldId(fieldName, isbn), path: [] }],
      type: 0,
    });

    const justTedRootQueryData = {
      [fieldId('authorOfBook', '1529014514')]: fieldNode('authorOfBook', 'Author:{"name":"Ted Chiang"}'),
      [fieldId('publisherOfBook', '1529014514')]: fieldNode('publisherOfBook', 'Publisher:{"name":"Alfred A. Knopf"}'),
    };

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        parameterized: [fieldRef('authorOfBook', '1529014514'), fieldRef('publisherOfBook', '1529014514')],
        type: 0,
      },
      ...justTedRootQueryData,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Publisher:{"name":"Alfred A. Knopf"}': entityNode(KnopfData, 'publisherOfBook', '1529014514'),
    });

    const JennyOdellData = {
      __typename: 'Author',
      name: 'Jenny Odell',
      hobby: 'birding',
    };

    const MelvilleData = {
      __typename: 'Publisher',
      name: 'Melville House',
      yearOfFounding: 2001,
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JennyOdellData,
        publisherOfBook: MelvilleData,
      },
      variables: {
        isbn: '1760641790',
      },
    });

    const justJennyRootQueryData = {
      [fieldId('authorOfBook', '1760641790')]: fieldNode('authorOfBook', 'Author:{"name":"Jenny Odell"}'),
      [fieldId('publisherOfBook', '1760641790')]: fieldNode('publisherOfBook', 'Publisher:{"name":"Melville House"}'),
    };

    const bothRootQueries = {
      ROOT_QUERY: {
        parameterized: [
          fieldRef('authorOfBook', '1529014514'),
          fieldRef('authorOfBook', '1760641790'),
          fieldRef('publisherOfBook', '1529014514'),
          fieldRef('publisherOfBook', '1760641790'),
        ],
        type: 0,
      },
      ...justTedRootQueryData,
      ...justJennyRootQueryData,
    };

    expect(cache.extract()).toEqual({
      ...bothRootQueries,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Publisher:{"name":"Alfred A. Knopf"}': entityNode(KnopfData, 'publisherOfBook', '1529014514'),
      'Author:{"name":"Jenny Odell"}': entityNode(JennyOdellData, 'authorOfBook', '1760641790'),
      'Publisher:{"name":"Melville House"}': entityNode(MelvilleData, 'publisherOfBook', '1760641790'),
    });

    const fullTedResult = cache.readQuery<any>({
      query,
      variables: {
        isbn: '1529014514',
      },
    });

    expect(fullTedResult).toEqual({
      authorOfBook: TedChiangData,
      publisherOfBook: KnopfData,
    });

    const fullJennyResult = cache.readQuery<any>({
      query,
      variables: {
        isbn: '1760641790',
      },
    });

    expect(fullJennyResult).toEqual({
      authorOfBook: JennyOdellData,
      publisherOfBook: MelvilleData,
    });

    cache.evict({
      id: cache.identify({
        __typename: 'Publisher',
        name: 'Alfred A. Knopf',
      })!,
      fieldName: 'yearOfFounding',
    });

    expect(cache.extract()).toEqual({
      ...bothRootQueries,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Publisher:{"name":"Alfred A. Knopf"}': entityNode(
        {
          __typename: 'Publisher',
          name: 'Alfred A. Knopf',
          // yearOfFounding has been removed
        },
        'publisherOfBook',
        '1529014514',
      ),
      'Author:{"name":"Jenny Odell"}': entityNode(JennyOdellData, 'authorOfBook', '1760641790'),
      'Publisher:{"name":"Melville House"}': entityNode(MelvilleData, 'publisherOfBook', '1760641790'),
    });

    // Nothing to garbage collect yet.
    expect(cache.gc()).toEqual([]);

    cache.evict({
      id: cache.identify({
        __typename: 'Publisher',
        name: 'Melville House',
      })!,
    });

    expect(cache.extract()).toEqual({
      ...bothRootQueries,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Publisher:{"name":"Alfred A. Knopf"}': entityNode(
        {
          __typename: 'Publisher',
          name: 'Alfred A. Knopf',
        },
        'publisherOfBook',
        '1529014514',
      ),
      'Author:{"name":"Jenny Odell"}': entityNode(JennyOdellData, 'authorOfBook', '1760641790'),
      // Melville House has been removed
    });

    cache.evict({ id: 'ROOT_QUERY', fieldName: 'publisherOfBook' });

    const rootQueriesWithoutPublisherOfBook = {
      ROOT_QUERY: {
        parameterized: [fieldRef('authorOfBook', '1529014514'), fieldRef('authorOfBook', '1760641790')],
        type: 0,
      },
      [fieldId('authorOfBook', '1529014514')]: justTedRootQueryData[fieldId('authorOfBook', '1529014514')],
      [fieldId('authorOfBook', '1760641790')]: justJennyRootQueryData[fieldId('authorOfBook', '1760641790')],
    };

    expect(cache.extract()).toEqual({
      ...rootQueriesWithoutPublisherOfBook,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Publisher:{"name":"Alfred A. Knopf"}': {
        data: {
          __typename: 'Publisher',
          name: 'Alfred A. Knopf',
        },
        type: 0,
      },
      'Author:{"name":"Jenny Odell"}': entityNode(JennyOdellData, 'authorOfBook', '1760641790'),
    });

    expect(cache.gc()).toEqual(['Publisher:{"name":"Alfred A. Knopf"}']);

    expect(cache.extract()).toEqual({
      ...rootQueriesWithoutPublisherOfBook,
      'Author:{"name":"Ted Chiang"}': entityNode(TedChiangData, 'authorOfBook', '1529014514'),
      'Author:{"name":"Jenny Odell"}': entityNode(JennyOdellData, 'authorOfBook', '1760641790'),
    });

    const partialTedResult = cache.diff<any>({
      query,
      returnPartialData: true,
      optimistic: false, // required but not important
      variables: {
        isbn: '1529014514',
      },
    });
    expect(partialTedResult.complete).toBe(false);
    expect(partialTedResult.result).toEqual({
      authorOfBook: TedChiangData,
    });
    // The result caching system preserves the referential identity of
    // unchanged nested result objects.
    // Hermes: results built by read functions are equal but not identical across reads.
    expect(partialTedResult.result.authorOfBook).toEqual(fullTedResult.authorOfBook);

    const partialJennyResult = cache.diff<any>({
      query,
      returnPartialData: true,
      optimistic: false, // required but not important
      variables: {
        isbn: '1760641790',
      },
    });
    expect(partialJennyResult.complete).toBe(false);
    expect(partialJennyResult.result).toEqual({
      authorOfBook: JennyOdellData,
    });
    // The result caching system preserves the referential identity of
    // unchanged nested result objects.
    // Hermes: results built by read functions are equal but not identical across reads.
    expect(partialJennyResult.result.authorOfBook).toEqual(fullJennyResult.authorOfBook);

    const tedWithoutHobby = {
      __typename: 'Author',
      name: 'Ted Chiang',
    };

    cache.evict({
      id: cache.identify(tedWithoutHobby)!,
      fieldName: 'hobby',
    });

    expect(
      cache.diff<any>({
        query,
        returnPartialData: true,
        optimistic: false, // required but not important
        variables: {
          isbn: '1529014514',
        },
      }),
    ).toEqual({
      complete: false,
      result: {
        authorOfBook: tedWithoutHobby,
      },
      missing: new MissingFieldError(
        'Can\'t find field \'hobby\' on Author:{"name":"Ted Chiang"} object',
        {
          publisherOfBook: "Can't find field 'publisherOfBook' on ROOT_QUERY object",
          authorOfBook: {
            hobby: 'Can\'t find field \'hobby\' on Author:{"name":"Ted Chiang"} object',
          },
        },
        expect.anything(), // query
        expect.anything(), // variables
      ),
    });

    cache.evict({ id: 'ROOT_QUERY', fieldName: 'authorOfBook' });
    expect(cache.gc().sort()).toEqual(['Author:{"name":"Jenny Odell"}', 'Author:{"name":"Ted Chiang"}']);
    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        // Everything else has been removed.
        type: 0,
      },
    });
  });

  it('allows evicting specific fields with specific arguments', () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
      }
    `;

    const cache = new Hermes();

    // Hermes: compare in InMemoryCache's normalized shape.

    const TedChiangData = {
      __typename: 'Author',
      name: 'Ted Chiang',
      hobby: 'video games',
    };

    const IsaacAsimovData = {
      __typename: 'Author',
      name: 'Isaac Asimov',
      hobby: 'chemistry',
    };

    const JamesCoreyData = {
      __typename: 'Author',
      name: 'James S.A. Corey',
      hobby: 'tabletop games',
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
      },
      variables: {
        isbn: '1',
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: IsaacAsimovData,
      },
      variables: {
        isbn: '2',
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JamesCoreyData,
      },
      variables: {},
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"1"})': {
          __typename: 'Author',
          name: 'Ted Chiang',
          hobby: 'video games',
        },
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: { isbn: '1' },
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: { isbn: '3' },
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: {},
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
      },
    });
  });

  it('allows evicting specific fields with specific arguments using EvictOptions', () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
      }
    `;

    const cache = new Hermes();

    // Hermes: compare in InMemoryCache's normalized shape.

    const TedChiangData = {
      __typename: 'Author',
      name: 'Ted Chiang',
      hobby: 'video games',
    };

    const IsaacAsimovData = {
      __typename: 'Author',
      name: 'Isaac Asimov',
      hobby: 'chemistry',
    };

    const JamesCoreyData = {
      __typename: 'Author',
      name: 'James S.A. Corey',
      hobby: 'tabletop games',
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
      },
      variables: {
        isbn: '1',
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: IsaacAsimovData,
      },
      variables: {
        isbn: '2',
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JamesCoreyData,
      },
      variables: {},
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"1"})': {
          __typename: 'Author',
          name: 'Ted Chiang',
          hobby: 'video games',
        },
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: { isbn: '1' },
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: { isbn: '3' },
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
        authorOfBook: {
          __typename: 'Author',
          name: 'James S.A. Corey',
          hobby: 'tabletop games',
        },
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: {},
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'authorOfBook({"isbn":"2"})': {
          __typename: 'Author',
          name: 'Isaac Asimov',
          hobby: 'chemistry',
        },
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
    });

    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
      },
    });
  });

  it('supports cache.identify(reference)', () => {
    const cache = new Hermes({
      typePolicies: {
        Task: {
          keyFields: ['uuid'],
        },
      },
    });

    expect(cache.identify(makeReference('oyez'))).toBe('oyez');

    const todoRef = cache.writeFragment({
      fragment: gql`
        fragment TodoId on Todo {
          id
        }
      `,
      data: {
        __typename: 'Todo',
        id: 123,
      },
    });
    expect(isReference(todoRef)).toBe(true);
    expect(cache.identify(todoRef!)).toBe('Todo:123');

    const taskRef = cache.writeFragment({
      fragment: gql`
        fragment TaskId on Task {
          uuid
        }
      `,
      data: {
        __typename: 'Task',
        uuid: 'eb8cffcc-7a9e-4d8b-a517-7d987bf42138',
      },
    });
    expect(isReference(taskRef)).toBe(true);
    expect(cache.identify(taskRef!)).toBe('Task:{"uuid":"eb8cffcc-7a9e-4d8b-a517-7d987bf42138"}');
  });

  it('supports cache.identify(object)', () => {
    const queryWithAliases: DocumentNode = gql`
      query {
        abcs {
          first: a
          second: b
          ...Rest
        }
      }
      fragment Rest on ABCs {
        third: c
      }
    `;

    const queryWithoutAliases: DocumentNode = gql`
      query {
        abcs {
          a
          b
          ...Rest
        }
      }
      fragment Rest on ABCs {
        c
      }
    `;

    const cache = new Hermes({
      typePolicies: {
        ABCs: {
          keyFields: ['b', 'a', 'c'],
        },
      },
    });

    const ABCs = {
      __typename: 'ABCs',
      first: 'ay',
      second: 'bee',
      third: 'see',
    };

    cache.writeQuery({
      query: queryWithAliases,
      data: {
        abcs: ABCs,
      },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        data: { abcs: undefined },
        outbound: [{ id: 'ABCs:{"b":"bee","a":"ay","c":"see"}', path: ['abcs'] }],
        type: 0,
      },
      'ABCs:{"b":"bee","a":"ay","c":"see"}': {
        data: {
          __typename: 'ABCs',
          a: 'ay',
          b: 'bee',
          c: 'see',
        },
        inbound: [{ id: 'ROOT_QUERY', path: ['abcs'] }],
        type: 0,
      },
    });

    const resultWithAliases = cache.readQuery({
      query: queryWithAliases,
    });

    // Hermes: results may contain a superset of the selected fields.
    expect(resultWithAliases).toMatchObject({ abcs: ABCs });

    const resultWithoutAliases = cache.readQuery({
      query: queryWithoutAliases,
    });

    expect(resultWithoutAliases).toEqual({
      abcs: {
        __typename: 'ABCs',
        a: 'ay',
        b: 'bee',
        c: 'see',
      },
    });

    expect(
      cache.identify({
        __typename: 'ABCs',
        a: 1,
        b: 2,
        c: 3,
      }),
    ).toBe('ABCs:{"b":2,"a":1,"c":3}');

    {
      using consoleSpies = spyOnConsole('warn');
      expect(cache.identify(ABCs)).toBeUndefined();
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpies.warn).toHaveBeenCalledWith(
        new InvariantError(`Missing field 'b' while extracting keyFields from ${stringifyForDisplay(ABCs, 2)}`),
      );
    }

    expect(
      cache.readFragment({
        id: cache.identify({
          __typename: 'ABCs',
          a: 'ay',
          b: 'bee',
          c: 'see',
        })!,
        fragment: gql`
          fragment JustB on ABCs {
            b
          }
        `,
      }),
    ).toMatchObject({
      __typename: 'ABCs',
      b: 'bee',
    });

    expect(
      cache.readQuery({
        query: queryWithAliases,
      }),
    ).toBe(resultWithAliases);

    expect(
      cache.readQuery({
        query: queryWithoutAliases,
      }),
    ).toBe(resultWithoutAliases);

    cache.evict({
      id: cache.identify({
        __typename: 'ABCs',
        a: 'ay',
        b: 'bee',
        c: 'see',
      }),
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        data: { abcs: undefined },
        outbound: [{ id: 'ABCs:{"b":"bee","a":"ay","c":"see"}', path: ['abcs'] }],
        type: 0,
      },
    });

    function diff(query: DocumentNode) {
      return cache.diff({
        query,
        optimistic: true,
        returnPartialData: false,
      });
    }

    expect(
      cache.readQuery({
        query: queryWithAliases,
      }),
    ).toBe(null);

    expect(diff(queryWithAliases)).toEqual({
      result: null,
      complete: false,
      missing: new MissingFieldError(
        'Dangling reference to missing ABCs:{"b":"bee","a":"ay","c":"see"} object',
        {
          abcs: 'Dangling reference to missing ABCs:{"b":"bee","a":"ay","c":"see"} object',
        },
        queryWithAliases,
        {},
      ),
    });

    expect(
      cache.readQuery({
        query: queryWithoutAliases,
      }),
    ).toBe(null);

    expect(diff(queryWithoutAliases)).toEqual({
      result: null,
      complete: false,
      missing: new MissingFieldError(
        'Dangling reference to missing ABCs:{"b":"bee","a":"ay","c":"see"} object',
        {
          abcs: 'Dangling reference to missing ABCs:{"b":"bee","a":"ay","c":"see"} object',
        },
        queryWithoutAliases,
        {},
      ),
    });
  });

  it('gracefully handles eviction amid optimistic updates', () => {
    const cache = new Hermes();
    const query = gql`
      query {
        book {
          author {
            name
          }
        }
      }
    `;

    function writeInitialData(cache: ApolloCache) {
      cache.writeQuery({
        query,
        data: {
          book: {
            __typename: 'Book',
            id: 1,
            author: {
              __typename: 'Author',
              id: 2,
              name: 'Geoffrey Chaucer',
            },
          },
        },
      });
    }

    writeInitialData(cache);

    // Writing data in an optimistic transaction to exercise the
    // interaction between eviction and optimistic layers.
    cache.recordOptimisticTransaction(proxy => {
      writeInitialData(proxy);
    }, 'initial transaction');

    // Hermes: references are inbound/outbound edges between nodes.
    const bookAndRootQuery = {
      'Book:1': {
        data: { __typename: 'Book', id: 1, author: undefined },
        inbound: [{ id: 'ROOT_QUERY', path: ['book'] }],
        outbound: [{ id: 'Author:2', path: ['author'] }],
        type: 0,
      },
      ROOT_QUERY: {
        data: { book: undefined },
        outbound: [{ id: 'Book:1', path: ['book'] }],
        type: 0,
      },
    };

    expect(cache.extract(true)).toEqual({
      'Author:2': {
        data: {
          __typename: 'Author',
          id: 2,
          name: 'Geoffrey Chaucer',
        },
        inbound: [{ id: 'Book:1', path: ['author'] }],
        type: 0,
      },
      ...bookAndRootQuery,
    });

    const authorId = cache.identify({
      __typename: 'Author',
      id: 2,
    })!;

    expect(cache.evict({ id: authorId })).toBe(true);

    expect(cache.extract(true)).toEqual(bookAndRootQuery);

    expect(cache.evict({ id: authorId })).toBe(false);

    // Hermes: results may contain a superset of the selected fields (book.id).
    const missing = new MissingFieldError(
      'Dangling reference to missing Author:2 object',
      {
        book: {
          author: 'Dangling reference to missing Author:2 object',
        },
      },
      expect.anything(), // query
      expect.anything(), // variables
    );

    expect(
      cache.diff({
        query,
        optimistic: true,
        returnPartialData: true,
      }),
    ).toMatchObject({
      complete: false,
      missing,
      result: {
        book: {
          __typename: 'Book',
          author: {},
        },
      },
    });

    cache.removeOptimistic('initial transaction');

    // The root layer is exposed again once the optimistic layer is
    // removed, but the Author:2 entity has been evicted from all layers.
    expect(cache.extract(true)).toEqual(bookAndRootQuery);

    expect(
      cache.diff({
        query,
        optimistic: true,
        returnPartialData: true,
      }),
    ).toMatchObject({
      complete: false,
      missing,
      result: {
        book: {
          __typename: 'Book',
          author: {},
        },
      },
    });

    writeInitialData(cache);

    expect(
      cache.diff({
        query,
        optimistic: true,
        returnPartialData: true,
      }),
    ).toMatchObject({
      complete: true,
      result: {
        book: {
          __typename: 'Book',
          author: {
            __typename: 'Author',
            name: 'Geoffrey Chaucer',
          },
        },
      },
    });
  });

  it('supports toReference(obj, true) to persist obj', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            book(_, { args, toReference, readField }) {
              const ref = toReference(
                {
                  __typename: 'Book',
                  isbn: args!.isbn,
                },
                true,
              ) as Reference;

              expect(readField('__typename', ref)).toEqual('Book');
              const isbn = readField<string>('isbn', ref);
              expect(isbn).toEqual(args!.isbn);
              expect(readField('title', ref)).toBe(titlesByISBN.get(isbn!));

              return ref;
            },

            books: {
              merge(existing: Reference[] = [], incoming: any[], { isReference, toReference, readField }) {
                incoming.forEach(book => {
                  expect(isReference(book)).toBe(false);
                  expect(book.__typename).toBeUndefined();
                });

                const refs = incoming.map(
                  book =>
                    toReference(
                      {
                        __typename: 'Book',
                        title: titlesByISBN.get(book.isbn),
                        ...book,
                      },
                      true,
                    ) as Reference,
                );

                refs.forEach((ref, i) => {
                  expect(isReference(ref)).toBe(true);
                  expect(readField('__typename', ref)).toBe('Book');
                  const isbn = readField<string>('isbn', ref);
                  expect(typeof isbn).toBe('string');
                  expect(isbn).toBe(readField('isbn', incoming[i]));
                });

                return [...existing, ...refs];
              },
            },
          },
        },

        Book: {
          keyFields: ['isbn'],
        },
      },
    });

    const booksQuery = gql`
      query {
        books {
          isbn
        }
      }
    `;

    const bookQuery = gql`
      query {
        book(isbn: $isbn) {
          isbn
          title
        }
      }
    `;

    const titlesByISBN = new Map<string, string>([
      ['9781451673319', 'Fahrenheit 451'],
      ['1603589082', 'Eager'],
      ['1760641790', 'How To Do Nothing'],
    ]);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [
          {
            // Note: intentionally omitting __typename:"Book" here.
            isbn: '9781451673319',
          },
          {
            isbn: '1603589082',
          },
        ],
      },
    });

    const twoBookSnapshot = {
      'Book:{"isbn":"1603589082"}': {
        data: {
          __typename: 'Book',
          isbn: '1603589082',
          title: 'Eager',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: ['books', 1],
          },
        ],
        type: 0,
      },
      'Book:{"isbn":"9781451673319"}': {
        data: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: ['books', 0],
          },
        ],
        type: 0,
      },
      ROOT_QUERY: {
        data: {
          books: [undefined, undefined],
        },
        outbound: [
          {
            id: 'Book:{"isbn":"9781451673319"}',
            path: ['books', 0],
          },
          {
            id: 'Book:{"isbn":"1603589082"}',
            path: ['books', 1],
          },
        ],
        type: 0,
      },
    };

    // Check that the __typenames were appropriately added.
    expect(cache.extract()).toEqual(twoBookSnapshot);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [
          {
            isbn: '1760641790',
          },
        ],
      },
    });

    const threeBookSnapshot = {
      ...twoBookSnapshot,
      ROOT_QUERY: {
        ...twoBookSnapshot.ROOT_QUERY,
        data: {
          ...twoBookSnapshot.ROOT_QUERY.data,
          books: [...twoBookSnapshot.ROOT_QUERY.data.books, undefined],
        },
        outbound: [
          ...twoBookSnapshot.ROOT_QUERY.outbound,
          {
            id: 'Book:{"isbn":"1760641790"}',
            path: ['books', 2],
          },
        ],
      },
      'Book:{"isbn":"1760641790"}': {
        data: {
          __typename: 'Book',
          isbn: '1760641790',
          title: 'How To Do Nothing',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: ['books', 2],
          },
        ],
        type: 0,
      },
    };

    expect(cache.extract()).toEqual(threeBookSnapshot);

    const howToDoNothingResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '1760641790',
      },
    });

    expect(howToDoNothingResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '1760641790',
        title: 'How To Do Nothing',
      },
    });

    // Check that reading the query didn't change anything.
    expect(cache.extract()).toEqual(threeBookSnapshot);

    const f451Result = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9781451673319',
      },
    });

    expect(f451Result).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9781451673319',
        title: 'Fahrenheit 451',
      },
    });

    const cuckoosCallingDiffResult = cache.diff({
      query: bookQuery,
      optimistic: true,
      variables: {
        isbn: '031648637X',
      },
    });

    expect(cuckoosCallingDiffResult).toMatchObject({
      complete: false,
      result: {
        book: {
          __typename: 'Book',
          isbn: '031648637X',
        },
      },
      missing: new MissingFieldError(
        'Can\'t find field \'title\' on Book:{"isbn":"031648637X"} object',
        {
          book: {
            title: 'Can\'t find field \'title\' on Book:{"isbn":"031648637X"} object',
          },
        },
        expect.anything(), // query
        expect.anything(), // variables
      ),
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
        },
        type: 0,
      },
    });

    const cuckoosCallingId = cache.identify({
      __typename: 'Book',
      isbn: '031648637X',
    })!;

    expect(cuckoosCallingId).toBe('Book:{"isbn":"031648637X"}');

    cache.writeQuery({
      id: cuckoosCallingId,
      query: gql`
        {
          title
        }
      `,
      data: {
        title: "The Cuckoo's Calling",
      },
    });

    // Hermes: no __META.extraRootIds; Hermes neither retains the id written
    // by writeQuery({ id }) nor serializes retained ids.
    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
          title: "The Cuckoo's Calling",
        },
        type: 0,
      },
    });

    cache.modify({
      id: cuckoosCallingId,
      fields: {
        title(title: string, { isReference, toReference, readField }) {
          const book = {
            __typename: 'Book',
            isbn: readField('isbn'),
            author: 'J.K. Rowling',
          };

          // By not passing true as the second argument to toReference, we
          // get back a Reference object, but the book.author field is not
          // persisted into the store.
          const refWithoutAuthor = toReference(book);
          expect(isReference(refWithoutAuthor)).toBe(true);
          expect(readField('author', refWithoutAuthor as Reference)).toBeUndefined();

          // Update this very Book entity before we modify its title.
          // Passing true for the second argument causes the extra
          // book.author field to be persisted into the store.
          const ref = toReference(book, true);
          expect(isReference(ref)).toBe(true);
          expect(readField('author', ref as Reference)).toBe('J.K. Rowling');

          // In fact, readField doesn't need the ref if we're reading from
          // the same entity that we're modifying.
          expect(readField('author')).toBe('J.K. Rowling');

          // Typography matters!
          return title.split("'").join('’');
        },
      },
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
          title: 'The Cuckoo’s Calling',
          author: 'J.K. Rowling',
        },
        type: 0,
      },
    });
  });

  it('supports toReference(id)', () => {
    const cache = new Hermes({
      typePolicies: {
        Book: {
          fields: {
            favorited(_, { readField, toReference }) {
              const rootQueryRef = toReference('ROOT_QUERY');
              expect(rootQueryRef).toEqual(makeReference('ROOT_QUERY'));
              const favoritedBooks = readField<Reference[]>('favoritedBooks', rootQueryRef);
              return favoritedBooks!.some(bookRef => {
                return readField('isbn') === readField('isbn', bookRef);
              });
            },
          },
          keyFields: ['isbn'],
        },
        Query: {
          fields: {
            book(_, { args, toReference }) {
              const ref = toReference(
                {
                  __typename: 'Book',
                  isbn: args!.isbn,
                  title: titlesByISBN.get(args!.isbn),
                },
                true,
              );

              return ref;
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`
        {
          favoritedBooks {
            isbn
            title
          }
        }
      `,
      data: {
        favoritedBooks: [
          {
            __typename: 'Book',
            isbn: '9781784295547',
            title: 'Shrill',
            author: 'Lindy West',
          },
        ],
      },
    });

    const titlesByISBN = new Map<string, string>([
      ['9780062569714', 'Hunger'],
      ['9781784295547', 'Shrill'],
      ['9780807083109', 'Kindred'],
    ]);

    const bookQuery = gql`
      query {
        book(isbn: $isbn) {
          isbn
          title
          favorited @client
        }
      }
    `;

    const shrillResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9781784295547',
      },
    });

    expect(shrillResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9781784295547',
        title: 'Shrill',
        favorited: true,
      },
    });

    const kindredResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9780807083109',
      },
    });

    expect(kindredResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9780807083109',
        title: 'Kindred',
        favorited: false,
      },
    });
  });

  // Hermes: the final non-optimistic read reuses the result cached for the
  // optimistic read (the optimistic and baseline snapshots are the same), so
  // the read function does not run again; adapted copy in
  // test/unit/vendor/entityStore.ts
  it.skip('should not over-invalidate fields with keyArgs', () => {
    const isbnsWeHaveRead: string[] = [];

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            book: {
              // The presence of this keyArgs configuration permits the
              // cache to track result caching dependencies at the level
              // of individual Books, so writing one Book does not
              // invalidate other Books with different ISBNs. If the cache
              // doesn't know which arguments are "important," it can't
              // make any assumptions about the relationships between
              // field values with the same field name but different
              // arguments, so it has to err on the side of invalidating
              // all Query.book data whenever any Book is written.
              keyArgs: ['isbn'],

              read(book, { args, toReference }) {
                isbnsWeHaveRead.push(args!.isbn);
                return (
                  book ||
                  toReference({
                    __typename: 'Book',
                    isbn: args!.isbn,
                  })
                );
              },
            },
          },
        },

        Book: {
          keyFields: ['isbn'],
        },
      },
    });

    const query = gql`
      query Book($isbn: string) {
        book(isbn: $isbn) {
          title
          isbn
          author {
            name
          }
        }
      }
    `;

    const diffs: Cache.DiffResult<any>[] = [];
    cache.watch({
      query,
      optimistic: true,
      variables: {
        isbn: '1449373321',
      },
      callback(diff) {
        diffs.push(diff);
      },
    });

    const ddiaData = {
      book: {
        __typename: 'Book',
        isbn: '1449373321',
        title: 'Designing Data-Intensive Applications',
        author: {
          __typename: 'Author',
          name: 'Martin Kleppmann',
        },
      },
    };

    expect(isbnsWeHaveRead).toEqual([]);

    cache.writeQuery({
      query,
      variables: {
        isbn: '1449373321',
      },
      data: ddiaData,
    });

    expect(isbnsWeHaveRead).toEqual(['1449373321']);

    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    const theEndData = {
      book: {
        __typename: 'Book',
        isbn: '1982103558',
        title: 'The End of Everything',
        author: {
          __typename: 'Author',
          name: 'Katie Mack',
        },
      },
    };

    cache.writeQuery({
      query,
      variables: {
        isbn: '1982103558',
      },
      data: theEndData,
    });

    // This list does not include the book we just wrote, because the
    // cache.watch we started above only depends on the Query.book field
    // value corresponding to the 1449373321 ISBN.
    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    // Likewise, this list is unchanged, because we did not need to read
    // the 1449373321 Book again after writing the 1982103558 data.
    expect(isbnsWeHaveRead).toEqual(['1449373321']);

    const theEndResult = cache.readQuery({
      query,
      variables: {
        isbn: '1982103558',
      },
      // TODO It's a regrettable accident of history that cache.readQuery is
      // non-optimistic by default. Perhaps the default can be swapped to true
      // in the next major version of Apollo Client.
      optimistic: true,
    });

    expect(theEndResult).toEqual(theEndData);

    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1449373321',
        },
        optimistic: true,
      }),
    ).toBe(diffs[0].result);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1982103558',
        },
        optimistic: true,
      }),
    ).toBe(theEndResult);

    // Still no additional reads, because both books are cached.
    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    // Evicting the 1982103558 Book should not invalidate the 1449373321
    // Book, so diffs and isbnsWeHaveRead should remain unchanged.
    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Book',
          isbn: '1982103558',
        }),
      }),
    ).toBe(true);

    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1449373321',
        },
        // Read this query non-optimistically, to test that the read function
        // runs again, adding "1449373321" again to isbnsWeHaveRead.
        optimistic: false,
      }),
    ).toEqual(diffs[0].result);

    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558', '1449373321']);
  });

  // Hermes: calls InMemoryCache's internal EntityStore.merge (cache.data)
  it.skip('Refuses to merge { __ref } objects as StoreObjects', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            book: {
              keyArgs: ['isbn'],
            },
          },
        },

        Book: {
          keyFields: ['isbn'],
        },
      },
    });

    const store = cache['data'];

    const query = gql`
      query Book($isbn: string) {
        book(isbn: $isbn) {
          title
        }
      }
    `;

    const data = {
      book: {
        __typename: 'Book',
        isbn: '1449373321',
        title: 'Designing Data-Intensive Applications',
      },
    };

    cache.writeQuery({
      query,
      data,
      variables: {
        isbn: data.book.isbn,
      },
    });

    const bookId = cache.identify(data.book)!;

    store.merge(bookId, makeReference(bookId) as StoreValue as StoreObject);

    const snapshot = cache.extract();
    expect(snapshot).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        'book:{"isbn":"1449373321"}': {
          __ref: 'Book:{"isbn":"1449373321"}',
        },
      },
      'Book:{"isbn":"1449373321"}': {
        __typename: 'Book',
        isbn: '1449373321',
        title: 'Designing Data-Intensive Applications',
      },
    });

    store.merge(makeReference(bookId) as StoreValue as StoreObject, bookId);

    expect(cache.extract()).toEqual(snapshot);
  });
});
