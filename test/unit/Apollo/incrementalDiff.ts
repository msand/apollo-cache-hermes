import { expect } from 'chai';
import gql from 'graphql-tag';
import { handleIncrementalSymbol } from '@apollo/client/utilities/internal';

import { Hermes } from '../../../src';

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
});
