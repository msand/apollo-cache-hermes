import fs from 'fs';
import path from 'path';

interface ResolverOptions {
  defaultResolver: (request: string, options: ResolverOptions) => string;
  [key: string]: unknown;
}

type ExportsEntry = string | null | { [condition: string]: ExportsEntry };

const apolloClientRoot = path.dirname(require.resolve('@apollo/client/package.json'));
const apolloExports: Record<string, ExportsEntry> = JSON.parse(
  fs.readFileSync(path.join(apolloClientRoot, 'package.json'), 'utf8'),
).exports;
const apolloCacheModule = path.join(apolloClientRoot, 'cache/index.js');
const apolloTestingDir = path.join(apolloClientRoot, 'testing') + path.sep;

/** The export conditions to resolve Apollo Client's entry points with, in order. */
const conditions = new Set(['module', 'default']);

/**
 * The target of a package `exports` entry for the `module` condition (the ES
 * modules), skipping the `production` and `development` conditions.
 */
function exportTarget(entry: ExportsEntry): string | undefined {
  if (typeof entry === 'string') return entry;
  if (!entry) return undefined;
  for (const [condition, value] of Object.entries(entry)) {
    if (!conditions.has(condition)) continue;
    const target = exportTarget(value);
    if (target !== undefined) return target;
  }
  return undefined;
}

/**
 * The file `@apollo/client` or one of its subpaths resolves to: an entry point
 * through the package's `exports` map, or else a file within the package.
 */
function resolveApolloClient(request: string): string | undefined {
  const subpath = request.slice('@apollo/client'.length);
  const entry = apolloExports[`.${subpath}`];
  const target = !subpath.includes('*') && entry !== undefined ? exportTarget(entry) : undefined;
  if (target) return path.join(apolloClientRoot, target);
  const file = path.join(apolloClientRoot, subpath);
  for (const candidate of [file, `${file}.js`, path.join(file, 'index.js')]) {
    if (candidate.endsWith('.js') && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolves `@apollo/client` and all of its subpaths to the package's ES module
 * files: entry points (e.g. `@apollo/client`, `@apollo/client/cache`) through
 * the `module` condition of its `exports` map, and deep imports of Apollo
 * Client internals (e.g. `@apollo/client/core/QueryManager`, which the
 * vendored tests use) to the files themselves. Mixing them with the CommonJS
 * bundles would give the tests and Hermes two copies of every Apollo class.
 *
 * Apollo Client's test utilities (`@apollo/client/testing/**`) get
 * test/env/testingCache instead of the cache module, so the ones that default
 * to an `InMemoryCache` (e.g. `MockedProvider`) use Hermes.
 */
function resolve(request: string, options: ResolverOptions): string {
  const basedir = options.basedir as string | undefined;
  let resolved: string | undefined;
  // Apollo Client 4 does not publish its test support code; the vendored tests use a copy.
  if (request === '@apollo/client/testing/internal') return path.join(__dirname, '../src/testing/internal/index.js');
  if (request === '@apollo/client' || request.startsWith('@apollo/client/')) {
    resolved = resolveApolloClient(request);
  } else if (request.startsWith('.') && basedir) {
    resolved = path.resolve(basedir, request);
  }
  if (resolved === apolloCacheModule && basedir?.startsWith(apolloTestingDir)) {
    return path.join(__dirname, 'testingCache.js');
  }
  if (resolved && request.startsWith('@apollo/client')) return resolved;
  return options.defaultResolver(request, options);
}

export = resolve;
