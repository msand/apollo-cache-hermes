#!/usr/bin/env node
// Checks the source map references of the files `npm pack` would publish
// (after `npm run compile`):
//
// - every published .js file references a published .js.map file;
// - every such map is valid, maps that file, and embeds the content of every
//   source it maps from (the .ts sources aren't published);
// - no published .d.ts file references a map (declaration maps would point
//   at the unpublished .ts sources).
//
//   node scripts/check-package-maps.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }),
);
const published = new Set(pack.files.map(file => file.path));
const problems = [];

/** The target of a file's (last) sourceMappingURL comment, if any. */
function sourceMappingUrl(file) {
  const matches = [...readFileSync(file, 'utf8').matchAll(/^\/\/# sourceMappingURL=(.+)$/gm)];
  return matches.length ? matches[matches.length - 1][1].trim() : undefined;
}

let checkedMaps = 0;
for (const file of published) {
  if (file.endsWith('.d.ts')) {
    const url = sourceMappingUrl(file);
    if (url) problems.push(`${file} references ${url} (declaration maps point at unpublished sources)`);
  } else if (file.endsWith('.js')) {
    const url = sourceMappingUrl(file);
    if (!url) {
      problems.push(`${file} has no source map`);
      continue;
    }
    if (url.startsWith('data:')) {
      problems.push(`${file} has an inline source map (maps are published as .js.map files)`);
      continue;
    }
    const mapFile = path.posix.join(path.posix.dirname(file), url);
    if (!published.has(mapFile)) {
      problems.push(`${file} references ${mapFile}, which isn't published`);
      continue;
    }
    let map;
    try {
      map = JSON.parse(readFileSync(mapFile, 'utf8'));
    } catch (error) {
      problems.push(`${mapFile} isn't valid JSON: ${error.message}`);
      continue;
    }
    if (map.version !== 3) problems.push(`${mapFile} isn't a version 3 source map`);
    if (map.file !== path.posix.basename(file)) problems.push(`${mapFile} maps ${map.file}, not ${file}`);
    if (!map.sources?.length) problems.push(`${mapFile} has no sources`);
    map.sources?.forEach((source, i) => {
      if (typeof map.sourcesContent?.[i] !== 'string') problems.push(`${mapFile} doesn't embed ${source}`);
    });
    checkedMaps++;
  }
}

if (problems.length) {
  console.error(`Source map problems in the package:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log(`${checkedMaps} source maps checked, ${published.size} files in the package`);
