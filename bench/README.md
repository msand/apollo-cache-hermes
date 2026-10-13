# Cache benchmark

Compares this checkout's Hermes with earlier Hermes releases and with Apollo Client's `InMemoryCache`, using the cache
API directly (`writeQuery`, `readQuery`, `writeFragment`, `diff`, `watch`, `modify`, `gc`, `extract`, `restore`) on
dashboard-sized data. The latest results are in [RESULTS.md](RESULTS.md).

```sh
npm run bench:setup                 # build + pack this checkout, install every implementation
npm run bench -- --write            # measure (about an hour), write bench/RESULTS.md
npm run bench -- --quick            # 3 rounds, to try a change out
node bench/profile.mjs hermes-branch read.afterWrite   # hottest functions in one scenario
```

Use Node 24 (`nvm use 24`). The options are described at the top of [run.mjs](run.mjs).

## Implementations

Each one is installed in its own folder under `bench/impl/` with its own `package.json` (exact versions) and
`node_modules` (git-ignored), so each resolves its own `@apollo/client` and `graphql` (16.14.2 everywhere):

| Folder              | Cache                                                      | Apollo Client |
| ------------------- | ---------------------------------------------------------- | ------------- |
| `hermes-0.9.12`     | `msand-apollo-cache-hermes@0.9.12`                         | 3.10.8        |
| `hermes-0.10.0`     | `msand-apollo-cache-hermes@0.10.0`                         | 3.10.8        |
| `hermes-0.11.0`     | `msand-apollo-cache-hermes@0.11.0`                         | 3.14.1        |
| `hermes-pre-review` | this repository at 4946e9c8 (before the code-review fixes) | 4.3.3         |
| `hermes-branch`     | this checkout: `tsc` emits `src/*.js`, then `npm pack`     | 4.3.3         |
| `inmemory-3`        | `InMemoryCache`                                            | 3.14.1        |
| `inmemory-4`        | `InMemoryCache`                                            | 4.3.3         |

`bench/setup.mjs` packs the Hermes builds (`npm pack --ignore-scripts`) and installs the tarballs like published
releases. Re-run it (or `npm run bench:setup -- hermes-branch`) after changing `src/`. The packed commit is recorded
in `bench/impl/hermes-branch/BUILD_COMMIT`, with `+dirty` if `src/` had uncommitted changes.

Every implementation is loaded with `require` from its folder. On Node 24, Apollo Client 4's `module-sync` export
condition loads its ES module build, like the tests; Apollo Client 3 loads its CommonJS build. Workers set
`NODE_ENV=production` and `globalThis.__DEV__ = false`, so no implementation freezes results or runs dev-only checks.
[impls.mjs](impls.mjs) is the thin adapter: Hermes removes orphaned nodes on every write, so its `collectGarbage` is
a no-op, while `InMemoryCache` calls `cache.gc()`.

## Scenarios

[scenarios.mjs](scenarios.mjs) defines them; [fixtures.mjs](fixtures.mjs) builds the data deterministically (seeded
PRNG). Each query selects `__typename` itself, so caches that add it and caches that don't store the same data.

Each scenario checks its own result (e.g. that a read returns all 1000 tasks, that a gc leaves the entity count
unchanged, how many watches a write notified) after the first operation and after 20 more. An implementation that
fails the check, or throws, is reported as **n/a** with the reason, rather than timed doing something else: e.g.
Hermes before this branch has no `merge` functions or `keyArgs`, and does not collect unreachable cycles (its store
grows).

## Method

The machine these runs are made on is shared with other workloads, so the method assumes noise rather than a quiet
moment:

- **One process per observation.** Each observation is a fresh worker process ([worker.mjs](worker.mjs)) for one
  (scenario, implementation) pair: setup, warm-up (300 ms and at least 5 operations), then 5 samples of at least
  100 ms of whole operations each. The observation is the median of those samples' ms per operation. JIT state, heap,
  and caches never carry over between implementations.
- **Interleaving.** A round runs every (scenario, implementation) pair once, in a freshly shuffled order (seeded
  with `--seed`; the seed is in RESULTS.md). Load that drifts during the run therefore affects every implementation
  alike, instead of whichever ran during the busy minutes.
- **Rounds.** 25 rounds by default. After those, scenarios where a Hermes comparison is still _inconclusive_ (see
  below), or that kept too few observations, get extra rounds (for the Hermes implementations only), up to
  `--max-rounds` (50).
- **Load.** Every observation records the 1-minute load average (the higher of before and after the worker) and the
  worker's CPU share: (user + system CPU time) / wall time during its samples. A share below 1 means the worker was
  descheduled. Observations with a CPU share below 0.9 (`--min-cpu-share`), or taken at a load above 3 × the number
  of cores (`--drop-load`), are dropped; those above the number of cores are kept but counted as flagged. RESULTS.md
  reports both counts. (On this 16-core machine, a single-threaded worker still got a full core at a load of 30–40,
  and its timings moved by only a few percent; so a high load average alone is not a reason to drop.)
- **Statistics** ([stats.mjs](stats.mjs)):
  - Each cell is the **median** of the kept observations, with a **95% percentile-bootstrap confidence interval**
    (4000 resamples), and the coefficient of variation.
  - Comparisons: consecutive Hermes versions (0.9.12 → 0.10.0 → 0.11.0 → pre-review → this branch) and this branch
    against 0.11.0. Each reports the change of the medians, a 95% bootstrap CI of the ratio of medians, and a
    two-sided **Mann-Whitney U** test (normal approximation with tie and continuity corrections).
  - Verdicts: **regression** / **improvement** when p < 0.01 and the change is at least 10%; _minor
    slowdown/speedup_ when p < 0.01 and 5–10%; _within 5%_ when significant but smaller; _inconclusive_ when not
    significant but the CI still allows a change of 10% or more; _no significant change_ otherwise. With roughly 50
    comparisons per report, p < 0.01 keeps the expected number of false alarms below one.
- **Merging.** `--merge <results.json>` keeps another run's columns, e.g. to re-measure only `hermes-branch`. Those
  columns were not interleaved with the new ones, so RESULTS.md says so; prefer a full run for final numbers.
- **Raw data.** `bench/results.json` (or `--json <file>`) has every observation with its load, CPU share and round;
  `npm run bench -- --report <file> --write` reports a saved run again (e.g. with other drop thresholds).

Each step between Hermes versions also changes the Apollo Client version, except 0.9.12 → 0.10.0 (3.10.8) and
pre-review → this branch (4.3.3). Hermes uses Apollo Client's utilities (e.g. `gql`, `ApolloCache#writeFragment`),
so some differences come from Apollo Client.

## Profiling

`node bench/profile.mjs <impl> <scenario> [--top 25] [--keep]` runs the worker under `node --cpu-prof` and prints the
functions with the most self and total time, counting only samples inside the scenario's timed operation.
