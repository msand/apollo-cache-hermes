// Copies a checkout's compiled src/ (run `npm run compile` first) over the
// Hermes package of a copy of bench/impl/hermes-branch (created on first use),
// to try out changes without re-packing:
//
//   npm run compile && node bench/dev-sync.mjs           # into hermes-dev
//   node bench/dev-sync.mjs hermes-prev ../other-checkout   # e.g. a build to compare against
//   npm run bench -- --impls hermes-prev,hermes-dev,inmemory-4 --quick

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [name = 'hermes-dev', checkout = path.join(here, '..')] = process.argv.slice(2);
const dev = path.join(here, 'impl', name);
if (!fs.existsSync(dev)) {
  const branch = path.join(here, 'impl', 'hermes-branch');
  if (!fs.existsSync(branch)) throw new Error('Run `npm run bench:setup -- hermes-branch` first');
  fs.cpSync(branch, dev, { recursive: true });
}
const target = path.join(dev, 'node_modules', 'msand-apollo-cache-hermes', 'src');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(checkout, 'src'), target, {
  recursive: true,
  filter: source => fs.statSync(source).isDirectory() || /\.(js|d\.ts)$/.test(source),
});
console.log(
  `Copied ${path.relative(process.cwd(), path.join(checkout, 'src'))} to ${path.relative(process.cwd(), target)}`,
);
