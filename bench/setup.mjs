// Installs the implementations under comparison, each into its own folder
// under bench/impl/ (their node_modules, tarballs and lockfiles are
// git-ignored; their package.json files pin exact versions).
//
//   npm run bench:setup            # build + pack this checkout, install everything
//   npm run bench:setup -- --skip-build   # reinstall without rebuilding src/
//
// This checkout's Hermes is compiled (tsc emits src/*.js), packed with
// `npm pack` (no lifecycle scripts), and installed like a published release,
// so it resolves its own @apollo/client 4 from bench/impl/hermes-branch.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IMPLS, implDir } from './impls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const skipBuild = process.argv.includes('--skip-build');

const run = (cmd, args, cwd) => {
  console.log(`$ (${path.relative(root, cwd) || '.'}) ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
};

// Published Hermes releases: fetch their tarballs once.
const published = { 'hermes-0.9.12': '0.9.12', 'hermes-0.10.0': '0.10.0', 'hermes-0.11.0': '0.11.0' };

for (const name of Object.keys(IMPLS)) {
  const dir = implDir(name);
  const tarball = path.join(dir, 'hermes.tgz');
  if (name === 'hermes-branch') {
    if (!skipBuild) {
      run('npx', ['tsc', '-p', '.'], root);
      const packed = run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], root)
        .trim()
        .split('\n')
        .pop();
      fs.renameSync(path.join(dir, packed), tarball);
      const commit = run('git', ['rev-parse', 'HEAD'], root).trim();
      const dirty = run('git', ['status', '--porcelain', '--', 'src'], root).trim() ? '+dirty' : '';
      fs.writeFileSync(path.join(dir, 'BUILD_COMMIT'), commit + dirty + '\n');
    }
  } else if (published[name] && !fs.existsSync(tarball)) {
    const packed = run(
      'npm',
      ['pack', `msand-apollo-cache-hermes@${published[name]}`, '--ignore-scripts', '--silent'],
      dir,
    )
      .trim()
      .split('\n')
      .pop();
    fs.renameSync(path.join(dir, packed), tarball);
  }
  // Remove a previous install of the tarball, so a rebuilt one is picked up.
  fs.rmSync(path.join(dir, 'node_modules', 'msand-apollo-cache-hermes'), { recursive: true, force: true });
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], dir);
}
console.log('Installed:', Object.keys(IMPLS).join(', '));
