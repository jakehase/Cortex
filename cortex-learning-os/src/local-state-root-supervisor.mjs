#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertInitialRootAuthority } from './linux-root-authority.mjs';

const STATE_FD = 9;
const SAFE_ABSOLUTE = /^\/[A-Za-z0-9._/-]+$/;

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export function openLocalStateRootChain(absoluteTarget, { create = false } = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('local qualification state requires Linux descriptor-relative traversal');
  }
  if (!SAFE_ABSOLUTE.test(absoluteTarget) || path.normalize(absoluteTarget) !== absoluteTarget) {
    throw new Error('unsafe local qualification state root');
  }
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const descriptors = [];
  const assertTrusted = (descriptor, label) => {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7022) !== 0 || (stat.mode & 0o100) === 0) {
      throw new Error(
        `local qualification state ancestor is not immutable root-owned material: ${label}`,
      );
    }
    return stat;
  };
  try {
    let current = fs.openSync('/', flags);
    descriptors.push(current);
    let traversed = '/';
    assertTrusted(current, '/');
    for (const component of absoluteTarget.slice(1).split('/').filter(Boolean)) {
      const relativeView = `/proc/self/fd/${current}/${component}`;
      let next;
      try {
        next = fs.openSync(relativeView, flags);
      } catch (error) {
        if (!create || error.code !== 'ENOENT') throw error;
        fs.mkdirSync(relativeView, { mode: 0o700 });
        fs.chownSync(relativeView, 0, 0);
        next = fs.openSync(relativeView, flags);
      }
      descriptors.push(next);
      traversed = path.join(traversed, component);
      assertTrusted(next, traversed);
      current = next;
    }
    return {
      descriptors,
      stateDescriptor: current,
      identity: fs.fstatSync(current),
    };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try { fs.closeSync(descriptor); } catch {}
    }
    throw error;
  }
}

function main() {
  const [script, ...argv] = process.argv.slice(2);
  try {
    if (!script || !path.isAbsolute(script)) {
      throw new Error('local state supervisor requires an absolute launcher');
    }
    assertInitialRootAuthority();
    const stateRoot = option(argv, '--state-root', '/root/.openclaw/cortex-learning-os/phd');
    const archivalOnly = argv.includes('--archival-only');
    const chain = openLocalStateRootChain(stateRoot, { create: !archivalOnly });
    try {
      const result = spawnSync('/bin/bash', [script, ...argv], {
        stdio: [
          'inherit', 'inherit', 'inherit',
          'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore',
          chain.stateDescriptor,
        ],
        env: {
          ...process.env,
          CLOS_LOCAL_STATE_SUPERVISED: '1',
          CLOS_LOCAL_STATE_ROOT_FD: String(STATE_FD),
          CLOS_LOCAL_STATE_ROOT_PATH: stateRoot,
          CLOS_LOCAL_STATE_ROOT_IDENTITY:
            `${chain.identity.dev}:${chain.identity.ino}:${chain.identity.uid}:${chain.identity.gid}`,
        },
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    } finally {
      for (const descriptor of chain.descriptors.reverse()) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 3;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
