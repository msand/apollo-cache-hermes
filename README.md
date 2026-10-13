# Hermes: A Cache For Apollo Client

[![npm](https://img.shields.io/npm/v/msand-apollo-cache-hermes.svg)](https://www.npmjs.com/package/msand-apollo-cache-hermes)
[![CI](https://github.com/msand/apollo-cache-hermes/actions/workflows/ci.yml/badge.svg)](https://github.com/msand/apollo-cache-hermes/actions/workflows/ci.yml)

An alternative cache implementation for Apollo Client, tuned for the performance of heavy GraphQL payloads.

Hermes implements Apollo Client's `ApolloCache` and runs Apollo Client's own test suite (vendored in `test/src`) against
itself, so it behaves like Apollo's `InMemoryCache` apart from the differences listed below.

## What Makes It Different?

This cache maintains an immutable & normalized _graph_ of the values received from your GraphQL server. It enables the
cache to return _direct references_ to the cache, in order to satisfy queries<sup>1</sup>. As a result, reads from the
cache require minimal work (and can be optimized to constant time lookups in some cases). The tradeoff is that rather
than receiving only the fields selected by a GraphQL query, there may be additional fields.

This is in contrast to the built in cache for Apollo (and Relay), which maintain a normalized _map_ of values. The
unfortunate reality of those caches is that read operations impose _considerable_ overhead (in CPU and memory) in order
to build a result payload. See [the motivation behind this cache](docs/Motivation.md), as well as
[the design exploration](docs/Design%20Exploration.md) for a deeper discussion.

<sup>1</sup> If your query contains parameterized fields, there is some work that the cache has to perform during read,
in order to layer those fields on top of the static values within the cache.

## Apollo Client Compatibility

| Hermes            | `@apollo/client` (peer dependency) | Tested against |
| ----------------- | ---------------------------------- | -------------- |
| 0.10.x            | `^3.10.8`                          | 3.10.8         |
| 0.11.x            | `^3.14.1`                          | 3.14.1         |
| 0.12.x (upcoming) | `^4.3.3`                           | 4.3.3          |

0.11 added support for Apollo Client 3.12+'s data masking. 0.12 supports Apollo Client 4, including custom scalars,
`keyArgs`, type policy inheritance and incremental delivery (`@defer` / `@stream`); it is tested with React 19 and
graphql 17.

## Using The Cache

```sh
npm install msand-apollo-cache-hermes @apollo/client graphql
```

```ts
import { ApolloClient, HttpLink } from '@apollo/client';
import { Hermes } from 'msand-apollo-cache-hermes';

const client = new ApolloClient({
  cache: new Hermes({
    possibleTypes: { Node: ['User', 'Post'] },
    typePolicies: {
      Query: { fields: { feed: { keyArgs: ['type'] } } },
    },
  }),
  link: new HttpLink({ uri: '/graphql' }),
});
```

Hermes takes most of `InMemoryCache`'s options: `typePolicies` (`keyFields`, field `read` / `merge` / `keyArgs` /
`scalar` policies, inheritance through `possibleTypes`, `queryType` / `mutationType` / `subscriptionType`),
`possibleTypes`, `dataIdFromObject`, `fragments`, `scalars` and `inputObjects`. Like `InMemoryCache`, objects are
normalized when they have a `__typename` and an `id` (or `_id`), or according to their `keyFields` or
`dataIdFromObject`. See `Configuration` in [`src/context/CacheContext.ts`](src/context/CacheContext.ts) for the
Hermes-specific options (`freeze`, `entityUpdaters`, `onChange`, `tracer`, …).

Beyond Apollo's cache API, `cache.batchEvict(ids, broadcast = true)` evicts several entities with one baseline snapshot
edit and one broadcast (pending optimistic updates are replayed on top, as after any baseline change). Calling `evict`
once per id edits the snapshot once per entity, even inside `batch`, and outside `batch` also broadcasts once per
entity. Each entity is removed whole, whereas a single `evict` can leave a stub for a null field that also has a
parameterized variant. Ids that are not in the cache are skipped. It returns whether any entity was evicted.

## Differences From `InMemoryCache`

- **Reads can return more fields than were selected.** Results reference the cached graph directly, so an entity's other
  cached fields (and, for aliased fields, the field under its schema name) can appear in results. Code that compares
  results to exactly the selected fields, or relies on unrelated fields not changing a result, can behave differently.
- **Orphaned entities are deleted right away.** Entities that are no longer referenced are removed when a write orphans
  them, rather than when `gc()` runs.
- **`extract()` has Hermes' own format** (nodes with `data`, `inbound`, `outbound` and `parameterized` edges);
  `restore()` accepts that format as well as `InMemoryCache`'s normalized cache objects.
- **Custom scalars are stored serialized** (so snapshots stay JSON) and parsed when read.
- **Written values are frozen as they are**, rather than copied.
- **No result caching**: Hermes does not keep `InMemoryCache`'s per-query result caches, so it does not have
  `resultCaching` / `canonizeResults` options, and result identity across reads follows the graph instead.
- **Reactive variables** are not forgotten when a cache stops watching them: Apollo Client does not expose its
  `forgetCache` / `recallCache` registry to other caches.
- **Retain counts** (`cache.retain` / `cache.release`) are not tracked per optimistic layer, nor kept through
  `extract()` / `restore()`.
- **Response keys that select different fields under type conditions** (e.g.
  `... on Book { size: pages } ... on Movie { size: runtime }`, or one field with different arguments) need the type
  conditions to be disjoint. Without a schema, Hermes takes different type conditions to be different object types, and
  throws a `ConflictingFieldsError` when one selection's type conditions include all of the other's (or one has none).
  When several of the fields apply to an object (through `possibleTypes`), or the object has no `__typename`, the first
  one in the document is read and written.

Apollo Client's tests that assert `InMemoryCache` internals or the behaviours above are skipped in `test/src`, each with
a `// Hermes:` comment explaining why.

## Contributing

Interested in helping out? Awesome! If you've got an [idea or issue](https://github.com/msand/apollo-cache-hermes/issues),
please feel free to file it, and provide as much context as you can.

### Local Development

Use the Node version in [`.nvmrc`](.nvmrc) (Node 24):

```sh
git clone https://github.com/msand/apollo-cache-hermes
cd apollo-cache-hermes
npm ci

npm run compile     # type-check and build (src, Hermes' tests and the vendored Apollo Client tests)
npm run test-unit   # run all tests
npm run test-style  # lint
npm run format      # format with Prettier
```

- `src/` is the cache; `test/unit/` holds Hermes' own tests.
- `test/src/` holds Apollo Client's test suite, adapted to run against Hermes (adaptations are marked `// Hermes:`). It
  runs against the published `@apollo/client` package, with Apollo Client's unpublished test helpers vendored in
  `test/src/testing` and `test/src/config`.
- When upgrading Apollo Client, check out its repository at the matching tag into `apollo-client/` (ignored by git) to
  compare against and bring in its tests, e.g.
  `git clone --depth 1 --branch @apollo/client@4.3.3 https://github.com/apollographql/apollo-client.git apollo-client`.
