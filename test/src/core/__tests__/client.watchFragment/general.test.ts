import type { TypedDocumentNode } from '@apollo/client';
import { ApolloClient, ApolloLink, gql } from '@apollo/client';

import { ObservableStream, wait } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../../src';

it('can subscribe multiple times to watchFragment', async () => {
  type Item = {
    __typename: string;
    id: number;
    text?: string;
  };

  const ItemFragment: TypedDocumentNode<Item> = gql`
    fragment ItemFragment on Item {
      id
      text
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  client.writeFragment({
    fragment: ItemFragment,
    data: { __typename: 'Item', id: 1, text: 'Item #1' },
  });

  const observable = client.watchFragment({
    fragment: ItemFragment,
    from: { __typename: 'Item', id: 1 },
  });

  using stream1 = new ObservableStream(observable);
  using stream2 = new ObservableStream(observable);

  await expect(stream1).toEmitTypedValue({
    data: { __typename: 'Item', id: 1, text: 'Item #1' },
    dataState: 'complete',
    complete: true,
  });

  await expect(stream2).toEmitTypedValue({
    data: { __typename: 'Item', id: 1, text: 'Item #1' },
    dataState: 'complete',
    complete: true,
  });

  client.writeFragment({
    fragment: ItemFragment,
    data: { __typename: 'Item', id: 1, text: 'Item #1 updated' },
  });

  await expect(stream1).toEmitTypedValue({
    data: { __typename: 'Item', id: 1, text: 'Item #1 updated' },
    dataState: 'complete',
    complete: true,
  });

  await expect(stream2).toEmitTypedValue({
    data: { __typename: 'Item', id: 1, text: 'Item #1 updated' },
    dataState: 'complete',
    complete: true,
  });

  await expect(stream1).not.toEmitAnything();
  await expect(stream2).not.toEmitAnything();
});

it('dedupes watches when subscribing multiple times', async () => {
  type Item = {
    __typename: string;
    id: number;
    text?: string;
  };

  const ItemFragment: TypedDocumentNode<Item> = gql`
    fragment ItemFragment on Item {
      id
      text
    }
  `;

  const cache = new Hermes();
  const client = new ApolloClient({
    cache,
    link: ApolloLink.empty(),
  });

  client.writeFragment({
    fragment: ItemFragment,
    data: { __typename: 'Item', id: 1, text: 'Item #1' },
  });

  const observable = client.watchFragment({
    fragment: ItemFragment,
    from: { __typename: 'Item', id: 1 },
  });

  expect(cache).toHaveNumWatches(0);

  const sub1 = observable.subscribe(() => {});
  const sub2 = observable.subscribe(() => {});
  expect(cache).toHaveNumWatches(1);

  const sub3 = observable.subscribe(() => {});
  expect(cache).toHaveNumWatches(1);

  [sub1, sub2, sub3].forEach(sub => sub.unsubscribe());
  await wait(0);
  expect(cache).toHaveNumWatches(0);

  const sub4 = observable.subscribe(() => {});
  expect(cache).toHaveNumWatches(1);

  sub4.unsubscribe();
  await wait(0);
  expect(cache).toHaveNumWatches(0);
});

it('emits null with from: null', async () => {
  type Item = {
    __typename: string;
    id: number;
    text?: string;
  };

  const ItemFragment: TypedDocumentNode<Item> = gql`
    fragment ItemFragment on Item {
      id
      text
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const observable = client.watchFragment({
    fragment: ItemFragment,
    from: null,
  });

  using stream = new ObservableStream(observable);

  await expect(stream).toEmitTypedValue({
    data: null,
    dataState: 'complete',
    complete: true,
  });

  await expect(stream).not.toEmitAnything();
});

it('emits empty object when data is not in the cache', async () => {
  type Item = {
    __typename: string;
    id: number;
    text?: string;
  };

  const ItemFragment: TypedDocumentNode<Item> = gql`
    fragment ItemFragment on Item {
      id
      text
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const observable = client.watchFragment({
    fragment: ItemFragment,
    from: { __typename: 'Item', id: 1 },
  });

  using stream = new ObservableStream(observable);

  await expect(stream).toEmitTypedValue({
    data: {},
    dataState: 'partial',
    complete: false,
    missing: 'Dangling reference to missing Item:1 object',
  });

  await expect(stream).not.toEmitAnything();
});
