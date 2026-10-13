// The cache implementations under comparison, each installed in its own
// folder under bench/impl/ (see bench/setup.mjs), and a thin adapter over the
// small API differences between them.
//
// Every implementation is loaded with `require` from its own folder, so each
// resolves its own @apollo/client and graphql. On Node >= 22.12, Apollo Client
// 4's `module-sync` export condition makes `require` load its ES module build
// (the build the tests use); Apollo Client 3 loads its CommonJS build.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const IMPLS = {
  'hermes-0.9.12': { label: 'Hermes 0.9.12 + AC 3.10.8', dir: 'hermes-0.9.12', kind: 'hermes' },
  'hermes-0.10.0': { label: 'Hermes 0.10.0 + AC 3.10.8', dir: 'hermes-0.10.0', kind: 'hermes' },
  'hermes-0.11.0': { label: 'Hermes 0.11.0 + AC 3.14.1', dir: 'hermes-0.11.0', kind: 'hermes' },
  'hermes-branch': { label: 'Hermes (this branch) + AC 4.3.3', dir: 'hermes-branch', kind: 'hermes' },
  'inmemory-3': { label: 'InMemoryCache AC 3.14.1', dir: 'inmemory-3', kind: 'inmemory' },
  'inmemory-4': { label: 'InMemoryCache AC 4.3.3', dir: 'inmemory-4', kind: 'inmemory' },
};

/** Consecutive Hermes versions, oldest first, for regression flags. */
export const HERMES_LINEAGE = ['hermes-0.9.12', 'hermes-0.10.0', 'hermes-0.11.0', 'hermes-branch'];

export function implDir(name) {
  return path.join(here, 'impl', IMPLS[name].dir);
}

/**
 * Loads an implementation and returns an adapter:
 *   gql(text), createCache({ possibleTypes, typePolicies }), offsetLimitPagination,
 *   collectGarbage(cache), entityCount(cache), versions.
 */
export function loadImpl(name) {
  const impl = IMPLS[name];
  if (!impl) throw new Error(`Unknown implementation ${name}; expected one of ${Object.keys(IMPLS).join(', ')}`);
  const require = createRequire(path.join(implDir(name), 'package.json'));

  const apollo = require('@apollo/client');
  const { offsetLimitPagination } = require('@apollo/client/utilities');
  const versions = {
    '@apollo/client': require('@apollo/client/package.json').version,
    graphql: require('graphql/package.json').version,
  };

  let createCache, collectGarbage, entityCount;
  if (impl.kind === 'hermes') {
    const { Hermes } = require('msand-apollo-cache-hermes');
    versions['msand-apollo-cache-hermes'] = require('msand-apollo-cache-hermes/package.json').version;
    // bench/setup.mjs records the commit a packed checkout was built from.
    const commitFile = path.join(implDir(name), 'BUILD_COMMIT');
    if (fs.existsSync(commitFile)) versions.commit = fs.readFileSync(commitFile, 'utf8').trim();
    createCache = (config = {}) => new Hermes(config);
    // Hermes removes orphaned nodes as part of every write.
    collectGarbage = () => {};
    entityCount = cache => Object.keys(cache.getCurrentCacheSnapshot().baseline._values).length;
  } else {
    const { InMemoryCache } = apollo;
    createCache = (config = {}) => new InMemoryCache(config);
    collectGarbage = cache => cache.gc();
    entityCount = cache => Object.keys(cache.extract()).length;
  }

  return {
    name,
    label: impl.label,
    gql: apollo.gql,
    createCache,
    offsetLimitPagination,
    collectGarbage,
    entityCount,
    versions,
  };
}
