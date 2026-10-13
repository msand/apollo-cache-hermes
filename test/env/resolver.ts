import fs from 'fs';
import path from 'path';

interface ResolverOptions {
  defaultResolver: (request: string, options: ResolverOptions) => string;
  [key: string]: unknown;
}

const apolloClientRoot = path.dirname(require.resolve('@apollo/client/package.json'));
const apolloCacheModule = path.join(apolloClientRoot, 'cache/index.js');
const apolloTestingDir = path.join(apolloClientRoot, 'testing') + path.sep;

/**
 * Resolves `@apollo/client` and all of its subpaths to the package's ES module
 * files. The vendored tests deep-import Apollo Client internals such as
 * `@apollo/client/core/QueryManager`, which only exist as ES modules, so the
 * entry points must load from the same files; mixing them with the CommonJS
 * bundles would give the tests and Hermes two copies of every Apollo class.
 *
 * Apollo Client's test utilities (`@apollo/client/testing/**`) get
 * test/env/testingCache instead of the cache module, so the ones that default
 * to an `InMemoryCache` (e.g. `MockedProvider`) use Hermes.
 */
function resolve(request: string, options: ResolverOptions): string {
  const basedir = options.basedir as string | undefined;
  if (request.startsWith('.') && basedir?.startsWith(apolloTestingDir)) {
    if (path.resolve(basedir, request) === apolloCacheModule) return path.join(__dirname, 'testingCache.js');
  }
  if (request === '@apollo/client' || request.startsWith('@apollo/client/')) {
    const target = path.join(apolloClientRoot, request.slice('@apollo/client'.length));
    for (const candidate of [target, `${target}.js`, path.join(target, 'index.js')]) {
      if (candidate.endsWith('.js') && fs.existsSync(candidate)) return candidate;
    }
  }
  return options.defaultResolver(request, options);
}

export = resolve;
