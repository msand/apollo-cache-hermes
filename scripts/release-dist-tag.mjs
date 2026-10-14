#!/usr/bin/env node
// Prints the npm dist-tag to publish package.json's version under (see
// .github/workflows/release.yml):
//
// - next, for prereleases (e.g. 1.0.0-beta.1);
// - latest, for a version higher than every published (stable) version;
// - release-X.Y, for other versions, e.g. a 0.10.2 patch published after
//   0.12.0, so that `latest` never moves back to an older line.
//
// Fails if the version is already published.
//
//   node scripts/release-dist-tag.mjs [version]   # (defaults to package.json's)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.argv[2] ?? manifest.version;

/** The numeric parts and prerelease of a version, or undefined if it isn't one. */
function parse(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  return match && { parts: match.slice(1, 4).map(Number), prerelease: match[4] };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  return 0;
}

const current = parse(version);
if (!current) {
  console.error(`Not a version: ${version}`);
  process.exit(1);
}

let published = [];
try {
  published = [].concat(
    JSON.parse(execFileSync('npm', ['view', manifest.name, 'versions', '--json'], { encoding: 'utf8' })),
  );
} catch (error) {
  // (A package that was never published has no versions.)
  if (!String(error.stdout ?? '').includes('E404')) throw error;
}
if (published.includes(version)) {
  console.error(`${manifest.name}@${version} is already published`);
  process.exit(1);
}

let tag;
if (current.prerelease) {
  tag = 'next';
} else {
  const highest = published
    .map(parse)
    .filter(parsed => parsed && !parsed.prerelease)
    .sort(compare)
    .pop();
  tag = !highest || compare(current, highest) > 0 ? 'latest' : `release-${current.parts[0]}.${current.parts[1]}`;
}
console.log(tag);
