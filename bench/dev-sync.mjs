// Copies a checkout's compiled src/ (run `npm run compile` first) over the
// Hermes package of a copy of bench/impl/hermes-branch (created on first use),
// to try out changes without re-packing:
//
//   npm run compile && node bench/dev-sync.mjs           # into hermes-dev
//   node bench/dev-sync.mjs hermes-prev ../other-checkout   # e.g. a build to compare against
//   npm run bench -- --impls hermes-prev,hermes-dev,inmemory-4 --quick
//
// It refuses to copy a build older than its sources (a .ts file newer than its
// .js), and records the checkout's commit (with +dirty if src/ has uncommitted
// changes) in the copy's BUILD_COMMIT, like bench/setup.mjs.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [name = 'hermes-dev', checkout = path.join(here, '..')] = process.argv.slice(2);
const src = path.join(checkout, 'src');

const stale = [];
(function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      const js = file.replace(/\.ts$/, '.js');
      if (!fs.existsSync(js) || fs.statSync(js).mtimeMs < fs.statSync(file).mtimeMs)
        stale.push(path.relative(src, file));
    }
  }
})(src);
if (stale.length) {
  console.error(`The build of ${src} is older than its sources (${stale.join(', ')}); run \`npm run compile\` first.`);
  process.exit(1);
}

const dev = path.join(here, 'impl', name);
if (!fs.existsSync(dev)) {
  const branch = path.join(here, 'impl', 'hermes-branch');
  if (!fs.existsSync(branch)) throw new Error('Run `npm run bench:setup -- hermes-branch` first');
  fs.cpSync(branch, dev, { recursive: true });
}
const target = path.join(dev, 'node_modules', 'msand-apollo-cache-hermes', 'src');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(src, target, {
  recursive: true,
  filter: source => fs.statSync(source).isDirectory() || /\.(js|d\.ts)$/.test(source),
});

const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
let commit = 'unknown';
try {
  commit = git('rev-parse', 'HEAD') + (git('status', '--porcelain', '--', 'src') ? '+dirty' : '');
} catch {
  // Not a git checkout.
}
fs.writeFileSync(path.join(dev, 'BUILD_COMMIT'), commit + '\n');
console.log(`Copied ${path.relative(process.cwd(), src)} (${commit}) to ${path.relative(process.cwd(), target)}`);
