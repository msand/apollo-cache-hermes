import { ApolloClient } from '@apollo/client';

import type { SuspenseCacheOptions } from '../index';

import { SuspenseCache } from './SuspenseCache';

declare module '../../../core/ApolloClient.js' {
  interface DefaultOptions {
    react?: {
      suspense?: Readonly<SuspenseCacheOptions>,
    };
  }
}

const suspenseCacheSymbol = Symbol.for('apollo.suspenseCache');

export function getSuspenseCache(
  client: ApolloClient<object> & {
    [suspenseCacheSymbol]?: SuspenseCache,
  }
) {
  if (!client[suspenseCacheSymbol]) {
    client[suspenseCacheSymbol] = new SuspenseCache(
      client.defaultOptions.react?.suspense
    );
  }

  return client[suspenseCacheSymbol];
}
