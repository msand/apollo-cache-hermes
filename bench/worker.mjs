// Runs one scenario against one implementation in this process, and prints a
// single JSON line with the timing samples. bench/run.mjs starts one worker
// process per (implementation, scenario, round), so JIT state and heap from
// one implementation never leak into another's measurement; the median of a
// worker's samples is one independent observation.
//
//   node bench/worker.mjs <impl> <scenario> [--warmup-ms 300] [--samples 5] [--sample-ms 100] [--check-only]

// Measure production behavior everywhere: no dev-only freezing or checks.
process.env.NODE_ENV = 'production';
globalThis.__DEV__ = false;

const [implName, scenarioName, ...rest] = process.argv.slice(2);
const opts = { 'warmup-ms': 300, samples: 5, 'sample-ms': 100, 'check-only': false };
for (let i = 0; i < rest.length; i++) {
  const key = rest[i].replace(/^--/, '');
  if (key === 'check-only') opts[key] = true;
  else opts[key] = Number(rest[++i]);
}

const { loadImpl } = await import('./impls.mjs');
const { SCENARIOS } = await import('./scenarios.mjs');

const scenario = SCENARIOS.find(s => s.name === scenarioName);
if (!scenario) throw new Error(`Unknown scenario ${scenarioName}`);
const impl = loadImpl(implName);

// Silence cache warnings (e.g. about missing fields) so they don't skew timing.
for (const method of ['log', 'warn', 'error', 'info', 'debug']) console[method] = () => {};

const out = line => process.stdout.write(JSON.stringify({ impl: implName, scenario: scenarioName, ...line }) + '\n');

let op, check;
try {
  ({ op, check } = scenario.setup(impl));
  op();
} catch (error) {
  out({ status: 'n/a', error: String(error?.message ?? error).split('\n')[0], versions: impl.versions });
  process.exit(0);
}
// Validate after the first op and again after a few more (some differences,
// such as a store that keeps growing, only show over several writes).
const firstCheck = check?.();
let reason = scenario.valid?.(firstCheck);
let afterCheck;
if (reason === true) {
  try {
    for (let i = 0; i < 20; i++) op();
  } catch (error) {
    reason = String(error?.message ?? error).split('\n')[0];
  }
  afterCheck = check?.();
  if (reason === true) reason = scenario.valid?.(afterCheck);
}
if (reason !== true && reason !== undefined) {
  out({ status: 'n/a', error: reason, check: firstCheck, checkAfter: afterCheck, versions: impl.versions });
  process.exit(0);
}
if (opts['check-only']) {
  out({ status: 'ok', check: firstCheck, checkAfter: afterCheck, versions: impl.versions });
  process.exit(0);
}

const now = () => process.hrtime.bigint();
const ms = ns => Number(ns) / 1e6;

// Warm up: let the JIT settle and caches reach their steady state.
let start = now();
let warmupOps = 0;
while (ms(now() - start) < opts['warmup-ms'] || warmupOps < 5) {
  op();
  warmupOps++;
}

// Samples: each runs whole operations for at least sample-ms (and at least
// 3 ops), and records the mean time per op in that sample, and the share of
// that wall time this process spent on a CPU (user + system time / wall
// time). A share well below 1 means the process was descheduled: the sample
// was taken under CPU contention. (It can exceed 1 when V8's background
// threads, e.g. the garbage collector's, run in parallel.)
const samples = [];
const cpuShares = [];
for (let s = 0; s < opts.samples; s++) {
  let ops = 0;
  const cpuStart = process.cpuUsage();
  start = now();
  let elapsed;
  do {
    op();
    ops++;
    elapsed = ms(now() - start);
  } while (elapsed < opts['sample-ms'] || ops < 3);
  const cpu = process.cpuUsage(cpuStart);
  samples.push(elapsed / ops);
  cpuShares.push((cpu.user + cpu.system) / 1000 / elapsed);
}

out({
  status: 'ok',
  samples,
  cpuShares,
  warmupOps,
  check: firstCheck,
  checkAfter: check?.(),
  versions: impl.versions,
});
