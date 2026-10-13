// Installs the implementations under comparison, each into its own folder
// under bench/impl/ (their node_modules, tarballs and lockfiles are
// git-ignored; their package.json files pin exact versions).
//
//   npm run bench:setup            # build + pack this checkout, install everything
//   npm run bench:setup -- --skip-build   # reinstall without rebuilding src/
//   npm run bench:setup -- hermes-branch  # only the named implementations
//
// This checkout's Hermes is compiled (tsc emits src/*.js), packed with
// `npm pack` (no lifecycle scripts), and installed like a published release,
// so it resolves its own @apollo/client 4 from bench/impl/hermes-branch.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
// (hermes-dev is a copy of hermes-branch made by bench/dev-sync.mjs.)
const names = only.length ? only : Object.keys(IMPLS).filter(name => name !== 'hermes-dev');
for (const name of names) {
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
  } else if (IMPLS[name].ref && !fs.existsSync(tarball)) {
    // Build a fixed commit of this repository: export its sources (no git
    // worktree), compile them with this checkout's node_modules, and pack.
    const commit = run('git', ['rev-parse', `${IMPLS[name].ref}^{commit}`], root).trim();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-${commit.slice(0, 8)}-`));
    try {
      const archive = execFileSync(
        'git',
        ['archive', commit, 'src', 'typings', 'tsconfig.json', 'package.json', 'README.md'],
        {
          cwd: root,
          maxBuffer: 1 << 28,
        },
      );
      execFileSync('tar', ['-x', '-C', tmp], { input: archive });
      fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(tmp, 'node_modules'));
      run('npx', ['tsc', '-p', '.'], tmp);
      const packed = run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], tmp)
        .trim()
        .split('\n')
        .pop();
      fs.renameSync(path.join(dir, packed), tarball);
      fs.writeFileSync(path.join(dir, 'BUILD_COMMIT'), commit + '\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else if (published[name] && !fs.existsSync(tarball)) {
    const packed = run(
      'npm',
      // (Releases of this package itself are exempt from a min-release-age in
      // the npm config; their dependencies are installed as configured.)
      ['pack', `msand-apollo-cache-hermes@${published[name]}`, '--ignore-scripts', '--silent', '--min-release-age=0'],
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
console.log('Installed:', names.join(', '));
