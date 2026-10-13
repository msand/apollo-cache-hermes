import { gql } from '@apollo/client';
import type { DocumentNode } from 'graphql';

import { Hermes } from '../../../src';

// A field selected through fragments on different types only has the child
// selections of the fragments that match the type of the object it is read
// from (or written to), like InMemoryCache.
describe(`fields selected under several type conditions`, () => {
  function diff(cache: Hermes, query: DocumentNode, variables?: Record<string, unknown>) {
    return cache.diff<any>({ query, variables, returnPartialData: true, optimistic: false });
  }

  /** The paths of the missing fields of a diff (and the fields they name). */
  function missingFields(cache: Hermes, query: DocumentNode, variables?: Record<string, unknown>) {
    const fields: { [path: string]: string } = {};
    (function visit(tree: unknown, path: string[]) {
      if (typeof tree === 'string') {
        fields[path.join('.')] = /Can't find field '([^']+)'/.exec(tree)?.[1] ?? tree;
      } else if (tree && typeof tree === 'object') {
        for (const key of Object.keys(tree)) visit((tree as any)[key], [...path, key]);
      }
    })(diff(cache, query, variables).missing?.missing, []);
    return fields;
  }

  /** Writes data that lacks selected fields (without logging their absence). */
  function writeIncomplete(cache: Hermes, query: DocumentNode, data: unknown) {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      cache.writeQuery({ query, data });
    } finally {
      error.mockRestore();
    }
  }

  describe(`on a union`, () => {
    const query = gql`
      query {
        search {
          __typename
          ... on Book {
            id
            details {
              pages
            }
          }
          ... on Movie {
            id
            details {
              runtime
            }
          }
        }
      }
    `;
    const data = {
      search: [
        { __typename: 'Book', id: 'b1', details: { pages: 100 } },
        { __typename: 'Movie', id: 'm1', details: { runtime: 90 } },
      ],
    };

    it(`reads the list items of each type with the fields of their fragment`, () => {
      const cache = new Hermes({ possibleTypes: { SearchResult: ['Book', 'Movie'] } });
      cache.writeQuery({ query, data });

      const { result, complete, missing } = diff(cache, query);
      expect(complete).toBe(true);
      expect(missing).toBeUndefined();
      expect(result).toEqual(data);
      expect(cache.readQuery({ query })).toEqual(data);
    });

    it(`writes without missing field errors`, () => {
      const cache = new Hermes();
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        cache.writeQuery({ query, data });
        expect(error).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
      expect(
        cache.readFragment({
          id: 'Book:b1',
          fragment: gql`
            fragment B on Book {
              details {
                pages
              }
            }
          `,
        }),
      ).toMatchObject({
        __typename: 'Book',
        details: { pages: 100 },
      });
    });

    it(`reports the missing fields of each type's own fragments`, () => {
      const cache = new Hermes();
      writeIncomplete(cache, query, {
        search: [
          { __typename: 'Book', id: 'b1', details: {} },
          { __typename: 'Movie', id: 'm1', details: { runtime: 90 } },
        ],
      });

      expect(diff(cache, query).complete).toBe(false);
      expect(missingFields(cache, query)).toEqual({ 'search.0.details.pages': 'pages' });
    });

    it(`applies the fields of all fragments to objects of unknown type`, () => {
      const cache = new Hermes();
      writeIncomplete(cache, query, { search: [{ id: 'x', details: { pages: 1 } }] });

      expect(diff(cache, query).complete).toBe(false);
      // Like InMemoryCache, the `__typename` the query selects is missing too.
      expect(missingFields(cache, query)).toEqual({
        'search.0.__typename': '__typename',
        'search.0.details.runtime': 'runtime',
      });
    });
  });

  describe(`on an interface (with possibleTypes)`, () => {
    const query = gql`
      query {
        node {
          __typename
          id
          ... on Media {
            meta {
              size
            }
          }
          ... on Person {
            meta {
              age
            }
          }
        }
      }
    `;

    function createCache() {
      return new Hermes({ possibleTypes: { Node: ['Media', 'Person'], Media: ['Image', 'Video'] } });
    }

    it(`reads a subtype with the fields of its supertype's fragment`, () => {
      const cache = createCache();
      const data = { node: { __typename: 'Image', id: 'i1', meta: { size: 3 } } };
      cache.writeQuery({ query, data });

      const { result, complete } = diff(cache, query);
      expect(complete).toBe(true);
      expect(result).toEqual(data);
    });

    it(`reports the missing fields of the matching fragments only`, () => {
      const cache = createCache();
      writeIncomplete(cache, query, { node: { __typename: 'Video', id: 'v1', meta: { age: 3 } } });

      expect(diff(cache, query).complete).toBe(false);
      expect(missingFields(cache, query)).toEqual({ 'node.meta.size': 'size' });
    });

    it(`merges the fragments of several matching types`, () => {
      const cache = new Hermes({ possibleTypes: { Media: ['Image'], Thing: ['Image'] } });
      const twoFragments = gql`
        query {
          node {
            __typename
            id
            ... on Media {
              meta {
                size
              }
            }
            ... on Thing {
              meta {
                weight
              }
            }
            ... on Person {
              meta {
                age
              }
            }
          }
        }
      `;
      writeIncomplete(cache, twoFragments, { node: { __typename: 'Image', id: 'i1', meta: { size: 3 } } });

      expect(diff(cache, twoFragments).complete).toBe(false);
      expect(missingFields(cache, twoFragments)).toEqual({ 'node.meta.weight': 'weight' });
    });
  });

  describe(`with nested arrays of mixed types`, () => {
    const query = gql`
      query {
        feed {
          items {
            __typename
            ... on Post {
              blocks {
                __typename
                ... on Text {
                  body
                }
                ... on Image {
                  url
                }
              }
            }
            ... on Poll {
              blocks {
                __typename
                options
              }
            }
          }
        }
      }
    `;
    const data = {
      feed: {
        items: [
          [
            {
              __typename: 'Post',
              blocks: [[{ __typename: 'Text', body: 'hi' }], [{ __typename: 'Image', url: 'a.png' }, null]],
            },
          ],
          [{ __typename: 'Poll', blocks: [[{ __typename: 'Choice', options: ['a', 'b'] }]] }],
        ],
      },
    };

    it(`reads each item with the fields of its own type`, () => {
      const cache = new Hermes();
      cache.writeQuery({ query, data });

      const { result, complete, missing } = diff(cache, query);
      expect(missing).toBeUndefined();
      expect(complete).toBe(true);
      expect(result).toEqual(data);
    });

    it(`reports missing fields by the items' types`, () => {
      const cache = new Hermes();
      writeIncomplete(cache, query, {
        feed: {
          items: [
            [{ __typename: 'Post', blocks: [[{ __typename: 'Image' }]] }],
            [{ __typename: 'Poll', blocks: [[{ __typename: 'Choice' }]] }],
          ],
        },
      });

      expect(diff(cache, query).complete).toBe(false);
      expect(missingFields(cache, query)).toEqual({
        'feed.items.0.0.blocks.0.0.url': 'url',
        'feed.items.1.0.blocks.0.0.options': 'options',
      });
    });
  });

  describe(`with an unconditional selection`, () => {
    const query = gql`
      query {
        thing {
          __typename
          info {
            name
          }
          ... on Special {
            info {
              extra
            }
          }
        }
      }
    `;

    it(`requires the fragment's child fields only for matching types`, () => {
      const cache = new Hermes();
      cache.writeQuery({ query, data: { thing: { __typename: 'Plain', info: { name: 'a' } } } });
      expect(diff(cache, query).complete).toBe(true);

      cache.writeQuery({ query, data: { thing: { __typename: 'Special', info: { name: 'b', extra: 1 } } } });
      expect(diff(cache, query).result).toEqual({
        thing: { __typename: 'Special', info: { name: 'b', extra: 1 } },
      });

      const special = new Hermes();
      writeIncomplete(special, query, { thing: { __typename: 'Special', info: { name: 'c' } } });
      expect(diff(special, query).complete).toBe(false);
      expect(missingFields(special, query)).toEqual({ 'thing.info.extra': 'extra' });
    });
  });

  describe(`with aliases and arguments`, () => {
    const query = gql`
      query {
        search {
          __typename
          id
          ... on Book {
            details {
              size: pages(unit: "words")
            }
          }
          ... on Movie {
            details {
              pages: runtime
            }
          }
        }
      }
    `;

    it(`writes and reads each type's fields`, () => {
      const cache = new Hermes();
      const data = {
        search: [
          { __typename: 'Book', id: 'b1', details: { size: 1000 } },
          { __typename: 'Movie', id: 'm1', details: { pages: 90 } },
        ],
      };
      cache.writeQuery({ query, data });

      const stored = gql`
        query {
          search {
            ... on Book {
              details {
                pages(unit: "words")
              }
            }
            ... on Movie {
              details {
                runtime
              }
            }
          }
        }
      `;
      expect(cache.readQuery({ query: stored })).toEqual({
        search: [
          { __typename: 'Book', id: 'b1', details: { pages: 1000 } },
          { __typename: 'Movie', id: 'm1', details: { runtime: 90 } },
        ],
      });
      const { result, complete } = diff(cache, query);
      expect(complete).toBe(true);
      // (Reads return a superset of the selected fields.)
      expect(result).toMatchObject(data);
    });
  });

  describe(`with @include`, () => {
    const query = gql`
      query ($withExtra: Boolean!) {
        thing {
          info @include(if: $withExtra) {
            extra
          }
          info {
            name
          }
        }
      }
    `;

    it(`only requires the child fields of included selections`, () => {
      const cache = new Hermes();
      cache.writeQuery({ query, variables: { withExtra: false }, data: { thing: { info: { name: 'a' } } } });

      const { result, complete } = diff(cache, query, { withExtra: false });
      expect(complete).toBe(true);
      expect(result).toEqual({ thing: { info: { name: 'a' } } });
      expect(diff(cache, query, { withExtra: true }).complete).toBe(false);
    });
  });
});
