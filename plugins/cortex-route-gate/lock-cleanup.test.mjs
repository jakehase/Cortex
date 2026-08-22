import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { withFileLock } from './index.ts';

function startIdentity(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

function owner(pid, token, identity = startIdentity(pid)) {
  return { version: 1, pid, startIdentity: identity, token, createdAt: new Date().toISOString() };
}

for (const failurePoint of ['writeFileSync', 'fsyncSync']) {
  test(`lock acquisition cleans up its fd and lock after ${failurePoint} failure`, () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-'));
    const targetPath = path.join(stateDir, 'state.json');
    const lockPath = `${targetPath}.lock`;
    const originalOpen = fs.openSync;
    const originalFailureMethod = fs[failurePoint];
    let lockFd;
    fs.openSync = function (...args) {
      const fd = originalOpen.apply(this, args);
      if (String(args[0]).startsWith(`${lockPath}.`) && String(args[0]).endsWith('.tmp')) lockFd = fd;
      return fd;
    };
    fs[failurePoint] = function (...args) {
      if (args[0] === lockFd) throw new Error(`injected ${failurePoint} failure`);
      return originalFailureMethod.apply(this, args);
    };
    try {
      assert.throws(
        () => withFileLock(targetPath, () => assert.fail('transaction must not run')),
        new RegExp(`injected ${failurePoint} failure`),
      );
      assert.equal(fs.existsSync(lockPath), false);
      assert.throws(() => fs.fstatSync(lockFd), { code: 'EBADF' });
    } finally {
      fs.openSync = originalOpen;
      fs[failurePoint] = originalFailureMethod;
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

test('an old lock owned by a live matching process is not reclaimed or overlapped', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-live-'));
  const targetPath = path.join(stateDir, 'state.json');
  const lockPath = `${targetPath}.lock`;
  const liveOwner = owner(process.pid, 'live-owner');
  fs.writeFileSync(lockPath, JSON.stringify(liveOwner));
  const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
  fs.utimesSync(lockPath, old, old);
  let entered = false;
  try {
    assert.throws(() => withFileLock(targetPath, () => { entered = true; }), /timed out acquiring state lock/);
    assert.equal(entered, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), liveOwner);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('a lock is recovered after verified owner death', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-dead-'));
  const targetPath = path.join(stateDir, 'state.json');
  const lockPath = `${targetPath}.lock`;
  fs.writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 2_147_483_647, startIdentity: 'dead', token: 'dead-owner', createdAt: new Date(0).toISOString() }));
  try {
    assert.equal(withFileLock(targetPath, () => 'recovered'), 'recovered');
    assert.equal(fs.existsSync(lockPath), false);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('a fresh malformed lock is not reclaimed', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-malformed-fresh-'));
  const targetPath = path.join(stateDir, 'state.json');
  const lockPath = `${targetPath}.lock`;
  fs.writeFileSync(lockPath, '{');
  let entered = false;
  try {
    assert.throws(() => withFileLock(targetPath, () => { entered = true; }), /timed out acquiring state lock/);
    assert.equal(entered, false);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), '{');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('a stale malformed lock is recovered after the grace period', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-malformed-stale-'));
  const targetPath = path.join(stateDir, 'state.json');
  const lockPath = `${targetPath}.lock`;
  fs.writeFileSync(lockPath, '');
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, stale, stale);
  try {
    assert.equal(withFileLock(targetPath, () => 'recovered'), 'recovered');
    assert.equal(fs.existsSync(lockPath), false);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('release never unlinks a replacement lock owned by another writer', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-lock-release-'));
  const targetPath = path.join(stateDir, 'state.json');
  const lockPath = `${targetPath}.lock`;
  const replacement = owner(process.pid, 'replacement-owner');
  try {
    withFileLock(targetPath, () => {
      fs.unlinkSync(lockPath);
      fs.writeFileSync(lockPath, JSON.stringify(replacement));
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), replacement);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});
