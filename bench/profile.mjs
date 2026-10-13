// Profiles one scenario on one implementation with `node --cpu-prof`, and
// prints the functions with the most self time and the most total (inclusive)
// time, limited to samples taken while the timed op runs.
//
//   node bench/profile.mjs <impl> <scenario> [--top 25] [--keep]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [impl, scenario, ...rest] = process.argv.slice(2);
const top = Number(rest[rest.indexOf('--top') + 1]) || 25;
if (!impl || !scenario) {
  console.error('usage: node bench/profile.mjs <impl> <scenario> [--top 25] [--keep]');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bench-prof-'));
const child = spawnSync(
  process.execPath,
  [
    // E.g. PROFILE_NODE_FLAGS=--no-turbo-inlining, to attribute time to functions that are usually inlined.
    ...(process.env.PROFILE_NODE_FLAGS?.split(' ').filter(Boolean) ?? []),
    '--cpu-prof',
    '--cpu-prof-dir',
    dir,
    '--cpu-prof-interval',
    '100',
    path.join(here, 'worker.mjs'),
    impl,
    scenario,
    '--warmup-ms',
    '300',
    '--samples',
    '20',
    '--sample-ms',
    '150',
  ],
  { encoding: 'utf8' },
);
if (child.status !== 0) {
  console.error(child.stderr);
  process.exit(1);
}
const file = fs.readdirSync(dir).find(f => f.endsWith('.cpuprofile'));
const profile = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

const byId = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

const short = url => {
  const m = url.match(/node_modules\/(.*)$/);
  return m ? m[1].replace(/^\.pnpm\/[^/]+\/node_modules\//, '') : url.replace(/^file:\/\//, '').replace(here, 'bench');
};
const nameOf = n => {
  const { functionName, url, lineNumber } = n.callFrame;
  return `${functionName || '(anonymous)'} ${url ? `${short(url)}:${lineNumber + 1}` : ''}`.trim();
};

// Only count samples whose stack contains the scenario's `op` (the timed region).
const inOp = new Map();
const isOp = n => n.callFrame.functionName === 'op' && n.callFrame.url.endsWith('scenarios.mjs');
const underOp = id => {
  if (inOp.has(id)) return inOp.get(id);
  const n = byId.get(id);
  const value = isOp(n) || (parent.has(id) && underOp(parent.get(id)));
  inOp.set(id, value);
  return value;
};

const self = new Map();
const total = new Map();
let samples = 0;
for (const id of profile.samples) {
  if (!underOp(id)) continue;
  samples++;
  const leaf = nameOf(byId.get(id));
  self.set(leaf, (self.get(leaf) ?? 0) + 1);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const n = byId.get(cur);
    const name = nameOf(n);
    if (!seen.has(name)) {
      seen.add(name);
      total.set(name, (total.get(name) ?? 0) + 1);
    }
    if (isOp(n)) break;
  }
}

const print = (title, map) => {
  console.log(`\n${title}`);
  for (const [name, count] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${((count / samples) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
};
console.log(`${impl} ${scenario}: ${samples} samples inside op`);
print('Self time', self);
print('Total time', total);
if (rest.includes('--keep')) console.log(`\nProfile: ${path.join(dir, file)}`);
else fs.rmSync(dir, { recursive: true, force: true });
