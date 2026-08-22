import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openApprovedModelRuntimeClosureAtDescriptor } from '../src/approved-model-executable.mjs';
import {
  openApprovedResearchRuntimeClosureAtDescriptor,
} from '../src/approved-research-runtime.mjs';
import { sha256Bytes } from '../src/hash.mjs';

const runtimeTypes = [
  {
    entrypointPath: 'codex',
    label: 'model',
    open: openApprovedModelRuntimeClosureAtDescriptor,
  },
  {
    entrypointPath: 'runtime',
    label: 'research',
    open: openApprovedResearchRuntimeClosureAtDescriptor,
  },
];

function runtimeFixture(entrypointPath) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-approved-runtime-'));
  const root = path.join(parent, 'root');
  const bytes = Buffer.from(`exact approved runtime fixture for ${entrypointPath}\n`);
  const uid = process.getuid();
  const gid = process.getgid();
  fs.mkdirSync(root, { mode: 0o755 });
  fs.writeFileSync(path.join(root, entrypointPath), bytes, { mode: 0o555 });
  fs.chmodSync(path.join(root, entrypointPath), 0o555);
  fs.chmodSync(root, 0o555);
  const closure = {
    entries: [
      {
        path: '.',
        role: 'runtime_root',
        type: 'directory',
        uid,
        gid,
        mode: '0555',
      },
      {
        path: entrypointPath,
        role: 'entrypoint',
        type: 'file',
        uid,
        gid,
        mode: '0555',
        bytes: bytes.length,
        sha256: sha256Bytes(bytes),
      },
    ],
  };
  return { bytes, closure, parent, root };
}

function assertMutationRejected(runtimeType, mutate, pattern, {
  resealRoot = true,
} = {}) {
  const fixture = runtimeFixture(runtimeType.entrypointPath);
  let rootDescriptor = null;
  try {
    rootDescriptor = fs.openSync(
      fixture.root,
      fs.constants.O_RDONLY
        | fs.constants.O_DIRECTORY
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = runtimeType.open(rootDescriptor, fixture.closure);
    fs.closeSync(opened.descriptor);
    fs.chmodSync(fixture.root, 0o755);
    mutate(fixture);
    if (resealRoot) fs.chmodSync(fixture.root, 0o555);
    assert.throws(
      () => runtimeType.open(rootDescriptor, fixture.closure),
      pattern,
    );
  } finally {
    if (rootDescriptor !== null) fs.closeSync(rootDescriptor);
    try { fs.chmodSync(fixture.root, 0o755); } catch {}
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
}

for (const runtimeType of runtimeTypes) {
  test(`${runtimeType.label} approved runtime rejects extra empty and mutable subtrees`, () => {
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.mkdirSync(path.join(root, 'extra-empty'), { mode: 0o555 });
    }, /entry set differs from signed closure/);
    assertMutationRejected(runtimeType, ({ root }) => {
      const injected = path.join(root, 'non-root-mutable-subtree');
      fs.mkdirSync(injected, { mode: 0o777 });
      fs.chmodSync(injected, 0o777);
      if (process.geteuid() === 0) fs.chownSync(injected, 65534, 65534);
    }, /entry set differs from signed closure/);
  });

  test(`${runtimeType.label} approved runtime rejects symlink and special-mode substitutions`, () => {
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.symlinkSync(runtimeType.entrypointPath, path.join(root, 'injected-link'));
    }, /entry set differs from signed closure/);
    assertMutationRejected(runtimeType, ({ parent, root }) => {
      const entrypoint = path.join(root, runtimeType.entrypointPath);
      const backing = path.join(parent, 'symlink-backing');
      fs.renameSync(entrypoint, backing);
      fs.symlinkSync(backing, entrypoint);
    }, /contains a symlink/);
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.chmodSync(path.join(root, runtimeType.entrypointPath), 0o4555);
    }, /full mode differs from its signed identity/);
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.chmodSync(root, 0o1555);
    }, /full mode differs from its signed identity/, { resealRoot: false });
  });

  test(`${runtimeType.label} approved runtime rejects entrypoint hardlink aliases`, () => {
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.linkSync(
        path.join(root, runtimeType.entrypointPath),
        path.join(root, 'injected-hardlink'),
      );
    }, /entry set differs from signed closure/);
    assertMutationRejected(runtimeType, ({ parent, root }) => {
      fs.linkSync(
        path.join(root, runtimeType.entrypointPath),
        path.join(parent, 'hardlink-alias'),
      );
    }, /link count is not one/);
  });

  test(`${runtimeType.label} approved runtime rejects missing entries and ownership drift`, () => {
    assertMutationRejected(runtimeType, ({ root }) => {
      fs.unlinkSync(path.join(root, runtimeType.entrypointPath));
    }, /entry set differs from signed closure/);
    assertMutationRejected(runtimeType, ({ closure }) => {
      closure.entries[1].uid += 1;
    }, /ownership.*differs from its signed identity/);
    assertMutationRejected(runtimeType, ({ closure }) => {
      closure.entries[0].gid += 1;
    }, /ownership.*differs from its signed identity/);
  });
}
