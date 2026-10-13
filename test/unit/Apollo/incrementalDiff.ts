import { expect } from 'chai';
import gql from 'graphql-tag';
import { InMemoryCache } from '@apollo/client';
import { handleIncrementalSymbol } from '@apollo/client/utilities/internal';
import type { DocumentNode } from 'graphql';

import { Hermes } from '../../../src';
import { incrementalDiff } from '../../../src/operations/incrementalDiff';

describe(`diff with incremental (@defer) info`, () => {
  const query = gql`
    query {
      greeting {
        message
        ... on Greeting @defer {
          recipient {
            name
            email
          }
        }
      }
    }
  `;

  function makeCache() {
    const cache = new Hermes();
    // Another query writes fields that `query` does not select.
    cache.writeQuery({
      query: gql`
        query {
          greeting {
            message
            author
            recipient {
              name
            }
          }
        }
      `,
      data: {
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          author: 'Bob',
          recipient: { __typename: 'Person', name: 'Alice' },
        },
      },
    });
    return cache;
  }

  it(`prunes the fields of a partial @defer boundary, keeping the fields the query does not select`, () => {
    const cache = makeCache();
    const diff = cache.diff({
      query,
      optimistic: true,
      returnPartialData: false,
      [handleIncrementalSymbol]: undefined,
    });

    expect(diff.complete).to.eq(false);
    expect((diff as any).dataState).to.eq('streaming');
    expect(diff.missing).to.eq(undefined);
    // recipient is only selected by the partial @defer boundary; author is
    // not selected at all (Hermes' reads return a superset of the selection).
    expect(diff.result).to.deep.eq({
      greeting: { __typename: 'Greeting', message: 'Hello world', author: 'Bob' },
    });
  });

  it(`keeps partial @defer data when partial data is requested`, () => {
    const cache = makeCache();
    const diff = cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
      [handleIncrementalSymbol]: undefined,
    });

    expect((diff as any).dataState).to.eq('partial');
    expect(diff.result).to.deep.eq({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        author: 'Bob',
        recipient: { __typename: 'Person', name: 'Alice' },
      },
    });
  });

  it(`returns the same pruned result for repeated reads`, () => {
    const cache = makeCache();
    const options = {
      query,
      optimistic: true,
      returnPartialData: false,
      [handleIncrementalSymbol]: undefined,
    };

    expect(cache.diff(options).result).to.eq(cache.diff(options).result);
  });

  it(`reports the dataState of queries without @defer from their completeness`, () => {
    const cache = makeCache();
    const options = { optimistic: true, returnPartialData: true, [handleIncrementalSymbol]: undefined } as const;

    const complete = cache.diff({ ...options, query: gql(`{ greeting { message } }`) });
    expect((complete as any).dataState).to.eq('complete');
    const partial = cache.diff({ ...options, query: gql(`{ greeting { message missing } }`) });
    expect((partial as any).dataState).to.eq('partial');
    const empty = new Hermes().diff({ ...options, query: gql(`{ missing }`) });
    expect((empty as any).dataState).to.eq('empty');
    expect(empty.result).to.eq(null);
  });

  it(`does not add a dataState without incremental info`, () => {
    const cache = makeCache();
    const diff = cache.diff({ query, optimistic: true, returnPartialData: true });

    expect(diff).not.to.have.property('dataState');
  });

  it(`reports reads without any of the fields selected at the root as empty`, () => {
    for (const cache of [new Hermes(), new InMemoryCache()]) {
      // The root holds a field the query does not select.
      cache.writeQuery({ query: gql(`{ b }`), data: { b: 1 } });
      const diff = cache.diff({
        query: gql(`{ ... @defer { a } }`),
        optimistic: true,
        returnPartialData: true,
        [handleIncrementalSymbol]: undefined,
      } as Parameters<Hermes['diff']>[0]);
      expect([diff.result, diff.complete, (diff as any).dataState]).to.deep.eq([null, false, 'empty']);
    }
  });

  it(`prunes the stored values of aliased fields in partial @defer boundaries`, () => {
    for (const cache of [new Hermes(), new InMemoryCache()]) {
      cache.writeQuery({
        query: gql(`{ user { id name } }`),
        data: { user: { __typename: 'User', id: 1, name: 'a' } },
      });
      const diff = cache.diff({
        query: gql(`{ user { id ... @defer { n: name e: email } } }`),
        optimistic: true,
        returnPartialData: false,
        [handleIncrementalSymbol]: undefined,
      } as Parameters<Hermes['diff']>[0]);
      expect((diff as any).dataState).to.eq('streaming');
      expect(diff.result).to.deep.eq({ user: { __typename: 'User', id: 1 } });
    }
  });

  it(`resolves the fragments of documents that share an operation by document`, () => {
    // Document transforms can leave the operation of a document untouched,
    // while adding fragment definitions.
    const cache = new Hermes({ addTypename: false });
    cache.writeQuery({
      query: gql(`{ user { __typename id name } }`),
      data: { user: { __typename: 'User', id: 1, name: 'a' } },
    });
    const operation = gql(`{ user { __typename id ...F @defer } }`).definitions[0];
    const withFragment = (fragment: string): DocumentNode => ({
      kind: 'Document' as DocumentNode['kind'],
      definitions: [operation, gql(fragment).definitions[0]],
    });
    const diff = (query: DocumentNode) =>
      cache.diff({ query, optimistic: true, returnPartialData: false, [handleIncrementalSymbol]: undefined });

    // Both fragments are partial, so both reads prune them.
    diff(withFragment(`fragment F on User { name phone }`));
    const result = diff(withFragment(`fragment F on User { email }`));
    expect((result as any).dataState).to.eq('streaming');
    // `name` is not selected by this document, so it is kept.
    expect(result.result).to.deep.eq({ user: { __typename: 'User', id: 1, name: 'a' } });
  });

  describe(`incrementalDiff`, () => {
    it(`describes the operation only when a @defer boundary needs a look`, () => {
      const document = gql(`{ greeting }`);
      const getOperation = () => {
        throw new Error(`described the operation`);
      };
      const diff = incrementalDiff({ complete: false, result: {} }, document, getOperation, true, undefined);
      expect(diff.dataState).to.eq('empty');
      const deferred = gql(`{ ... @defer { greeting } }`);
      const complete = incrementalDiff(
        { complete: true, result: { greeting: 'hi' } },
        deferred,
        getOperation,
        true,
        undefined,
      );
      expect(complete.dataState).to.eq('complete');
    });
  });
});
