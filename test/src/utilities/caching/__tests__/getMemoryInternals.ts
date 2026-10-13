import * as crypto from 'crypto';
import { ApolloClient, ApolloLink, DocumentTransform, InMemoryCache } from '@apollo/client';
import { createFragmentRegistry } from '@apollo/client/cache';
import { gql } from '@apollo/client/core';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { removeTypenameFromVariables } from '@apollo/client/link/remove-typename';
// importing react so the `parser` cache initializes
import '@apollo/client/react';
import { cacheSizes, defaultCacheSizes } from '@apollo/client/utilities/caching/sizes';

import { Hermes } from '../../../../../src';

function sha256(data: string) {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

const defaultCacheSizesAsObject = {
  parser: defaultCacheSizes['parser'],
  canonicalStringify: defaultCacheSizes['canonicalStringify'],
  print: defaultCacheSizes['print'],
  'documentTransform.cache': defaultCacheSizes['documentTransform.cache'],
  'queryManager.getDocumentInfo': defaultCacheSizes['queryManager.getDocumentInfo'],
  'PersistedQueryLink.persistedQueryHashes': defaultCacheSizes['PersistedQueryLink.persistedQueryHashes'],
  'fragmentRegistry.transform': defaultCacheSizes['fragmentRegistry.transform'],
  'fragmentRegistry.lookup': defaultCacheSizes['fragmentRegistry.lookup'],
  'fragmentRegistry.findFragmentSpreads': defaultCacheSizes['fragmentRegistry.findFragmentSpreads'],
  'cache.fragmentQueryDocuments': defaultCacheSizes['cache.fragmentQueryDocuments'],
  'removeTypenameFromVariables.getVariableDefinitions':
    defaultCacheSizes['removeTypenameFromVariables.getVariableDefinitions'],
  'inMemoryCache.maybeBroadcastWatch': defaultCacheSizes['inMemoryCache.maybeBroadcastWatch'],
  'inMemoryCache.executeSelectionSet': defaultCacheSizes['inMemoryCache.executeSelectionSet'],
  'inMemoryCache.executeSubSelectedArray': defaultCacheSizes['inMemoryCache.executeSubSelectedArray'],
};

it('returns information about cache usage (empty caches)', () => {
  const client = new ApolloClient({
    documentTransform: new DocumentTransform(x => x, {
      cache: true,
    }).concat(
      new DocumentTransform(x => x, {
        cache: true,
      }),
    ),
    cache: new Hermes({
      fragments: createFragmentRegistry(),
    }),
    link: createPersistedQueryLink({
      sha256,
    })
      .concat(removeTypenameFromVariables())
      .concat(ApolloLink.empty()),
  });
  expect(client.getMemoryInternals?.()).toEqual({
    limits: defaultCacheSizesAsObject,
    sizes: {
      parser: 0,
      canonicalStringify: 0,
      print: 0,
      // Hermes: Hermes reports only ApolloCache's memory internals; InMemoryCache's
      // addTypenameDocumentTransform, fragmentRegistry and inMemoryCache (StoreReader)
      // caches do not exist.
      queryManager: {
        getDocumentInfo: 0,
        documentTransforms: [
          {
            cache: 0,
          },
          {
            cache: 0,
          },
        ],
      },
      cache: {
        fragmentQueryDocuments: 0,
      },
      links: [
        {
          PersistedQueryLink: {
            persistedQueryHashes: 0,
          },
        },
        {
          removeTypenameFromVariables: {
            getVariableDefinitions: 0,
          },
        },
      ],
    },
  });
});

it('returns information about cache usage (some query triggered)', () => {
  const client = new ApolloClient({
    documentTransform: new DocumentTransform(x => x, {
      cache: true,
    }).concat(
      new DocumentTransform(x => x, {
        cache: true,
      }),
    ),
    cache: new Hermes({
      fragments: createFragmentRegistry(),
    }),
    link: createPersistedQueryLink({
      sha256,
    })
      .concat(removeTypenameFromVariables())
      .concat(ApolloLink.empty()),
  });

  client.query({
    query: gql`
      query {
        hello
      }
    `,
  });
  expect(client.getMemoryInternals?.()).toStrictEqual({
    limits: defaultCacheSizesAsObject,
    sizes: {
      parser: 0,
      canonicalStringify: 0,
      print: 1,
      // Hermes: Hermes reports only ApolloCache's memory internals; InMemoryCache's
      // addTypenameDocumentTransform, fragmentRegistry and inMemoryCache (StoreReader)
      // caches do not exist.
      queryManager: {
        getDocumentInfo: 1,
        documentTransforms: [
          {
            cache: 1,
          },
          {
            cache: 1,
          },
        ],
      },
      cache: {
        fragmentQueryDocuments: 0,
      },
      links: [
        {
          PersistedQueryLink: {
            persistedQueryHashes: 1,
          },
        },
        {
          removeTypenameFromVariables: {
            getVariableDefinitions: 0,
          },
        },
      ],
    },
  });
});

it('reports user-declared cacheSizes', () => {
  const client = new ApolloClient({
    cache: new Hermes({}),
  });

  cacheSizes['inMemoryCache.executeSubSelectedArray'] = 90;

  expect(client.getMemoryInternals?.().limits).toStrictEqual({
    ...defaultCacheSizesAsObject,
    'inMemoryCache.executeSubSelectedArray': 90,
  });
});
