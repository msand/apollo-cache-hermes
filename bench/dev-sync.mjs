// Copies this checkout's compiled src/ (run `npm run compile` first) over the
// Hermes package in bench/impl/hermes-dev, a copy of bench/impl/hermes-branch
// (created on first use), to try out changes without re-packing:
//
//   npm run compile && node bench/dev-sync.mjs
//   npm run bench -- --impls hermes-dev,inmemory-4 --quick

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = path.join(here, 'impl', 'hermes-dev');
if (!fs.existsSync(dev)) {
  const branch = path.join(here, 'impl', 'hermes-branch');
  if (!fs.existsSync(branch)) throw new Error('Run `npm run bench:setup -- hermes-branch` first');
  fs.cpSync(branch, dev, { recursive: true });
}
const target = path.join(dev, 'node_modules', 'msand-apollo-cache-hermes', 'src');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(here, '..', 'src'), target, {
  recursive: true,
  filter: source => fs.statSync(source).isDirectory() || /\.(js|d\.ts)$/.test(source),
});
console.log(`Copied src/ to ${path.relative(process.cwd(), target)}`);
