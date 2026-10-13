import { expectTypeOf } from 'expect-type';
import type { DataValue, Reference, StoreObject, TypedDocumentNode } from '@apollo/client';
import type { ApolloCache, MissingTree } from '@apollo/client/cache';

import { Hermes } from '../../../../../../src';

describe.skip('type tests', () => {
  interface Item {
    __typename: 'Item';
    id: number;
    text: string;
  }

  const cache = new Hermes();
  let fragment!: TypedDocumentNode<Item, Record<string, never>>;

  it('from: null -> null', () => {
    const observable = cache.watchFragment({ fragment, from: null });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<null>>();
    expectTypeOf(result).toEqualTypeOf<{
      data: null;
      dataState: 'complete';
      complete: true;
      missing?: never;
    }>();
  });

  it('from: StoreObject -> TData', () => {
    const observable = cache.watchFragment({
      fragment,
      from: { __typename: 'Item', id: 1 },
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: string -> TData', () => {
    const observable = cache.watchFragment({ fragment, from: 'Item:1' });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: Reference -> TData', () => {
    const observable = cache.watchFragment({
      fragment,
      from: { __ref: 'Item:1' },
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: StoreObject | null -> TData | null', () => {
    const observable = cache.watchFragment({
      fragment,
      from: { __typename: 'Item', id: 1 } as StoreObject | null,
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item | null>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: null;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: string | null -> TData | null', () => {
    const observable = cache.watchFragment({
      fragment,
      from: 'Item:1' as string | null,
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item | null>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: null;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: Reference | null -> TData | null', () => {
    const observable = cache.watchFragment({
      fragment,
      from: { __ref: 'Item:1' } as Reference | null,
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Item | null>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: null;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: Item;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: DataValue.Partial<Item>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: Array<null> -> Array<null>', () => {
    const observable = cache.watchFragment({
      fragment,
      from: [null],
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Array<null>>>();
    expectTypeOf(result).toEqualTypeOf<{
      data: Array<null>;
      dataState: 'complete';
      complete: true;
      missing?: never;
    }>();
  });

  it('from: Array<FromValue> -> Array<TData>', () => {
    const observable = cache.watchFragment({
      fragment,
      from: [{ __typename: 'Item', id: 1 }, 'Item:1', { __ref: 'Item:1' }],
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Array<Item>>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: Array<Item>;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: Array<DataValue.Partial<Item> | null>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });

  it('from: Array<FromValue | null> -> Array<TData | null>', () => {
    const observable = cache.watchFragment({
      fragment,
      from: [{ __typename: 'Item', id: 1 }, null],
    });
    const result = observable.getCurrentResult();

    expectTypeOf(observable).toEqualTypeOf<ApolloCache.ObservableFragment<Array<Item | null>>>();
    expectTypeOf(result).toEqualTypeOf<
      | {
          data: Array<Item | null>;
          dataState: 'complete';
          complete: true;
          missing?: never;
        }
      | {
          data: Array<DataValue.Partial<Item> | null>;
          dataState: 'partial';
          complete: false;
          missing?: MissingTree;
        }
    >();
  });
});
