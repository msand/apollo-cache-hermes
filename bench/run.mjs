// Runs the scenarios against the implementations and prints (or writes) a
// Markdown report with confidence intervals and significance tests. See
// bench/README.md for the method.
//
//   npm run bench                         # all scenarios and implementations, 25 rounds
//   npm run bench -- --write              # also write bench/RESULTS.md
//   npm run bench -- --quick              # 3 rounds, for trying things out
//   npm run bench -- --impls hermes-0.11.0,hermes-branch --scenarios read.hit,read.afterWrite
//   npm run bench -- --rounds 30 --max-rounds 60   # more rounds; more for inconclusive scenarios
//   npm run bench -- --report bench/results.json --write   # report a saved run again
//   npm run bench -- --impls hermes-branch --merge bench/results.json --write
//                                         # re-measure one column, keep the others (not interleaved!)
//
// Options: --drop-load <n> (default: 3 × the number of CPU cores) and
// --min-cpu-share <x> (default 0.9) drop observations taken under contention;
// --max-load <n> pauses before each worker while the 1-minute load average is
// above n; --seed <n> fixes the shuffles; --json <file> saves the raw
// observations (default bench/results.json, git-ignored).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HERMES_LINEAGE, IMPLS } from './impls.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { SIZES, rng } from './fixtures.mjs';
import { compare, cv, median, medianCI } from './stats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const quick = flag('quick');
const rounds = Number(option('rounds', quick ? 3 : 25));
const maxRounds = Number(option('max-rounds', quick ? rounds : 50));
const impls = option('impls', Object.keys(IMPLS).join(',')).split(',');
const scenarios = option('scenarios', SCENARIOS.map(s => s.name).join(',')).split(',');
const maxLoad = Number(option('max-load', Infinity));
const flagLoad = os.cpus().length;
const dropLoad = Number(option('drop-load', 3 * os.cpus().length));
const minCpuShare = Number(option('min-cpu-share', 0.9));
const seed = Number(option('seed', Date.now() % 1e9));
const jsonFile = option('json', path.join(here, 'results.json'));
const workerArgs = [
  '--warmup-ms',
  option('warmup-ms', quick ? '150' : '300'),
  '--samples',
  option('samples', '5'),
  '--sample-ms',
  option('sample-ms', quick ? '50' : '100'),
];
for (const name of [...impls, ...scenarios]) {
  if (!IMPLS[name] && !SCENARIOS.some(s => s.name === name))
    throw new Error(`Unknown implementation or scenario ${name}`);
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitForLoad() {
  let waited = false;
  while (os.loadavg()[0] > maxLoad) {
    process.stderr.write(waited ? '.' : `load ${os.loadavg()[0].toFixed(1)} > ${maxLoad}; waiting`);
    waited = true;
    sleep(15_000);
  }
  if (waited) process.stderr.write('\n');
}

// ---------------------------------------------------------------------------
// Measure (or load a saved run).

// run.results[scenario][impl] = { obs: [{ ms, load, cpuShare, round }], na?, versions, check }
let run;
if (option('report')) {
  run = JSON.parse(fs.readFileSync(option('report'), 'utf8'));
} else {
  run = { started: new Date(), node: process.version, seed, workerArgs, results: {} };
  const random = rng(seed);
  const shuffle = xs => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  const entryFor = (scenario, impl) => ((run.results[scenario] ??= {})[impl] ??= { obs: [] });

  const measure = (pairs, round, label) => {
    // Every (scenario, implementation) pair once, in a fresh random order.
    shuffle(pairs);
    let done = 0;
    for (const [scenario, impl] of pairs) {
      const entry = entryFor(scenario, impl);
      if (entry.na) continue;
      waitForLoad();
      const loadBefore = os.loadavg()[0];
      const child = spawnSync(process.execPath, [path.join(here, 'worker.mjs'), impl, scenario, ...workerArgs], {
        encoding: 'utf8',
        maxBuffer: 1 << 24,
      });
      const loadAfter = os.loadavg()[0];
      let result;
      try {
        result = JSON.parse(child.stdout.trim().split('\n').pop());
      } catch {
        result = { status: 'n/a', error: (child.stderr || `exit ${child.status}`).trim().split('\n')[0] };
      }
      entry.versions = result.versions;
      entry.check = result.checkAfter ?? result.check;
      if (result.status !== 'ok') {
        entry.na = result.error;
        process.stderr.write(`${scenario} ${impl}: n/a (${result.error})\n`);
        continue;
      }
      const load = Math.max(loadBefore, loadAfter);
      const cpuShare = median(result.cpuShares);
      const obs = { ms: median(result.samples), load, cpuShare, round };
      entry.obs.push(obs);
      done++;
    }
    process.stderr.write(`${label}: ${done} observations, load ${os.loadavg()[0].toFixed(1)}\n`);
  };

  const allPairs = () => scenarios.flatMap(s => impls.map(i => [s, i]));
  for (let round = 0; round < rounds; round++) measure(allPairs(), round, `round ${round + 1}/${rounds}`);

  // Extra rounds, only for the scenarios with an inconclusive Hermes
  // comparison (or too few kept observations), up to --max-rounds.
  for (let round = rounds; round < maxRounds; round++) {
    const pending = scenarios.filter(scenario =>
      comparisons(impls).some(([a, b]) => {
        const ea = run.results[scenario]?.[a];
        const eb = run.results[scenario]?.[b];
        if (!ea || !eb || ea.na || eb.na) return false;
        const ka = kept(ea);
        const kb = kept(eb);
        if (ka.length < rounds * 0.6 || kb.length < rounds * 0.6) return true;
        return compare(ka, kb).verdict === 'inconclusive';
      }),
    );
    if (!pending.length) break;
    const involved = new Set(comparisons(impls).flat());
    measure(
      pending.flatMap(s => impls.filter(i => involved.has(i)).map(i => [s, i])),
      round,
      `extra round ${round + 1}/${maxRounds} (${pending.join(', ')})`,
    );
  }
  run.finished = new Date();

  const mergeFile = option('merge');
  if (mergeFile) {
    const merged = JSON.parse(fs.readFileSync(mergeFile, 'utf8'));
    run.merged = { file: mergeFile, started: merged.started, impls: [] };
    for (const scenario of scenarios) {
      for (const [impl, entry] of Object.entries(merged.results[scenario] ?? {})) {
        if (!impls.includes(impl) && IMPLS[impl]) {
          (run.results[scenario] ??= {})[impl] = entry;
          if (!run.merged.impls.includes(impl)) run.merged.impls.push(impl);
        }
      }
    }
  }
  fs.writeFileSync(jsonFile, JSON.stringify(run, null, 1));
}

function kept(entry) {
  return entry.obs.filter(o => !isDropped(o)).map(o => o.ms);
}

/** Observations taken under very high load, or while the worker did not get a full CPU, are dropped. */
function isDropped(o) {
  return o.load > dropLoad || o.cpuShare < minCpuShare;
}

/**
 * The pairs [older, newer] to test: consecutive Hermes versions, this branch
 * against 0.11.0, and this branch against InMemoryCache 4 (the target to beat).
 */
function comparisons(columns) {
  const lineage = HERMES_LINEAGE.filter(i => columns.includes(i));
  const pairs = lineage.slice(1).map((b, k) => [lineage[k], b]);
  if (columns.includes('hermes-0.11.0') && columns.includes('hermes-branch')) {
    if (!pairs.some(([a, b]) => a === 'hermes-0.11.0' && b === 'hermes-branch'))
      pairs.push(['hermes-0.11.0', 'hermes-branch']);
  }
  if (columns.includes('inmemory-4') && columns.includes('hermes-branch')) pairs.push(['inmemory-4', 'hermes-branch']);
  return pairs;
}

// ---------------------------------------------------------------------------
// Report.

const reportScenarios = SCENARIOS.map(s => s.name).filter(s => run.results[s]);
const columns = Object.keys(IMPLS).filter(i => reportScenarios.some(s => run.results[s][i]));
const short = impl =>
  IMPLS[impl].label
    .split(' +')[0]
    .replace(' (before review fixes)', ' (pre-review)')
    .replace(' (before performance work)', ' (pre-perf)');

const fmtMs = ms =>
  ms >= 100
    ? ms.toFixed(0)
    : ms >= 10
      ? ms.toFixed(1)
      : ms >= 1
        ? ms.toFixed(2)
        : ms >= 0.01
          ? ms.toFixed(3)
          : ms.toPrecision(2);
const fmtPct = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const fmtP = p => (p < 1e-4 ? '<1e-4' : p.toPrecision(2));

const timeLines = [
  '| Scenario | ' + columns.map(i => IMPLS[i].label).join(' | ') + ' |',
  '| --- | ' + columns.map(() => '---:').join(' | ') + ' |',
];
const cvLines = [
  '| Scenario | ' + columns.map(short).join(' | ') + ' |',
  '| --- | ' + columns.map(() => '---:').join(' | ') + ' |',
];
for (const scenario of reportScenarios) {
  const cells = [];
  const cvCells = [];
  for (const impl of columns) {
    const entry = run.results[scenario][impl];
    if (!entry) {
      cells.push('');
      cvCells.push('');
    } else if (entry.na) {
      cells.push('n/a');
      cvCells.push('n/a');
    } else if (!kept(entry).length) {
      cells.push('all dropped');
      cvCells.push(`(${entry.obs.length} dropped)`);
    } else {
      const xs = kept(entry);
      const [lo, hi] = medianCI(xs);
      cells.push(`**${fmtMs(median(xs))}** [${fmtMs(lo)}–${fmtMs(hi)}]`);
      cvCells.push(`${(cv(xs) * 100).toFixed(1)}% (n=${xs.length}, ${entry.obs.length - xs.length} dropped)`);
    }
  }
  timeLines.push(`| \`${scenario}\` | ${cells.join(' | ')} |`);
  cvLines.push(`| \`${scenario}\` | ${cvCells.join(' | ')} |`);
}

const pairs = comparisons(columns);
const verdicts = [];
const cmpLines = [
  '| Scenario | ' + pairs.map(([a, b]) => `${short(a)} → ${short(b)}`).join(' | ') + ' |',
  '| --- | ' + pairs.map(() => '---').join(' | ') + ' |',
];
for (const scenario of reportScenarios) {
  const cells = pairs.map(([a, b]) => {
    const ea = run.results[scenario][a];
    const eb = run.results[scenario][b];
    if (!ea || !eb || ea.na || eb.na) return 'n/a';
    if (kept(ea).length < 3 || kept(eb).length < 3) return 'too few observations';
    const result = compare(kept(ea), kept(eb));
    verdicts.push({ scenario, a, b, ...result });
    const text = `${fmtPct(result.change)} [${fmtPct(result.ci[0])}, ${fmtPct(result.ci[1])}] p=${fmtP(result.p)} ${result.verdict}`;
    return result.verdict === 'regression' || result.verdict === 'improvement' ? `**${text}**` : text;
  });
  cmpLines.push(`| \`${scenario}\` | ${cells.join(' | ')} |`);
}

const allObs = reportScenarios.flatMap(s => Object.values(run.results[s]).flatMap(e => e.obs));
const loads = allObs.map(o => o.load);
const shares = allObs.map(o => o.cpuShare);
const droppedLoad = allObs.filter(o => o.load > dropLoad).length;
const droppedCpu = allObs.filter(o => o.cpuShare < minCpuShare).length;
const dropped = allObs.filter(isDropped).length;
const flagged = allObs.filter(o => !isDropped(o) && o.load > flagLoad).length;

const naNotes = [];
for (const scenario of reportScenarios) {
  for (const impl of columns) {
    const entry = run.results[scenario][impl];
    if (entry?.na) naNotes.push(`- \`${scenario}\` on ${IMPLS[impl].label}: ${entry.na}`);
  }
}
const versionLines = columns.map(i => {
  const v = reportScenarios.map(s => run.results[s][i]?.versions).find(Boolean) ?? {};
  return `- **${IMPLS[i].label}**: ${Object.entries(v)
    .map(([k, x]) => `${k}@${x}`)
    .join(', ')}`;
});
const summary = verdicts.filter(
  v => v.verdict === 'regression' || v.verdict === 'improvement' || v.verdict === 'inconclusive',
);

console.log(timeLines.join('\n'));
console.log('\n' + cmpLines.join('\n'));
console.log(
  `\n${allObs.length} observations; dropped ${dropped} (load > ${dropLoad}: ${droppedLoad}, CPU share < ${minCpuShare}: ${droppedCpu}); kept with load > ${flagLoad}: ${flagged}.`,
);
for (const v of summary) {
  console.log(`${v.verdict}: ${v.scenario} ${short(v.a)} → ${short(v.b)} ${fmtPct(v.change)} (p=${fmtP(v.p)})`);
}

if (flag('write')) {
  const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
  const started = new Date(run.started);
  const roundsRun = Math.max(...allObs.map(o => o.round)) + 1;
  const scenarioLines = SCENARIOS.filter(s => reportScenarios.includes(s.name)).map(
    s => `| \`${s.name}\` | ${s.description} |`,
  );
  const md = `# Hermes benchmark results

Generated by \`npm run bench -- --write\`; the method is in [README.md](README.md). Times are ms per operation
(lower is better).

- **Date:** ${started.toISOString().slice(0, 16).replace('T', ' ')} UTC (run took ${Math.round((new Date(run.finished) - started) / 60000)} min)
- **Machine:** ${cpu}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${os.type()} ${os.release()} (${os.arch()}); shared with other workloads during the run
- **Node:** ${run.node}, \`NODE_ENV=production\`, \`__DEV__ = false\`
- **Rounds:** ${roundsRun} (base rounds, plus extra rounds for scenarios with inconclusive comparisons); worker: \`${run.workerArgs.join(' ')}\`; shuffle seed ${run.seed}
- **Load (1-min average) per observation:** median ${median(loads).toFixed(1)}, max ${Math.max(...loads).toFixed(1)}; CPU share median ${median(shares).toFixed(2)}, min ${Math.min(...shares).toFixed(2)}
- **Dropped observations:** ${dropped} of ${allObs.length} (load above ${dropLoad}: ${droppedLoad}; CPU share below ${minCpuShare}: ${droppedCpu}). Kept but flagged (load above the ${flagLoad} cores): ${flagged}${
    run.merged
      ? `\n- **Merged:** ${run.merged.impls.map(i => IMPLS[i].label).join(', ')} come from an earlier run (${run.merged.started}), so they are not interleaved with the other columns.`
      : ''
  }
- **Sizes:** dashboard of ${SIZES.projects} projects × ${SIZES.tasksPerProject} tasks × ${SIZES.commentsPerTask} comments, ${SIZES.users} users, ${SIZES.tags} tags (3,302 entities); feed of ${SIZES.feedItems} union items; ${SIZES.pages} pages × ${SIZES.pageSize}; ${SIZES.watches} watches; ${SIZES.cycleNodes}-node cycles.

## Median ms per operation [95% bootstrap CI]

${timeLines.join('\n')}

## Comparisons

Change of the newer version's median against the older one's, [95% bootstrap CI of the change], Mann-Whitney U
p-value, and verdict: **regression**/**improvement** = p < 0.01 and at least 10%; minor slowdown/speedup =
p < 0.01 and 5–10%; within 5% = significant but under 5%; inconclusive = not significant, but the CI still allows a
change of 10% or more; no significant change = neither. Each step also changes the Apollo Client version (see
Versions); only 0.9.12 → 0.10.0, 4946e9c8 → this branch and InMemoryCache 4 → this branch keep it. A
regression of this branch against InMemoryCache 4 means it is slower than InMemoryCache.

${cmpLines.join('\n')}

## Spread: coefficient of variation (kept observations, dropped observations)

${cvLines.join('\n')}
${naNotes.length ? `\n## Not applicable\n\n${naNotes.join('\n')}\n` : ''}
## Versions

${versionLines.join('\n')}

## Scenarios

| Scenario | Operation timed |
| --- | --- |
${scenarioLines.join('\n')}
`;
  fs.writeFileSync(path.join(here, 'RESULTS.md'), md);
  console.log('\nWrote bench/RESULTS.md');
}
