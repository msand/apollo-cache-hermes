// Runs every scenario against every implementation and prints (or writes) a
// Markdown report. Each (implementation, scenario, round) runs in a fresh
// worker process (bench/worker.mjs); rounds rotate the implementation order.
//
//   npm run bench                                # all scenarios, 5 rounds, print
//   npm run bench -- --write                     # also write bench/RESULTS.md
//   npm run bench -- --quick                     # 1 round, short samples
//   npm run bench -- --impls hermes-0.11.0,hermes-branch --scenarios read.hit,read.afterWrite
//   npm run bench -- --max-load 3                # wait while the 1-min load average is above 3
//   npm run bench -- --impls hermes-branch --merge bench/results.json --write
//                                                # re-measure one column, keep the others
//
// The raw samples are saved to bench/results.json (or --json <file>; git-ignored).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HERMES_LINEAGE, IMPLS } from './impls.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { SIZES } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const quick = flag('quick');
const rounds = Number(option('rounds', quick ? 1 : 5));
const impls = option('impls', Object.keys(IMPLS).join(',')).split(',');
const scenarios = option('scenarios', SCENARIOS.map(s => s.name).join(',')).split(',');
const maxLoad = Number(option('max-load', Infinity));
const workerArgs = quick
  ? ['--warmup-ms', '200', '--samples', '5', '--sample-ms', '60']
  : [
      '--warmup-ms',
      option('warmup-ms', '500'),
      '--samples',
      option('samples', '10'),
      '--sample-ms',
      option('sample-ms', '150'),
    ];
const regressionThreshold = 0.1;

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const loads = [];
function waitForQuiet() {
  let waited = false;
  while (os.loadavg()[0] > maxLoad) {
    if (!waited) process.stderr.write(`load ${os.loadavg()[0].toFixed(2)} > ${maxLoad}; waiting`);
    else process.stderr.write('.');
    waited = true;
    sleep(15_000);
  }
  if (waited) process.stderr.write('\n');
  loads.push(os.loadavg()[0]);
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cv = xs => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return sd / mean;
};

// results[scenario][impl] = { roundMedians: [], samples: [], na, versions, check }
const results = {};
const started = new Date();
for (let round = 0; round < rounds; round++) {
  for (const scenario of scenarios) {
    results[scenario] ??= {};
    const order = impls.map((_, i) => impls[(i + round) % impls.length]);
    for (const impl of order) {
      const entry = (results[scenario][impl] ??= { roundMedians: [], samples: [] });
      if (entry.na) continue;
      waitForQuiet();
      const child = spawnSync(process.execPath, [path.join(here, 'worker.mjs'), impl, scenario, ...workerArgs], {
        encoding: 'utf8',
        maxBuffer: 1 << 24,
      });
      const line = child.stdout.trim().split('\n').pop();
      let result;
      try {
        result = JSON.parse(line);
      } catch {
        result = { status: 'n/a', error: (child.stderr || line || `exit ${child.status}`).trim().split('\n')[0] };
      }
      entry.versions = result.versions;
      entry.check = result.checkAfter ?? result.check;
      if (result.status !== 'ok') {
        entry.na = result.error;
        process.stderr.write(`round ${round + 1}/${rounds} ${scenario} ${impl}: n/a (${result.error})\n`);
        continue;
      }
      entry.roundMedians.push(median(result.samples));
      entry.samples.push(result.samples);
      process.stderr.write(
        `round ${round + 1}/${rounds} ${scenario.padEnd(24)} ${impl.padEnd(14)} ${median(result.samples).toFixed(4)} ms/op\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Merge the columns of a previous run (--merge <results.json>) that this run
// did not measure, e.g. to re-measure only this branch after a change.

const mergeFile = option('merge');
let merged;
if (mergeFile) {
  merged = JSON.parse(fs.readFileSync(mergeFile, 'utf8'));
  for (const scenario of scenarios) {
    for (const [impl, entry] of Object.entries(merged.results[scenario] ?? {})) {
      if (!impls.includes(impl) && IMPLS[impl]) (results[scenario] ??= {})[impl] = entry;
    }
  }
}
const columns = Object.keys(IMPLS).filter(i => impls.includes(i) || scenarios.some(s => results[s]?.[i]));

// ---------------------------------------------------------------------------
// Report.

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
const cell = entry => {
  if (!entry) return '';
  if (entry.na) return 'n/a';
  return `${fmtMs(median(entry.roundMedians))} ±${(cv(entry.roundMedians) * 100).toFixed(0)}%`;
};
const value = entry => (entry && !entry.na && entry.roundMedians.length ? median(entry.roundMedians) : undefined);

const lines = [];
lines.push('| Scenario | ' + columns.map(i => IMPLS[i].label).join(' | ') + ' |');
lines.push('| --- | ' + columns.map(() => '---:').join(' | ') + ' |');
for (const scenario of scenarios) {
  lines.push(`| \`${scenario}\` | ` + columns.map(i => cell(results[scenario][i])).join(' | ') + ' |');
}
const table = lines.join('\n');

// Change between consecutive Hermes versions (only those that ran).
const lineage = HERMES_LINEAGE.filter(i => columns.includes(i));
const steps = lineage.slice(1).map((to, k) => [lineage[k], to]);
const flags = [];
const changeLines = [];
if (steps.length) {
  changeLines.push(
    '| Scenario | ' +
      steps.map(([a, b]) => `${IMPLS[a].label.split(' +')[0]} → ${IMPLS[b].label.split(' +')[0]}`).join(' | ') +
      ' |',
  );
  changeLines.push('| --- | ' + steps.map(() => '---:').join(' | ') + ' |');
  for (const scenario of scenarios) {
    const cells = steps.map(([a, b]) => {
      const va = value(results[scenario][a]);
      const vb = value(results[scenario][b]);
      if (va === undefined || vb === undefined) return 'n/a';
      const change = vb / va - 1;
      const text = `${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}%`;
      if (change > regressionThreshold) {
        flags.push({ scenario, from: a, to: b, change });
        return `**${text}**`;
      }
      return text;
    });
    changeLines.push(`| \`${scenario}\` | ${cells.join(' | ')} |`);
  }
}
const changeTable = changeLines.join('\n');

const naNotes = [];
for (const scenario of scenarios) {
  for (const impl of columns) {
    const entry = results[scenario][impl];
    if (entry?.na) naNotes.push(`- \`${scenario}\` on ${IMPLS[impl].label}: ${entry.na}`);
  }
}

const versionLines = columns.map(i => {
  const v = Object.values(results).find(r => r[i]?.versions)?.[i]?.versions ?? {};
  return `- **${IMPLS[i].label}**: ${Object.entries(v)
    .map(([k, x]) => `${k}@${x}`)
    .join(', ')}`;
});

console.log(table);
if (changeTable) {
  console.log('\nChange in ms/op between consecutive Hermes versions (positive = slower):\n');
  console.log(changeTable);
}
if (naNotes.length) console.log('\n' + naNotes.join('\n'));

fs.writeFileSync(
  option('json', path.join(here, 'results.json')),
  JSON.stringify({ started, finished: new Date(), node: process.version, loads, workerArgs, rounds, results }, null, 2),
);

if (flag('write')) {
  const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
  const scenarioLines = SCENARIOS.filter(s => scenarios.includes(s.name)).map(
    s => `| \`${s.name}\` | ${s.description} |`,
  );
  const md = `# Hermes benchmark results

Generated by \`npm run bench -- --write\` (bench/run.mjs). Lower is better.

- **Date:** ${started.toISOString().slice(0, 10)}
- **Machine:** ${cpu}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${os.type()} ${os.release()} (${os.arch()})
- **Node:** ${process.version}, \`NODE_ENV=production\`, \`__DEV__ = false\`
- **Method:** each (implementation, scenario) runs in a fresh process: ${workerArgs.join(' ')}
  (warm-up, then samples of whole operations, each at least the sample time). Repeated for ${rounds} rounds with the
  implementation order rotated. A cell is the **median over rounds of each round's median ms/op**, and ± the
  coefficient of variation of the round medians.
- **Load average (1 min) before each worker:** median ${median(loads).toFixed(2)}, max ${Math.max(...loads).toFixed(2)}${
    merged
      ? `\n- **Merged:** the columns not measured in this run come from a run started ${merged.started} (load median ${median(merged.loads).toFixed(2)}, max ${Math.max(...merged.loads).toFixed(2)}).`
      : ''
  }
- **Sizes:** dashboard of ${SIZES.projects} projects × ${SIZES.tasksPerProject} tasks × ${SIZES.commentsPerTask} comments, ${SIZES.users} users, ${SIZES.tags} tags (3,302 entities); feed of ${SIZES.feedItems} union items; ${SIZES.pages} pages × ${SIZES.pageSize}; ${SIZES.watches} watches; ${SIZES.cycleNodes}-node cycles.

## ms per operation

${table}

## Change between consecutive Hermes versions

Positive is slower; changes over ${regressionThreshold * 100}% are bold. Each step also changes the Apollo Client
version (see versions below), and 0.9.12 → 0.10.0 is the only step with the same Apollo Client.

${changeTable}

${naNotes.length ? `## Not applicable\n\n${naNotes.join('\n')}\n` : ''}
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
if (flags.length) {
  console.log(
    `\n${flags.length} regression(s) over ${regressionThreshold * 100}% between consecutive Hermes versions.`,
  );
}
