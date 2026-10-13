import { gql } from 'graphql-tag';
import { assign, omit } from 'lodash';
import type { Cache, Reference, StoreObject, TypedDocumentNode } from '@apollo/client';
import { isReference } from '@apollo/client';
import { MissingFieldError } from '@apollo/client/cache';
import { makeReference } from '@apollo/client/utilities/internal';

import { Hermes } from '../../../../../src';
import { toNormalizedCacheObject } from '../../../../helpers';

import { defaultNormalizedCacheFactory, HermesReader, readQueryFromStore, withError } from './helpers';

// Hermes: the resultCacheMaxSize tests check InMemoryCache's StoreReader
// (its executeSelectionSet result cache), which Hermes does not have.

// Hermes: InMemoryCache's StoreReader is replaced by reads (cache.diff) of
// Hermes caches; see ./helpers.
describe('reading from the store', () => {
  const reader = new HermesReader();

  // Hermes: a field selected under several type conditions has its selection
  // sets merged, so innerArray's otherField (only selected `... on DummyQuery`)
  // is required on the untyped innerArray items.
  it.skip('runs a nested query with proper fragment fields in arrays', () => {
    withError(() => {
      const store = defaultNormalizedCacheFactory({
        ROOT_QUERY: {
          __typename: 'Query',
          nestedObj: makeReference('abcde'),
        } as StoreObject,
        abcde: {
          id: 'abcde',
          innerArray: [
            {
              id: 'abcdef',
              someField: 3,
            },
          ],
        } as StoreObject,
      });

      const queryResult = readQueryFromStore(reader, {
        store,
        query: gql`
          {
            ... on DummyQuery {
              nestedObj {
                innerArray {
                  id
                  otherField
                }
              }
            }
            ... on Query {
              nestedObj {
                innerArray {
                  id
                  someField
                }
              }
            }
            ... on DummyQuery2 {
              nestedObj {
                innerArray {
                  id
                  otherField2
                }
              }
            }
          }
        `,
      });
      // Hermes: reads return a superset of the selected fields.
      expect(queryResult).toMatchObject({
        nestedObj: {
          innerArray: [{ id: 'abcdef', someField: 3 }],
        },
      });
    });
  });

  it('rejects malformed queries', () => {
    expect(() => {
      readQueryFromStore(reader, {
        store: defaultNormalizedCacheFactory(),
        query: gql`
          query {
            name
          }

          query {
            address
          }
        `,
      });
    }).toThrow(/2 operations/);

    // Hermes: Hermes' own error for a document without an operation.
    expect(() => {
      readQueryFromStore(reader, {
        store: defaultNormalizedCacheFactory(),
        query: gql`
          fragment x on y {
            name
          }
        `,
      });
    }).toThrow(/missing an operation/);
  });

  it('runs a basic query', () => {
    const result = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    } as StoreObject;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        query {
          stringField
          numberField
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: result['stringField'],
      numberField: result['numberField'],
    });
  });

  // Hermes: the store is seeded with InMemoryCache storeFieldNames for
  // parameterized fields (e.g. 'field({"arg":...})'), which Hermes stores as
  // parameterized value nodes instead.
  it.skip('runs a basic query with arguments', () => {
    const query = gql`
      query {
        id
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        nullField
      }
    `;

    const variables = {
      intArg: 5,
      floatArg: 3.14,
      stringArg: 'This is a string!',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":5})': 5,
        'stringField({"arg":"This is a string!"})': 'Heyo',
      },
    });

    const result = readQueryFromStore(reader, {
      store,
      query,
      variables,
    });
    // Hermes: reads return a superset of the selected fields.
    expect(result).toMatchObject({
      id: 'abcd',
      nullField: null,
      numberField: 5,
      stringField: 'Heyo',
    });
  });

  // Hermes: the store is seeded with InMemoryCache storeFieldNames for
  // fields with directives (e.g. 'lastName@upperCase'), which Hermes stores as
  // parameterized value nodes instead.
  it.skip('runs a basic query with custom directives', () => {
    const query = gql`
      query {
        id
        firstName @include(if: true)
        lastName @upperCase
        birthDate @dateFormat(format: "DD-MM-YYYY")
      }
    `;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        firstName: 'James',
        'lastName@upperCase': 'BOND',
        'birthDate@dateFormat({"format":"DD-MM-YYYY"})': '20-05-1940',
      },
    });

    const result = readQueryFromStore(reader, {
      store,
      query,
    });
    // Hermes: reads return a superset of the selected fields.
    expect(result).toMatchObject({
      id: 'abcd',
      firstName: 'James',
      lastName: 'BOND',
      birthDate: '20-05-1940',
    });
  });

  // Hermes: the store is seeded with InMemoryCache storeFieldNames for
  // parameterized fields (e.g. 'field({"arg":...})'), which Hermes stores as
  // parameterized value nodes instead.
  it.skip('runs a basic query with default values for arguments', () => {
    const query = gql`
      query someBigQuery($stringArg: String = "This is a default string!", $intArg: Int = 0, $floatArg: Float) {
        id
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        nullField
      }
    `;

    const variables = {
      floatArg: 3.14,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":0})': 5,
        'stringField({"arg":"This is a default string!"})': 'Heyo',
      },
    });

    const result = readQueryFromStore(reader, {
      store,
      query,
      variables,
    });
    // Hermes: reads return a superset of the selected fields.
    expect(result).toMatchObject({
      id: 'abcd',
      nullField: null,
      numberField: 5,
      stringField: 'Heyo',
    });
  });

  it('applies defaults when variable is explicitly undefined', () => {
    const query = gql`
      query someQuery($show: Boolean = false) {
        id
        field @include(if: $show)
      }
    `;

    const variables = {
      show: undefined,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        __typename: 'Query',
        id: 'abcd',
      } as StoreObject,
    });

    const result = readQueryFromStore(reader, {
      store,
      query,
      variables,
    });
    // Hermes: reads return a superset of the selected fields.
    expect(result).toMatchObject({
      id: 'abcd',
    });
  });

  it('applies defaults when variables are omitted entirely', () => {
    const query = gql`
      query someQuery($show: Boolean = false) {
        id
        field @include(if: $show)
      }
    `;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        __typename: 'Query',
        id: 'abcd',
      } as StoreObject,
    });

    const result = readQueryFromStore(reader, {
      store,
      query,
    });
    // Hermes: reads return a superset of the selected fields.
    expect(result).toMatchObject({
      id: 'abcd',
    });
  });

  it('runs a nested query', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedObj')), {
        nestedObj: makeReference('abcde'),
      } as StoreObject),
      abcde: result.nestedObj,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedObj {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
      },
    });
  });

  it('runs a nested query with multiple fragments', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      } as StoreObject,
      nullObject: null,
      __typename: 'Item',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedObj', 'deepNestedObj')), {
        __typename: 'Query',
        nestedObj: makeReference('abcde'),
      } as StoreObject),
      abcde: assign({}, result.nestedObj, {
        deepNestedObj: makeReference('abcdef'),
      }) as StoreObject,
      abcdef: result.deepNestedObj as StoreObject,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nullField
          ... on Query {
            nestedObj {
              stringField
              nullField
              deepNestedObj {
                stringField
                nullField
              }
            }
          }
          ... on Query {
            nestedObj {
              numberField
              nullField
              deepNestedObj {
                numberField
                nullField
              }
            }
          }
          ... on Query {
            nullObject
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
        deepNestedObj: {
          stringField: 'This is a deep string',
          numberField: 7,
          nullField: null,
        },
      },
      nullObject: null,
    });
  });

  it('runs a nested query with an array without IDs', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        {
          stringField: 'This is a string too!',
          numberField: 6,
          nullField: null,
        },
        {
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        {
          stringField: 'This is a string too!',
          numberField: 6,
        },
        {
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  it('runs a nested query with an array without IDs and a null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        null,
        {
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        null,
        {
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  it('runs a nested query with an array with IDs and a null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        null,
        {
          id: 'abcde',
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedArray')), {
        nestedArray: [null, makeReference('abcde')],
      }) as StoreObject,
      abcde: result.nestedArray[1],
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            id
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        null,
        {
          id: 'abcde',
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  // Hermes: checks the size of InMemoryCache's StoreReader result cache
  // (executeSubSelectedArray), an InMemoryCache internal.
  it.skip('runs a nested query - skips iterating into an empty array', () => {
    const reader = new HermesReader() as any;

    const result = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        {
          id: 'abcde',
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ],
      emptyArray: [],
    } satisfies StoreObject;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: { ...result, nestedArray: [makeReference('abcde')] },
      abcde: result.nestedArray[0],
    });

    expect(reader['executeSubSelectedArray'].size).toBe(0);

    // assumption: cache size does not increase for empty array
    readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          emptyArray {
            id
            stringField
            numberField
          }
        }
      `,
    });
    expect(reader['executeSubSelectedArray'].size).toBe(0);

    // assumption: cache size increases for array with content
    readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            id
            stringField
            numberField
          }
        }
      `,
    });
    expect(reader['executeSubSelectedArray'].size).toBe(1);
  });

  it('returns null on a missing field', () => {
    const result = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    } as StoreObject;

    const store = defaultNormalizedCacheFactory({ ROOT_QUERY: result });

    const cacheResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          missingField
        }
      `,
    });

    expect(cacheResult).toBeNull();
  });

  it('readQuery supports returnPartialData', () => {
    const cache = new Hermes();
    const aQuery = gql`
      query {
        a
      }
    `;
    const bQuery = gql`
      query {
        b
      }
    `;
    const abQuery = gql`
      query {
        a
        b
      }
    `;

    cache.writeQuery({
      query: aQuery,
      data: { a: 123 },
    });

    expect(cache.readQuery({ query: bQuery })).toBe(null);
    expect(cache.readQuery({ query: abQuery })).toBe(null);

    // Hermes: reads return a superset of the selected fields (by design), so
    // the partial result includes the stored (but unselected) field a.
    expect(
      cache.readQuery({
        query: bQuery,
        returnPartialData: true,
      }),
    ).toEqual({ a: 123 });

    expect(
      cache.readQuery({
        query: abQuery,
        returnPartialData: true,
      }),
    ).toEqual({ a: 123 });
  });

  // Hermes: reads return a superset of the selected fields (by design)
  it.skip('readFragment supports returnPartialData', () => {
    const cache = new Hermes();
    const id = cache.identify({
      __typename: 'ABObject',
      id: 321,
    });

    const aFragment = gql`
      fragment AFragment on ABObject {
        a
      }
    `;
    const bFragment = gql`
      fragment BFragment on ABObject {
        b
      }
    `;
    const abFragment = gql`
      fragment ABFragment on ABObject {
        a
        b
      }
    `;

    expect(cache.readFragment({ id, fragment: aFragment })).toBe(null);
    expect(cache.readFragment({ id, fragment: bFragment })).toBe(null);
    expect(cache.readFragment({ id, fragment: abFragment })).toBe(null);

    const ref = cache.writeFragment({
      id,
      fragment: aFragment,
      data: {
        __typename: 'ABObject',
        a: 123,
      },
    });
    expect(isReference(ref)).toBe(true);
    expect(ref!.__ref).toBe(id);

    expect(
      cache.readFragment({
        id,
        fragment: bFragment,
      }),
    ).toBe(null);

    expect(
      cache.readFragment({
        id,
        fragment: abFragment,
      }),
    ).toBe(null);

    expect(
      cache.readFragment({
        id,
        fragment: bFragment,
        returnPartialData: true,
      }),
    ).toEqual({
      __typename: 'ABObject',
    });

    expect(
      cache.readFragment({
        id,
        fragment: abFragment,
        returnPartialData: true,
      }),
    ).toEqual({
      __typename: 'ABObject',
      a: 123,
    });
  });

  it('distinguishes between missing @client and non-@client fields', () => {
    const query = gql`
      query {
        normal {
          present @client
          missing
        }
        clientOnly @client {
          present
          missing
        }
      }
    `;

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            normal() {
              return { present: 'here' };
            },
            clientOnly() {
              return { present: 'also here' };
            },
          },
        },
      },
    });

    const { result, complete, missing } = cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
    });

    expect(complete).toBe(false);

    expect(result).toEqual({
      normal: {
        present: 'here',
      },
      clientOnly: {
        present: 'also here',
      },
    });

    expect(missing).toEqual(
      new MissingFieldError(
        `Can't find field 'missing' on object ${JSON.stringify(
          {
            present: 'here',
          },
          null,
          2,
        )}`,
        {
          normal: {
            missing: `Can't find field 'missing' on object ${JSON.stringify({ present: 'here' }, null, 2)}`,
          },
          clientOnly: {
            missing: `Can't find field 'missing' on object ${JSON.stringify({ present: 'also here' }, null, 2)}`,
          },
        },
        query,
        {}, // variables
      ),
    );
  });

  it('runs a nested query where the reference is null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: null,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedObj')), {
        nestedObj: null,
      }) as StoreObject,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          nestedObj {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      nestedObj: null,
    });
  });

  it('runs an array of non-objects', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: ['one', 'two', 'three'],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          simpleArray
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      simpleArray: ['one', 'two', 'three'],
    });
  });

  it('runs an array of non-objects with null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: [null, 'two', 'three'],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          stringField
          numberField
          simpleArray
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    // Hermes: reads return a superset of the selected fields.
    expect(queryResult).toMatchObject({
      stringField: 'This is a string!',
      numberField: 5,
      simpleArray: [null, 'two', 'three'],
    });
  });

  it('will read from an arbitrary root id', () => {
    const data: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      } as StoreObject,
      nullObject: null,
      __typename: 'Item',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(data, 'nestedObj', 'deepNestedObj')), {
        __typename: 'Query',
        nestedObj: makeReference('abcde'),
      }) as StoreObject,
      abcde: assign({}, data.nestedObj, {
        deepNestedObj: makeReference('abcdef'),
      }) as StoreObject,
      abcdef: data.deepNestedObj as StoreObject,
    });

    const queryResult1 = readQueryFromStore(reader, {
      store,
      rootId: 'abcde',
      query: gql`
        {
          stringField
          numberField
          nullField
          deepNestedObj {
            stringField
            numberField
            nullField
          }
        }
      `,
    });

    // Hermes: reads return a superset of the selected fields.
    expect(queryResult1).toMatchObject({
      stringField: 'This is a string too!',
      numberField: 6,
      nullField: null,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      },
    });

    const queryResult2 = readQueryFromStore(reader, {
      store,
      rootId: 'abcdef',
      query: gql`
        {
          stringField
          numberField
          nullField
        }
      `,
    });

    expect(queryResult2).toMatchObject({
      stringField: 'This is a deep string',
      numberField: 7,
      nullField: null,
    });
  });

  it('properly handles the @connection directive', () => {
    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        'books:abc': [
          {
            name: 'efgh',
          },
        ],
      },
    });

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          books(skip: 0, limit: 2) @connection(key: "abc") {
            name
          }
        }
      `,
    });
    expect(queryResult).toEqual({
      books: [
        {
          name: 'efgh',
        },
      ],
    });
  });

  it('can use keyArgs function instead of @connection directive', () => {
    const store = defaultNormalizedCacheFactory(
      {
        ROOT_QUERY: {
          'books:abc': [
            {
              name: 'efgh',
            },
          ],
        },
      },
      {
        typePolicies: {
          Query: {
            fields: {
              books: {
                // Even though we're returning an arbitrary string here,
                // the InMemoryCache will ensure the actual key begins
                // with "books".
                keyArgs: () => 'abc',
              },
            },
          },
        },
      },
    );

    const queryResult = readQueryFromStore(reader, {
      store,
      query: gql`
        {
          books(skip: 0, limit: 2) {
            name
          }
        }
      `,
    });
    expect(queryResult).toEqual({
      books: [
        {
          name: 'efgh',
        },
      ],
    });
  });

  it('refuses to return raw Reference objects', () => {
    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        author: {
          __typename: 'Author',
          name: 'Toni Morrison',
          books: [
            {
              title: 'The Bluest Eye',
              publisher: makeReference('Publisher1'),
            },
            {
              title: 'Song of Solomon',
              publisher: makeReference('Publisher2'),
            },
            {
              title: 'Beloved',
              publisher: makeReference('Publisher2'),
            },
          ],
        },
      },
      Publisher1: {
        __typename: 'Publisher',
        id: 1,
        name: 'Holt, Rinehart and Winston',
      },
      Publisher2: {
        __typename: 'Publisher',
        id: 2,
        name: 'Alfred A. Knopf, Inc.',
      },
    });

    expect(() => {
      readQueryFromStore(reader, {
        store,
        query: gql`
          {
            author {
              name
              books
            }
          }
        `,
      });
    }).toThrow(/Missing selection set for object of type Publisher returned for query field books/);

    expect(
      readQueryFromStore(reader, {
        store,
        query: gql`
          {
            author {
              name
              books {
                title
                publisher {
                  name
                }
              }
            }
          }
        `,
      }),
      // Hermes: results may contain a superset of the selected fields.
    ).toMatchObject({
      author: {
        __typename: 'Author',
        name: 'Toni Morrison',
        books: [
          {
            title: 'The Bluest Eye',
            publisher: {
              __typename: 'Publisher',
              name: 'Holt, Rinehart and Winston',
            },
          },
          {
            title: 'Song of Solomon',
            publisher: {
              __typename: 'Publisher',
              name: 'Alfred A. Knopf, Inc.',
            },
          },
          {
            title: 'Beloved',
            publisher: {
              __typename: 'Publisher',
              name: 'Alfred A. Knopf, Inc.',
            },
          },
        ],
      },
    });
  });

  it('read functions for root query fields work with empty cache', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            uuid() {
              return '8d573b9c-cfcf-4e3e-98dd-14d255af577e';
            },
            null() {
              return null;
            },
          },
        },
      },
    });

    expect(
      cache.readQuery({
        query: gql`
          query {
            uuid
            null
          }
        `,
      }),
    ).toEqual({
      uuid: '8d573b9c-cfcf-4e3e-98dd-14d255af577e',
      null: null,
    });

    expect(cache.extract()).toEqual({});

    expect(
      cache.readFragment({
        id: 'ROOT_QUERY',
        fragment: gql`
          fragment UUIDFragment on Query {
            null
            uuid
          }
        `,
      }),
    ).toMatchObject({
      uuid: '8d573b9c-cfcf-4e3e-98dd-14d255af577e',
      null: null,
    });

    expect(cache.extract()).toEqual({});

    expect(
      cache.readFragment({
        id: 'does not exist',
        fragment: gql`
          fragment F on Never {
            whatever
          }
        `,
      }),
    ).toBe(null);

    expect(cache.extract()).toEqual({});
  });

  it('custom read functions can map/filter dangling references', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            ducks(existing: Reference[] = [], { canRead }) {
              return existing.map(duck => (canRead(duck) ? duck : null));
            },
            chickens(existing: Reference[] = [], { canRead }) {
              return existing.map(chicken => (canRead(chicken) ? chicken : {}));
            },
            oxen(existing: Reference[] = [], { canRead }) {
              return existing.filter(canRead);
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`
        query {
          ducks {
            quacking
          }
          chickens {
            inCoop
          }
          oxen {
            gee
            haw
          }
        }
      `,
      data: {
        ducks: [
          { __typename: 'Duck', id: 1, quacking: true },
          { __typename: 'Duck', id: 2, quacking: false },
          { __typename: 'Duck', id: 3, quacking: false },
        ],
        chickens: [
          { __typename: 'Chicken', id: 1, inCoop: true },
          { __typename: 'Chicken', id: 2, inCoop: true },
          { __typename: 'Chicken', id: 3, inCoop: false },
        ],
        oxen: [
          { __typename: 'Ox', id: 1, gee: true, haw: false },
          { __typename: 'Ox', id: 2, gee: false, haw: true },
        ],
      },
    });

    // Hermes: references are stored as outbound/inbound edges rather than { __ref } objects.
    expect(cache.extract()).toEqual({
      'Chicken:1': {
        type: 0,
        data: { __typename: 'Chicken', id: 1, inCoop: true },
        inbound: [{ id: 'ROOT_QUERY', path: ['chickens', 0] }],
      },
      'Chicken:2': {
        type: 0,
        data: { __typename: 'Chicken', id: 2, inCoop: true },
        inbound: [{ id: 'ROOT_QUERY', path: ['chickens', 1] }],
      },
      'Chicken:3': {
        type: 0,
        data: { __typename: 'Chicken', id: 3, inCoop: false },
        inbound: [{ id: 'ROOT_QUERY', path: ['chickens', 2] }],
      },
      'Duck:1': {
        type: 0,
        data: { __typename: 'Duck', id: 1, quacking: true },
        inbound: [{ id: 'ROOT_QUERY', path: ['ducks', 0] }],
      },
      'Duck:2': {
        type: 0,
        data: { __typename: 'Duck', id: 2, quacking: false },
        inbound: [{ id: 'ROOT_QUERY', path: ['ducks', 1] }],
      },
      'Duck:3': {
        type: 0,
        data: { __typename: 'Duck', id: 3, quacking: false },
        inbound: [{ id: 'ROOT_QUERY', path: ['ducks', 2] }],
      },
      'Ox:1': {
        type: 0,
        data: { __typename: 'Ox', id: 1, gee: true, haw: false },
        inbound: [{ id: 'ROOT_QUERY', path: ['oxen', 0] }],
      },
      'Ox:2': {
        type: 0,
        data: { __typename: 'Ox', id: 2, gee: false, haw: true },
        inbound: [{ id: 'ROOT_QUERY', path: ['oxen', 1] }],
      },
      ROOT_QUERY: {
        type: 0,
        data: {
          chickens: [undefined, undefined, undefined],
          ducks: [undefined, undefined, undefined],
          oxen: [undefined, undefined],
        },
        outbound: [
          { id: 'Duck:1', path: ['ducks', 0] },
          { id: 'Duck:2', path: ['ducks', 1] },
          { id: 'Duck:3', path: ['ducks', 2] },
          { id: 'Chicken:1', path: ['chickens', 0] },
          { id: 'Chicken:2', path: ['chickens', 1] },
          { id: 'Chicken:3', path: ['chickens', 2] },
          { id: 'Ox:1', path: ['oxen', 0] },
          { id: 'Ox:2', path: ['oxen', 1] },
        ],
      },
    });

    function diffChickens() {
      return cache.diff({
        query: gql`
          query {
            chickens {
              id
              inCoop
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffChickens()).toMatchObject({
      complete: true,
      result: {
        chickens: [
          { __typename: 'Chicken', id: 1, inCoop: true },
          { __typename: 'Chicken', id: 2, inCoop: true },
          { __typename: 'Chicken', id: 3, inCoop: false },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Chicken',
          id: 2,
        }),
      }),
    ).toBe(true);

    expect(diffChickens()).toMatchObject({
      complete: false,
      missing: new MissingFieldError(
        "Can't find field 'id' on object {}",
        {
          chickens: {
            1: {
              id: "Can't find field 'id' on object {}",
              inCoop: "Can't find field 'inCoop' on object {}",
            },
          },
        },
        expect.anything(), // query
        expect.anything(), // variables
      ),

      result: {
        chickens: [{ __typename: 'Chicken', id: 1, inCoop: true }, {}, { __typename: 'Chicken', id: 3, inCoop: false }],
      },
    });

    function diffDucks() {
      return cache.diff({
        query: gql`
          query {
            ducks {
              id
              quacking
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffDucks()).toMatchObject({
      complete: true,
      result: {
        ducks: [
          { __typename: 'Duck', id: 1, quacking: true },
          { __typename: 'Duck', id: 2, quacking: false },
          { __typename: 'Duck', id: 3, quacking: false },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Duck',
          id: 3,
        }),
      }),
    ).toBe(true);

    // Returning null as a placeholder in a list is a way to indicate that
    // a list element has been removed, without causing an incomplete
    // diff, and without altering the positions of later elements.
    expect(diffDucks()).toMatchObject({
      complete: true,
      result: {
        ducks: [{ __typename: 'Duck', id: 1, quacking: true }, { __typename: 'Duck', id: 2, quacking: false }, null],
      },
    });

    function diffOxen() {
      return cache.diff({
        query: gql`
          query {
            oxen {
              id
              gee
              haw
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffOxen()).toMatchObject({
      complete: true,
      result: {
        oxen: [
          { __typename: 'Ox', id: 1, gee: true, haw: false },
          { __typename: 'Ox', id: 2, gee: false, haw: true },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Ox',
          id: 1,
        }),
      }),
    ).toBe(true);

    expect(diffOxen()).toMatchObject({
      complete: true,
      result: {
        oxen: [{ __typename: 'Ox', id: 2, gee: false, haw: true }],
      },
    });
  });

  it('does not filter explicit undefined items in array returned from read function', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            ducks(existing: Reference[] = [], { canRead }) {
              return existing.map(duck => (canRead(duck) ? duck : undefined));
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`
        query {
          ducks {
            quacking
          }
        }
      `,
      data: {
        ducks: [
          { __typename: 'Duck', id: 1, quacking: true },
          { __typename: 'Duck', id: 2, quacking: false },
          { __typename: 'Duck', id: 3, quacking: false },
        ],
      },
    });

    // Hermes: compare in InMemoryCache's normalized shape.
    expect(toNormalizedCacheObject(cache.extract())).toEqual({
      'Duck:1': {
        __typename: 'Duck',
        id: 1,
        quacking: true,
      },
      'Duck:2': {
        __typename: 'Duck',
        id: 2,
        quacking: false,
      },
      'Duck:3': {
        __typename: 'Duck',
        id: 3,
        quacking: false,
      },
      ROOT_QUERY: {
        __typename: 'Query',
        ducks: [{ __ref: 'Duck:1' }, { __ref: 'Duck:2' }, { __ref: 'Duck:3' }],
      },
    });

    function diffDucks() {
      return cache.diff({
        query: gql`
          query {
            ducks {
              id
              quacking
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffDucks()).toEqual({
      complete: true,
      result: {
        ducks: [
          { __typename: 'Duck', id: 1, quacking: true },
          { __typename: 'Duck', id: 2, quacking: false },
          { __typename: 'Duck', id: 3, quacking: false },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Duck',
          id: 3,
        }),
      }),
    ).toBe(true);

    expect(diffDucks()).toEqual({
      complete: false,
      result: {
        ducks: [{ __typename: 'Duck', id: 1, quacking: true }, { __typename: 'Duck', id: 2, quacking: false }, {}],
      },
      missing: new MissingFieldError(
        "Can't find field 'id' on object {}",
        {
          ducks: {
            2: {
              id: "Can't find field 'id' on object {}",
              quacking: "Can't find field 'quacking' on object {}",
            },
          },
        },
        expect.anything(), // query
        expect.anything(), // variables
      ),
    });
  });

  it('propagates eviction signals to parent queries', () => {
    const cache = new Hermes({
      // canonizeResults: true,
      typePolicies: {
        Deity: {
          keyFields: ['name'],
          fields: {
            children(offspring: Reference[], { canRead }) {
              // Automatically filter out any dangling references, and
              // supply a default empty array if !offspring.
              return offspring ? offspring.filter(canRead) : [];
            },
          },
        },

        Query: {
          fields: {
            ruler(ruler, { canRead, toReference }) {
              // If the throne is empty, promote Apollo!
              return canRead(ruler)
                ? ruler
                : toReference({
                    __typename: 'Deity',
                    name: 'Apollo',
                  });
            },
          },
        },
      },
    });

    const rulerQuery = gql`
      query {
        ruler {
          name
          children {
            name
            children {
              name
            }
          }
        }
      }
    `;

    const children = [
      // Sons #1 and #2 don't have names because Cronus (l.k.a. Saturn)
      // devoured them shortly after birth, as famously painted by
      // Francisco Goya:
      'Son #1',
      'Hera',
      'Son #2',
      'Zeus',
      'Demeter',
      'Hades',
      'Poseidon',
      'Hestia',
    ].map(name => ({
      __typename: 'Deity',
      name,
      children: [],
    }));

    cache.writeQuery({
      query: rulerQuery,
      data: {
        ruler: {
          __typename: 'Deity',
          name: 'Cronus',
          children,
        },
      },
    });

    const diffs: Cache.DiffResult<any>[] = [];

    function watch(immediate = true) {
      return cache.watch({
        query: rulerQuery,
        immediate,
        optimistic: true,
        callback(diff) {
          // Hermes: watch callbacks also receive internal entityIds/dynamicNodeIds bookkeeping.
          const { entityIds, dynamicNodeIds, ...rest } = diff as any;
          diffs.push(rest);
        },
      });
    }

    const cancel = watch();

    function devour(name: string) {
      return cache.evict({
        id: cache.identify({ __typename: 'Deity', name }),
      });
    }

    const initialDiff = {
      result: {
        ruler: {
          __typename: 'Deity',
          name: 'Cronus',
          children,
        },
      },
      complete: true,
    };

    // We already have one diff because of the immediate:true above.
    expect(diffs).toEqual([initialDiff]);

    expect(devour('Son #1')).toBe(true);

    const childrenWithoutSon1 = children.filter(child => child.name !== 'Son #1');

    expect(childrenWithoutSon1.length).toBe(children.length - 1);

    const diffWithoutSon1 = {
      result: {
        ruler: {
          name: 'Cronus',
          __typename: 'Deity',
          children: childrenWithoutSon1,
        },
      },
      complete: true,
    };

    expect(diffs).toEqual([initialDiff, diffWithoutSon1]);

    expect(devour('Son #1')).toBe(false);

    expect(diffs).toEqual([initialDiff, diffWithoutSon1]);

    expect(devour('Son #2')).toBe(true);

    const diffWithoutDevouredSons = {
      result: {
        ruler: {
          name: 'Cronus',
          __typename: 'Deity',
          children: childrenWithoutSon1.filter(child => {
            return child.name !== 'Son #2';
          }),
        },
      },
      complete: true,
    };

    expect(diffs).toEqual([initialDiff, diffWithoutSon1, diffWithoutDevouredSons]);

    const childrenOfZeus = [
      'Ares',
      'Artemis',
      // Fun fact: Apollo is the only major Greco-Roman deity whose name
      // is the same in both traditions.
      'Apollo',
      'Athena',
    ].map(name => ({
      __typename: 'Deity',
      name,
      children: [],
    }));

    const zeusRef = cache.writeFragment({
      id: cache.identify({
        __typename: 'Deity',
        name: 'Zeus',
      }),
      fragment: gql`
        fragment Offspring on Deity {
          children {
            name
          }
        }
      `,
      data: {
        children: childrenOfZeus,
      },
    });

    expect(isReference(zeusRef)).toBe(true);
    expect(zeusRef!.__ref).toBe('Deity:{"name":"Zeus"}');

    const diffWithChildrenOfZeus = {
      complete: true,
      result: {
        ...diffWithoutDevouredSons.result,
        ruler: {
          ...diffWithoutDevouredSons.result.ruler,
          children: diffWithoutDevouredSons.result.ruler.children.map(child => {
            return child.name === 'Zeus'
              ? {
                  ...child,
                  children: childrenOfZeus
                    // Remove empty child.children arrays.
                    .map(({ children, ...child }) => child),
                }
              : child;
          }),
        },
      },
    };

    expect(diffs).toMatchObject([initialDiff, diffWithoutSon1, diffWithoutDevouredSons, diffWithChildrenOfZeus]);

    // Zeus usurps the throne from Cronus!
    cache.writeQuery({
      query: rulerQuery,
      data: {
        ruler: {
          __typename: 'Deity',
          name: 'Zeus',
        },
      },
    });

    const diffWithZeusAsRuler = {
      complete: true,
      result: {
        ruler: {
          __typename: 'Deity',
          name: 'Zeus',
          children: childrenOfZeus,
        },
      },
    };

    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    // Hermes: Cronus and his children were deleted as soon as Zeus replaced
    // him as ruler (Hermes deletes orphaned entities right away, rather than
    // in gc()), so there is nothing left to collect. InMemoryCache collects
    // Cronus, Demeter, Hades, Hera, Hestia and Poseidon here.
    expect(cache.gc().sort()).toEqual([]);

    // Hermes: references are stored as outbound/inbound edges rather than
    // { __ref } objects, and extract() has no __META.extraRootIds (Hermes
    // does not serialize retained ids).
    const deityId = (name: string) => `Deity:{"name":"${name}"}`;
    const childOfZeus = (name: string, index: number) => ({
      data: { __typename: 'Deity', children: [], name },
      inbound: [{ id: deityId('Zeus'), path: ['children', index] }],
      type: 0,
    });
    const rootQueryNode = (rulerName: string) => ({
      data: { ruler: undefined },
      outbound: [{ id: deityId(rulerName), path: ['ruler'] }],
      type: 0,
    });
    const zeusNode = {
      data: {
        __typename: 'Deity',
        children: [undefined, undefined, undefined, undefined],
        name: 'Zeus',
      },
      inbound: [{ id: 'ROOT_QUERY', path: ['ruler'] }],
      outbound: ['Ares', 'Artemis', 'Apollo', 'Athena'].map((name, index) => ({
        id: deityId(name),
        path: ['children', index],
      })),
      type: 0,
    };

    const snapshotAfterGC = {
      ROOT_QUERY: rootQueryNode('Zeus'),
      [deityId('Zeus')]: zeusNode,
      [deityId('Ares')]: childOfZeus('Ares', 0),
      [deityId('Artemis')]: childOfZeus('Artemis', 1),
      [deityId('Apollo')]: childOfZeus('Apollo', 2),
      [deityId('Athena')]: childOfZeus('Athena', 3),
    };

    expect(cache.extract()).toEqual(snapshotAfterGC);

    // There should be no diff generated by garbage collection.
    // Hermes: results may contain a superset of the selected fields (here,
    // the stored children of Zeus's children).
    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    cancel();

    const lastDiff = diffs[diffs.length - 1];

    expect(
      cache.readQuery({
        query: rulerQuery,
      }),
    ).toEqual(lastDiff.result);

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Deity',
          name: 'Ares',
        }),
      }),
    ).toBe(true);

    // No new diff generated since we called cancel() above.
    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    // Zeus keeps a dangling reference to the evicted Ares.
    const snapshotWithoutAres = { ...snapshotAfterGC };
    delete (snapshotWithoutAres as any)[deityId('Ares')];
    expect(cache.extract()).toEqual(snapshotWithoutAres);
    // Ares already removed, so no new garbage to collect.
    expect(cache.gc()).toEqual([]);

    const childrenOfZeusWithoutAres = childrenOfZeus.filter(child => {
      return child.name !== 'Ares';
    });

    expect(childrenOfZeusWithoutAres).toEqual([
      { __typename: 'Deity', name: 'Artemis', children: [] },
      { __typename: 'Deity', name: 'Apollo', children: [] },
      { __typename: 'Deity', name: 'Athena', children: [] },
    ]);

    expect(
      cache.readQuery({
        query: rulerQuery,
      }),
    ).toEqual({
      ruler: {
        __typename: 'Deity',
        name: 'Zeus',
        children: childrenOfZeusWithoutAres,
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Deity',
          name: 'Zeus',
        }),
      }),
    ).toBe(true);

    // You didn't think we were going to let Apollo be garbage-collected,
    // did you?
    cache.retain(
      cache.identify({
        __typename: 'Deity',
        name: 'Apollo',
      })!,
    );

    expect(cache.gc().sort()).toEqual(['Deity:{"name":"Artemis"}', 'Deity:{"name":"Athena"}']);

    expect(cache.extract()).toEqual({
      // A dangling reference to the evicted Zeus.
      ROOT_QUERY: rootQueryNode('Zeus'),
      [deityId('Apollo')]: { data: { __typename: 'Deity', name: 'Apollo', children: [] }, type: 0 },
    });

    const apolloRulerResult = cache.readQuery<{
      ruler: Record<string, any>;
    }>({ query: rulerQuery })!;

    expect(apolloRulerResult).toEqual({
      ruler: {
        __typename: 'Deity',
        name: 'Apollo',
        children: [],
      },
    });

    // No new diffs since before.
    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    // Rewatch the rulerQuery, but avoid delivering an immediate initial
    // result (by passing false), so that we can use cache.modify to
    // trigger the delivery of diffWithApolloAsRuler below.
    const cancel2 = watch(false);

    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    cache.modify({
      fields: {
        ruler(value, { toReference }) {
          expect(isReference(value)).toBe(true);
          expect(value.__ref).toBe(cache.identify(diffWithZeusAsRuler.result.ruler));
          expect(value.__ref).toBe('Deity:{"name":"Zeus"}');
          // Interim ruler Apollo takes over for real.
          return toReference(apolloRulerResult.ruler)!;
        },
      },
    });

    cancel2();

    const diffWithApolloAsRuler = {
      complete: true,
      result: apolloRulerResult,
    };

    // The cache.modify call should have triggered another diff, since we
    // overwrote the ROOT_QUERY.ruler field with a valid Reference to the
    // Apollo entity object.
    expect(diffs).toMatchObject([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
      diffWithApolloAsRuler,
    ]);

    expect(
      // Undo the cache.retain call above.
      cache.release(
        cache.identify({
          __typename: 'Deity',
          name: 'Apollo',
        })!,
      ),
    ).toBe(0);

    // Since ROOT_QUERY.ruler points to Apollo, nothing needs to be
    // garbage collected.
    expect(cache.gc()).toEqual([]);

    // Having survived GC, Apollo reigns supreme atop Olympus... or
    // something like that.
    expect(cache.extract()).toEqual({
      ROOT_QUERY: rootQueryNode('Apollo'),
      [deityId('Apollo')]: {
        data: { __typename: 'Deity', name: 'Apollo', children: [] },
        inbound: [{ id: 'ROOT_QUERY', path: ['ruler'] }],
        type: 0,
      },
    });
  });

  it('does not canonicalize custom scalar objects', () => {
    const now = new Date();
    const abc = { a: 1, b: 2, c: 3 };

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            now() {
              return now;
            },

            abc() {
              return abc;
            },
          },
        },
      },
    });

    const query: TypedDocumentNode<{
      now: typeof now;
      abc: typeof abc;
    }> = gql`
      query {
        now
        abc
      }
    `;

    const result1 = cache.readQuery({ query })!;
    const result2 = cache.readQuery({ query })!;

    expect(result1).toBe(result2);
    expect(result1.now).toBeInstanceOf(Date);

    // We already know result1.now === result2.now, but it's also
    // important that it be the very same (===) Date object that was
    // returned from the read function for the Query.now field, not a
    // canonicalized version.
    expect(result1.now).toBe(now);
    expect(result2.now).toBe(now);

    // The Query.abc field returns a "normal" object, but we know from the
    // structure of the query that it's a scalar object, so it will not be
    // canonicalized.
    expect(result1.abc).toEqual(abc);
    expect(result2.abc).toEqual(abc);
    expect(result1.abc).toBe(result2.abc);
    expect(result1.abc).toBe(abc);
    expect(result2.abc).toBe(abc);
  });
});

describe('lazy MissingFieldError diagnostics', () => {
  it('only constructs MissingFieldError when diff.missing is accessed', () => {
    const cache = new Hermes();

    const fullQuery = gql`
      query {
        customer {
          id
          name
          address {
            street
            city
          }
        }
      }
    `;

    const partialQuery = gql`
      query {
        customer {
          id
        }
      }
    `;

    cache.writeQuery({
      query: partialQuery,
      data: {
        customer: {
          __typename: 'Customer',
          id: 'c1',
        },
      },
    });

    const diff = cache.diff({
      query: fullQuery,
      returnPartialData: true,
      optimistic: true,
    });

    // @ts-ignore
    const missingSpy = jest.spyOn(diff, 'missing', 'get');
    expect(missingSpy).not.toHaveBeenCalled();

    // diff.missing should be lazily constructed only when accessed
    expect(diff.missing).toEqual(
      new MissingFieldError(
        "Can't find field 'name' on Customer:c1 object",
        {
          customer: {
            name: "Can't find field 'name' on Customer:c1 object",
            address: "Can't find field 'address' on Customer:c1 object",
          },
        },
        fullQuery,
        {},
      ),
    );

    expect(missingSpy).toHaveBeenCalledTimes(1);
  });

  it('missing message uses JSON.stringify for non-normalized embedded parents', () => {
    const cache = new Hermes();

    const query = gql`
      query {
        profile {
          bio
          largeField
        }
      }
    `;

    cache.writeQuery({
      query: gql`
        query {
          profile {
            bio
          }
        }
      `,
      data: {
        profile: {
          __typename: 'Profile',
          bio: 'a'.repeat(10),
        },
      },
    });

    const diff = cache.diff({
      query,
      returnPartialData: true,
      optimistic: true,
    });

    const message = `Can't find field 'largeField' on object ${JSON.stringify(
      { __typename: 'Profile', bio: 'a'.repeat(10) },
      null,
      2,
    )}`;

    expect(diff).toStrictEqualTyped({
      result: {
        profile: { __typename: 'Profile', bio: 'a'.repeat(10) },
      },
      complete: false,
      missing: new MissingFieldError(
        message,
        {
          profile: {
            largeField: message,
          },
        },
        query,
        {},
      ),
    });
  });
});
