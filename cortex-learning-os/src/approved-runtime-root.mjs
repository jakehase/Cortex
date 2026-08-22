import fs from 'node:fs';

import { sha256Bytes } from './hash.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const MODE = /^0[0-7]{3}$/;

function fail(label, message) {
  throw new Error(`${label} ${message}`);
}

function modeValue(value, label) {
  if (!MODE.test(String(value || ''))) {
    fail(label, 'signed runtime closure contains an invalid mode');
  }
  return Number.parseInt(value, 8);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertMetadata(stat, entry, type, label) {
  const matchesType = type === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!matchesType
      || Number(stat.uid) !== entry.uid
      || Number(stat.gid) !== entry.gid
      || (Number(stat.mode) & 0o7777) !== modeValue(entry.mode, label)) {
    fail(label, `${entry.path} type, ownership, or full mode differs from its signed identity`);
  }
}

function assertStableRoot(before, after, label) {
  if (!sameIdentity(before, after)
      || before.ctimeNs !== after.ctimeNs
      || before.mtimeNs !== after.mtimeNs
      || before.nlink !== after.nlink) {
    fail(label, 'runtime root changed during descriptor enumeration');
  }
}

export function openExactApprovedRuntimeEntrypoint({
  closure,
  entrypointPath,
  label,
  rootDescriptor,
}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    fail(String(label || 'approved runtime'), 'requires Linux descriptor-relative inspection');
  }
  if (!Number.isInteger(rootDescriptor) || rootDescriptor < 0
      || typeof label !== 'string' || label.length === 0
      || typeof entrypointPath !== 'string' || entrypointPath.length === 0
      || entrypointPath === '.' || entrypointPath === '..'
      || entrypointPath.includes('/') || entrypointPath.includes('\0')) {
    fail(String(label || 'approved runtime'), 'closure inspection request is invalid');
  }
  const entries = closure?.entries;
  const rootEntry = Array.isArray(entries)
    ? entries.find((entry) => entry?.path === '.')
    : null;
  const executableEntry = Array.isArray(entries)
    ? entries.find((entry) => entry?.path === entrypointPath)
    : null;
  if (!Array.isArray(entries)
      || entries.length !== 2
      || entries.filter((entry) => entry?.path === '.').length !== 1
      || entries.filter((entry) => entry?.path === entrypointPath).length !== 1
      || rootEntry?.role !== 'runtime_root'
      || rootEntry?.type !== 'directory'
      || !Number.isSafeInteger(rootEntry?.uid) || rootEntry.uid < 0
      || !Number.isSafeInteger(rootEntry?.gid) || rootEntry.gid < 0
      || executableEntry?.role !== 'entrypoint'
      || executableEntry?.type !== 'file'
      || !Number.isSafeInteger(executableEntry?.uid) || executableEntry.uid < 0
      || !Number.isSafeInteger(executableEntry?.gid) || executableEntry.gid < 0
      || !Number.isSafeInteger(executableEntry?.bytes) || executableEntry.bytes < 1
      || !DIGEST.test(String(executableEntry?.sha256 || ''))) {
    fail(label, 'signed runtime closure entry declaration is invalid');
  }

  const rootView = `/proc/self/fd/${rootDescriptor}`;
  const rootBefore = fs.fstatSync(rootDescriptor, { bigint: true });
  assertMetadata(rootBefore, rootEntry, 'directory', label);

  const names = fs.readdirSync(rootView).sort();
  if (names.length !== 1 || names[0] !== entrypointPath) {
    fail(
      label,
      `runtime root entry set differs from signed closure: expected ${entrypointPath}`,
    );
  }

  const entryView = `${rootView}/${entrypointPath}`;
  const pathStat = fs.lstatSync(entryView, { bigint: true });
  if (pathStat.isSymbolicLink()) {
    fail(label, `runtime root contains a symlink at ${entrypointPath}`);
  }
  if (!pathStat.isFile()) {
    fail(label, `runtime root contains a special entry at ${entrypointPath}`);
  }
  assertMetadata(pathStat, executableEntry, 'file', label);

  let descriptor = null;
  try {
    descriptor = fs.openSync(
      entryView,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
    );
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    assertMetadata(descriptorStat, executableEntry, 'file', label);
    if (!sameIdentity(pathStat, descriptorStat)) {
      fail(label, `entrypoint changed during descriptor binding: ${entrypointPath}`);
    }
    if (descriptorStat.nlink !== 1n) {
      fail(label, `entrypoint link count is not one: ${entrypointPath}`);
    }
    const bytes = fs.readFileSync(descriptor);
    if (BigInt(bytes.length) !== descriptorStat.size
        || bytes.length !== executableEntry.bytes
        || sha256Bytes(bytes) !== executableEntry.sha256) {
      fail(label, `entrypoint bytes differ from signed closure: ${entrypointPath}`);
    }

    const namesAfter = fs.readdirSync(rootView).sort();
    if (namesAfter.length !== 1 || namesAfter[0] !== entrypointPath) {
      fail(label, 'runtime root entry set changed during descriptor enumeration');
    }
    const rootAfter = fs.fstatSync(rootDescriptor, { bigint: true });
    assertMetadata(rootAfter, rootEntry, 'directory', label);
    assertStableRoot(rootBefore, rootAfter, label);

    const opened = { bytes, descriptor };
    descriptor = null;
    return opened;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
