import { ApolloClient, ApolloLink, gql } from '@apollo/client';

import { Hermes } from '../../../../../src';
import { toNormalizedCacheObject } from '../../../../helpers/serialization';

it('can use `from` with writeFragment', async () => {
  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  // Hermes: extract() is Hermes' serialization (compared in InMemoryCache's
  // normalized shape below), which has no __META.extraRootIds.
  client.writeFragment({
    data: {
      id: 1,
      a: 1,
      b: 2,
      __typename: 'Foo',
    },
    from: { __typename: 'Foo', id: 1 },
    fragment: gql`
      fragment foo on Foo {
        id
        a
        b
      }
    `,
  });

  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toEqual({
    'Foo:1': {
      __typename: 'Foo',
      id: 1,
      a: 1,
      b: 2,
    },
  });

  client.writeFragment({
    data: {
      c: 3,
      d: 4,
      __typename: 'Foo',
    },
    from: { __ref: 'Foo:1' },
    fragment: gql`
      fragment foo on Foo {
        c
        d
      }
    `,
  });

  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toEqual({
    'Foo:1': {
      __typename: 'Foo',
      id: 1,
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    },
  });

  client.writeFragment({
    data: {
      e: 5,
      f: 6,
      __typename: 'Foo',
    },
    from: 'Foo:1',
    fragment: gql`
      fragment foo on Foo {
        e
        f
      }
    `,
  });

  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toEqual({
    'Foo:1': {
      __typename: 'Foo',
      id: 1,
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
    },
  });
});
