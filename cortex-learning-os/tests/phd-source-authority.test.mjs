import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  currentCommittedIdentity,
} from '../src/git-product-source.mjs';

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
  TZ: 'UTC',
};

function git(cwd, args) {
  const descriptor = fs.openSync(
    '/usr/bin/git',
    fs.constants.O_RDONLY | (fs.constants.O_CLOEXEC || 0),
  );
  let result;
  try {
    result = spawnSync('/proc/self/fd/3', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
      timeout: 10_000,
    });
  } finally {
    fs.closeSync(descriptor);
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      `fixture Git command failed: ${
        result.error?.message || result.stderr || result.stdout || result.status
      }`,
    );
  }
  return result.stdout.trim();
}

test('committed source identity ignores hostile inherited Git repository authority', () => {
  const expected = currentCommittedIdentity();
  const hostileRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-hostile-git-authority-',
  ));
  const inherited = new Map();
  try {
    git(hostileRoot, ['init', '--quiet']);
    fs.mkdirSync(path.join(hostileRoot, 'cortex-learning-os'));
    fs.mkdirSync(
      path.join(hostileRoot, 'plugins', 'cortex-learning-os-live'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(hostileRoot, 'cortex-learning-os', 'hostile.txt'),
      'hostile source authority\n',
    );
    fs.writeFileSync(
      path.join(
        hostileRoot,
        'plugins',
        'cortex-learning-os-live',
        'hostile.txt',
      ),
      'hostile runtime authority\n',
    );
    git(hostileRoot, ['add', '--all']);
    git(hostileRoot, [
      '-c',
      'user.name=Cortex hostile fixture',
      '-c',
      'user.email=hostile-fixture@localhost',
      'commit',
      '--quiet',
      '-m',
      'hostile fixture',
    ]);
    const hostileCommit = git(hostileRoot, [
      'rev-parse',
      '--verify',
      'HEAD^{commit}',
    ]);
    assert.notEqual(hostileCommit, expected.sourceCommit);

    for (const [name, replacement] of [
      ['GIT_DIR', path.join(hostileRoot, '.git')],
      ['GIT_WORK_TREE', hostileRoot],
    ]) {
      inherited.set(name, Object.hasOwn(process.env, name)
        ? process.env[name]
        : undefined);
      process.env[name] = replacement;
    }
    assert.deepEqual(
      currentCommittedIdentity(),
      expected,
      'source authority must not follow caller-selected GIT_DIR/GIT_WORK_TREE',
    );
  } finally {
    for (const [name, previous] of inherited) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    fs.rmSync(hostileRoot, { recursive: true, force: true });
  }
});

test('Git source authority executes one pinned descriptor with a minimal environment', () => {
  const source = fs.readFileSync(
    new URL('../src/git-product-source.mjs', import.meta.url),
    'utf8',
  );
  const gitRunner = source.slice(
    source.indexOf('function git('),
    source.indexOf('function safeRelative('),
  );
  const identityReader = source.slice(
    source.indexOf('export function currentCommittedIdentity'),
    source.indexOf('export function assertCommitTree'),
  );
  assert.match(gitRunner, /execFileSync\(\s*GIT_EXECUTABLE_CHILD_PATH/);
  assert.match(
    gitRunner,
    /stdio: \['ignore', 'pipe', 'pipe', executable[.]descriptor\]/,
  );
  assert.match(gitRunner, /env: GIT_ENVIRONMENT/);
  assert.match(gitRunner, /'core[.]fsmonitor=false'/);
  assert.match(gitRunner, /'core[.]untrackedCache=false'/);
  assert.match(gitRunner, /assertPinnedGitExecutable\(executable\)/);
  assert.doesNotMatch(gitRunner, /process[.]env/);
  assert.match(identityReader, /HEAD\^\{commit\}/);
  assert.match(identityReader, /`\$\{sourceCommit\}\^\{tree\}`/);
  assert.match(identityReader, /`\$\{sourceCommit\}:\$\{PRODUCT_PREFIX\}`/);
  assert.doesNotMatch(identityReader, /HEAD\^\{tree\}|HEAD:\$\{PRODUCT_PREFIX\}/);

  for (const relative of [
    '../src/run-novel-math-validation.mjs',
    '../src/verify-novel-math-artifacts.mjs',
  ]) {
    const consumer = fs.readFileSync(
      new URL(relative, import.meta.url),
      'utf8',
    );
    assert.match(consumer, /currentCommittedIdentity\(\)[.]sourceCommit/);
    assert.doesNotMatch(
      consumer,
      /execFileSync\(['"]git['"]|spawnSync\(['"]git['"]/,
    );
  }
});
