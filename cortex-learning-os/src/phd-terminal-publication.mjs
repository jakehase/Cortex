#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { assertInitialRootAuthority } from './linux-root-authority.mjs';
import {
  validatePhdWorkerArtifact,
  validateTerminalArtifactMetadata,
} from './validate-phd-worker-artifact.mjs';
import { durablyAdoptPublishedTree } from './durable-tree-adoption.mjs';

export const PHD_TERMINAL_PUBLICATION_JOURNAL_SCHEMA =
  'cortex.learning_os.phd_terminal_publication_journal.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const PRODUCT_TREE = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_ABSOLUTE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const KERNEL_FLOCK = '/usr/bin/flock';
const MAX_PUBLICATION_JOURNAL_BYTES = 1024 * 1024;

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY || 0)
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function durableExclusiveFile(target, bytes, mode = 0o600) {
  const descriptor = fs.openSync(
    target,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
    mode,
  );
  try {
    fs.fchmodSync(descriptor, mode);
    let offset = 0;
    while (offset < bytes.length) {
      offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicJson(target, value) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(16).toString('hex')}.tmp`,
  );
  try {
    durableExclusiveFile(
      temporary,
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    );
    fs.renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
      fsyncDirectory(path.dirname(temporary));
    } catch {}
    throw error;
  }
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function assertProtectedDirectory(directory, {
  uid = 0,
  gid = null,
  writable = false,
} = {}) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== uid || (gid !== null && stat.gid !== gid)
      || (stat.mode & 0o7000) !== 0
      || (stat.mode & (writable ? 0o077 : 0o022)) !== 0) {
    throw new Error(`publication directory is not protected: ${directory}`);
  }
}

function openKernelFlock(expectedUid, expectedGid) {
  for (const ancestor of ['/', '/usr', '/usr/bin']) {
    const stat = fs.lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || stat.uid !== expectedUid || stat.gid !== expectedGid
        || (stat.mode & 0o7022) !== 0) {
      throw new Error('terminal publication kernel helper ancestor is unsafe');
    }
  }
  const descriptor = fs.openSync(
    KERNEL_FLOCK,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(KERNEL_FLOCK, { bigint: true });
    if (!stat.isFile() || !named.isFile() || named.isSymbolicLink()
        || stat.dev !== named.dev || stat.ino !== named.ino
        || Number(stat.uid) !== expectedUid || Number(stat.gid) !== expectedGid
        || (Number(stat.mode) & 0o7022) !== 0
        || (Number(stat.mode) & 0o100) === 0) {
      throw new Error('terminal publication kernel helper is unsafe or changed');
    }
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

export function acquirePhdJobExclusion({
  lockPath,
  descriptor,
  expectedUid = 0,
  expectedGid = 0,
  helperExpectedUid = 0,
  helperExpectedGid = 0,
} = {}) {
  if (!SAFE_ABSOLUTE_PATH.test(String(lockPath || ''))
      || !Number.isSafeInteger(descriptor) || descriptor < 3
      || !Number.isSafeInteger(expectedUid) || expectedUid < 0
      || !Number.isSafeInteger(expectedGid) || expectedGid < 0
      || !Number.isSafeInteger(helperExpectedUid) || helperExpectedUid < 0
      || !Number.isSafeInteger(helperExpectedGid) || helperExpectedGid < 0) {
    throw new Error('terminal publication exclusion requires an exact path and open descriptor');
  }
  const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
  const namedStat = fs.lstatSync(lockPath, { bigint: true });
  if (!descriptorStat.isDirectory() || !namedStat.isDirectory()
      || namedStat.isSymbolicLink()
      || Number(descriptorStat.uid) !== expectedUid
      || Number(descriptorStat.gid) !== expectedGid
      || (Number(descriptorStat.mode) & 0o7777) !== 0o700
      || descriptorStat.dev !== namedStat.dev || descriptorStat.ino !== namedStat.ino) {
    throw new Error('terminal publication exclusion inode is unsafe or changed');
  }
  const flockDescriptor = openKernelFlock(helperExpectedUid, helperExpectedGid);
  let acquired;
  try {
    acquired = spawnSync(
      '/proc/self/fd/4',
      ['--exclusive', '--nonblock', '3'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', descriptor, flockDescriptor],
      },
    );
  } finally {
    fs.closeSync(flockDescriptor);
  }
  if (acquired.error || acquired.status === null || acquired.signal !== null) {
    throw new Error(
      `terminal publication kernel exclusion failed: ${
        acquired.error?.message || acquired.signal || 'unknown failure'
      }`,
    );
  }
  if (acquired.status === 1) {
    throw new Error('terminal publication is deferred while the exact job owner is live');
  }
  if (acquired.status !== 0) {
    throw new Error(
      `terminal publication kernel exclusion failed: ${
        String(acquired.stderr || '').trim() || `flock exited ${acquired.status}`
      }`,
    );
  }
  const afterLock = fs.fstatSync(descriptor, { bigint: true });
  const namedAfterLock = fs.lstatSync(lockPath, { bigint: true });
  if (!afterLock.isDirectory() || !namedAfterLock.isDirectory()
      || afterLock.dev !== descriptorStat.dev || afterLock.ino !== descriptorStat.ino
      || namedAfterLock.dev !== descriptorStat.dev || namedAfterLock.ino !== descriptorStat.ino
      || Number(afterLock.uid) !== expectedUid || Number(afterLock.gid) !== expectedGid
      || (Number(afterLock.mode) & 0o7777) !== 0o700) {
    throw new Error('terminal publication exclusion pathname changed during acquisition');
  }
  return true;
}

function assertProducerTree(root, producerUid, producerGid) {
  const walk = (target) => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || stat.uid !== producerUid || stat.gid !== producerGid
        || (stat.mode & 0o7077) !== 0) {
      throw new Error(`producer staging metadata is unsafe: ${target}`);
    }
    if (stat.isFile()) {
      if (stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600) {
        throw new Error(`producer staging file metadata is unsafe: ${target}`);
      }
      return;
    }
    if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700) {
      throw new Error(`producer staging directory metadata is unsafe: ${target}`);
    }
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
  };
  walk(root);
}

function copyOpenedRegular(sourceDescriptor, destination, displayPath, producerUid, producerGid) {
  let destinationDescriptor = null;
  try {
    const before = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n
        || Number(before.uid) !== producerUid || Number(before.gid) !== producerGid
        || (Number(before.mode) & 0o7777) !== 0o600) {
      throw new Error(`publication source is not an exclusive producer file: ${displayPath}`);
    }
    destinationDescriptor = fs.openSync(
      destination,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
      0o400,
    );
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      let offset = 0;
      while (offset < read) {
        offset += fs.writeSync(destinationDescriptor, buffer, offset, read - offset);
      }
    }
    fs.fsyncSync(destinationDescriptor);
    const after = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) {
      throw new Error(
        `producer changed artifact while the publisher imported it: ${displayPath}`,
      );
    }
  } finally {
    if (destinationDescriptor !== null) fs.closeSync(destinationDescriptor);
  }
}

function importProducerTree(source, destination, producerUid, producerGid) {
  const directoryFlags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const childFlags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const rootDescriptor = fs.openSync(source, directoryFlags);
  const walk = (sourceDescriptor, sourceDisplay, destinationDirectory) => {
    const before = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!before.isDirectory()
        || Number(before.uid) !== producerUid || Number(before.gid) !== producerGid
        || (Number(before.mode) & 0o7777) !== 0o700) {
      throw new Error(`publication source directory is unsafe: ${sourceDisplay}`);
    }
    const names = fs.readdirSync(`/proc/self/fd/${sourceDescriptor}`).sort();
    for (const name of names) {
      if (!name || name === '.' || name === '..' || name.includes('/')) {
        throw new Error('publication source returned an unsafe directory entry');
      }
      const sourceTarget = `/proc/self/fd/${sourceDescriptor}/${name}`;
      const sourceDisplayTarget = path.join(sourceDisplay, name);
      const destinationTarget = path.join(destinationDirectory, name);
      const childDescriptor = fs.openSync(sourceTarget, childFlags);
      try {
        const stat = fs.fstatSync(childDescriptor);
        if (stat.isDirectory()) {
          fs.mkdirSync(destinationTarget, { mode: 0o700 });
          walk(childDescriptor, sourceDisplayTarget, destinationTarget);
        } else if (stat.isFile()) {
          copyOpenedRegular(
            childDescriptor,
            destinationTarget,
            sourceDisplayTarget,
            producerUid,
            producerGid,
          );
        } else {
          throw new Error(
            `publication source contains a special object: ${sourceDisplayTarget}`,
          );
        }
      } finally {
        fs.closeSync(childDescriptor);
      }
    }
    const after = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error(
        `producer changed directory while the publisher imported it: ${sourceDisplay}`,
      );
    }
    fsyncDirectory(destinationDirectory);
  };
  try {
    fs.mkdirSync(destination, { mode: 0o700 });
    walk(rootDescriptor, source, destination);
  } finally {
    fs.closeSync(rootDescriptor);
  }
}

function sealPublisherTree(root) {
  const directories = [];
  const walk = (directory) => {
    directories.push(directory);
    for (const name of fs.readdirSync(directory).sort()) {
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error('publisher stage contains a symlink');
      if (stat.isDirectory()) walk(target);
      else if (stat.isFile()) {
        if (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1) {
          throw new Error(`publisher file ownership or link count is unsafe: ${target}`);
        }
        fs.chmodSync(target, 0o444);
        const descriptor = fs.openSync(
          target,
          fs.constants.O_RDONLY
            | (fs.constants.O_NOFOLLOW || 0)
            | (fs.constants.O_CLOEXEC || 0),
        );
        try {
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
      } else {
        throw new Error(`publisher stage contains a special object: ${target}`);
      }
    }
  };
  walk(root);
  for (const directory of directories.reverse()) {
    fs.chmodSync(directory, 0o555);
    fsyncDirectory(directory);
  }
}

function quarantine(target, quarantineRoot, label) {
  try {
    fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const destination = path.join(
    quarantineRoot,
    `${label}.${new Date().toISOString().replaceAll(/[^0-9TZ]/g, '')}.${process.pid}.`
      + `${crypto.randomBytes(12).toString('hex')}`,
  );
  fs.renameSync(target, destination);
  fsyncDirectory(path.dirname(target));
  fsyncDirectory(quarantineRoot);
  return destination;
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function reconcilePhdTerminalPublicationJournalStages({
  journalPath,
  quarantineRoot,
  jobId,
} = {}) {
  if (!SAFE_ABSOLUTE_PATH.test(String(journalPath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(quarantineRoot || ''))
      || !SAFE_ID.test(String(jobId || ''))
      || path.dirname(journalPath) === quarantineRoot
      || journalPath.startsWith(`${quarantineRoot}${path.sep}`)
      || quarantineRoot.startsWith(`${path.dirname(journalPath)}${path.sep}`)) {
    throw new Error('terminal publication journal reconciliation paths are unsafe');
  }
  const stagingParent = path.dirname(journalPath);
  assertProtectedDirectory(stagingParent, { uid: 0 });
  assertProtectedDirectory(quarantineRoot, { uid: 0, gid: 0 });
  const journalName = path.basename(journalPath);
  const prefix = `.${journalName}.`;
  const pattern = new RegExp(
    `^[.]${escapedPattern(journalName)}[.]([1-9][0-9]*)[.]([0-9a-f]{32})[.]tmp$`,
  );
  const quarantined = [];
  for (const name of fs.readdirSync(stagingParent).sort()) {
    if (!name.startsWith(prefix)) continue;
    const target = path.join(stagingParent, name);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const safeOrphan = pattern.test(name)
      && stat.isFile()
      && !stat.isSymbolicLink()
      && stat.uid === 0
      && stat.gid === 0
      && (stat.mode & 0o7777) === 0o600
      && stat.nlink === 1
      && stat.size <= MAX_PUBLICATION_JOURNAL_BYTES;
    const destination = quarantine(
      target,
      quarantineRoot,
      `${jobId}.${safeOrphan
        ? 'orphan-journal-stage'
        : 'unsafe-journal-stage'}`,
    );
    if (destination !== null) quarantined.push(destination);
  }
  return quarantined;
}

function readCommittedJournal(journalPath) {
  const descriptor = fs.openSync(
    journalPath,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_NONBLOCK || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n
        || Number(before.uid) !== 0 || Number(before.gid) !== 0
        || (Number(before.mode) & 0o7777) !== 0o600
        || before.size < 1n || before.size > BigInt(MAX_PUBLICATION_JOURNAL_BYTES)) {
      throw new Error('publication journal metadata is unsafe');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (read === 0) throw new Error('publication journal was truncated while reading');
      offset += read;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(descriptor, extra, 0, 1, bytes.length) !== 0) {
      throw new Error('publication journal grew while reading');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(journalPath, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink()
        || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || before.dev !== named.dev || before.ino !== named.ino
        || before.size !== named.size
        || before.mtimeNs !== named.mtimeNs || before.ctimeNs !== named.ctimeNs) {
      throw new Error('publication journal changed while reading');
    }
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function publicationIdentity(job, options) {
  return {
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobFileSha256: options.expectedJobFileSha256,
    jobDigest: sha256Text(canonicalJson(job)),
    jobControlPlaneSignatureSha256: sha256Text(canonicalJson(job.controlPlaneSignature)),
    planDigest: options.expectedExecutionIdentity.planDigest,
    campaignDigest: options.expectedExecutionIdentity.campaignDigest,
    descriptorSetSha256: options.expectedExecutionIdentity.descriptorSetSha256,
    productTree: options.expectedExecutionIdentity.productTree,
    runtimeSha256: options.expectedExecutionIdentity.runtimeSha256,
    closureSha256: options.expectedExecutionIdentity.closureSha256,
  };
}

function journalRecord(identity, phase) {
  return {
    schemaVersion: PHD_TERMINAL_PUBLICATION_JOURNAL_SCHEMA,
    identity,
    phase,
    truthBoundary: (
      'This root-owned journal authenticates crash recovery and terminal publication '
      + 'identity only; it is not execution, authority, retention, or qualification evidence.'
    ),
  };
}

function validJournal(value, identity) {
  return exactKeys(value, ['schemaVersion', 'identity', 'phase', 'truthBoundary'])
    && value.schemaVersion === PHD_TERMINAL_PUBLICATION_JOURNAL_SCHEMA
    && ['imported', 'sealed', 'published'].includes(value.phase)
    && canonicalJson(value.identity) === canonicalJson(identity);
}

function validateContent(root, options, requireTerminalMetadata = false) {
  return validatePhdWorkerArtifact({
    jobPath: options.jobPath,
    artifactRoot: root,
    checkoutRoot: options.checkoutRoot,
    expectedExecutionIdentity: options.expectedExecutionIdentity,
    requireTerminalMetadata,
    terminalOwnerUid: 0,
    terminalOwnerGid: 0,
  });
}

function readExactJob(options) {
  const descriptor = fs.openSync(
    options.jobPath,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  let bytes;
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n
        || Number(before.uid) !== 0 || Number(before.gid) !== options.producerGid
        || (Number(before.mode) & 0o7777) !== 0o440
        || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs
        || sha256Bytes(bytes) !== options.expectedJobFileSha256) {
      throw new Error('publication job bytes do not match the authenticated launch identity');
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const job = JSON.parse(bytes.toString('utf8'));
  if (!SAFE_ID.test(String(job?.jobId || ''))
      || job.campaignDigest !== options.expectedExecutionIdentity.campaignDigest) {
    throw new Error('publication job identity is invalid');
  }
  return job;
}

function validateOptions(options) {
  const expectedIdentityKeys = [
    'planDigest', 'campaignDigest', 'descriptorSetSha256', 'productTree',
    'runtimeSha256', 'closureSha256',
  ];
  if (!options || ![
    options.producerStage,
    options.publisherStage,
    options.finalRoot,
    options.journalPath,
    options.quarantineRoot,
    options.lockPath,
    options.jobPath,
    options.checkoutRoot,
  ].every((entry) => typeof entry === 'string' && path.isAbsolute(entry))
      || !Number.isSafeInteger(options.lockDescriptor) || options.lockDescriptor < 3
      || !DIGEST.test(String(options.expectedJobFileSha256 || ''))
      || !Number.isSafeInteger(options.producerUid) || options.producerUid < 1
      || !Number.isSafeInteger(options.producerGid) || options.producerGid < 1
      || !exactKeys(options.expectedExecutionIdentity, expectedIdentityKeys)
      || !PRODUCT_TREE.test(String(options.expectedExecutionIdentity?.productTree || ''))
      || Object.entries(options.expectedExecutionIdentity || {}).some(([key, value]) => (
        key !== 'productTree' && !DIGEST.test(String(value || ''))
      ))
      || (options.crashInjector !== undefined
        && options.crashInjector !== null
        && typeof options.crashInjector !== 'function')) {
    throw new Error('terminal publication requires exact safe paths and authenticated identities');
  }
  assertInitialRootAuthority();
  if (new Set([
    options.producerStage,
    options.publisherStage,
    options.finalRoot,
    options.journalPath,
    options.quarantineRoot,
    options.lockPath,
  ]).size !== 6) {
    throw new Error('terminal publication paths must be distinct');
  }
  const stagingParent = path.dirname(options.producerStage);
  if (path.dirname(options.publisherStage) !== stagingParent
      || path.dirname(options.journalPath) !== stagingParent
      || path.dirname(options.lockPath) !== stagingParent
      || path.dirname(options.finalRoot) === stagingParent
      || options.finalRoot.startsWith(`${stagingParent}${path.sep}`)
      || options.quarantineRoot === stagingParent
      || options.quarantineRoot.startsWith(`${stagingParent}${path.sep}`)
      || stagingParent.startsWith(`${options.quarantineRoot}${path.sep}`)
      || options.quarantineRoot.startsWith(`${options.finalRoot}${path.sep}`)
      || options.finalRoot.startsWith(`${options.quarantineRoot}${path.sep}`)) {
    throw new Error('terminal publication staging, final, and quarantine namespaces overlap');
  }
  assertProtectedDirectory(stagingParent, { uid: 0 });
  assertProtectedDirectory(path.dirname(options.finalRoot), { uid: 0, gid: 0 });
  assertProtectedDirectory(options.quarantineRoot, { uid: 0, gid: 0 });
}

function adoptDurableTerminalRoot(options, { afterRename = false } = {}) {
  if (afterRename && typeof options.crashInjector === 'function') {
    options.crashInjector('after_terminal_rename_before_parent_fsync');
  }
  return durablyAdoptPublishedTree({
    targetPath: options.finalRoot,
    sourceParentPath: path.dirname(options.publisherStage),
    validate: () => validateContent(options.finalRoot, options, true),
    label: 'terminal publication',
  });
}

export function reconcilePhdTerminalPublication(options) {
  validateOptions(options);
  const job = readExactJob(options);
  if (path.basename(options.producerStage) !== `${job.jobId}.producer`
      || path.basename(options.publisherStage) !== `${job.jobId}.publisher`
      || path.basename(options.journalPath) !== `${job.jobId}.publication.json`
      || path.basename(options.lockPath) !== `${job.jobId}.exclusion`
      || path.basename(options.finalRoot) !== job.jobId) {
    throw new Error('terminal publication paths do not bind the authenticated job identity');
  }
  acquirePhdJobExclusion({
    lockPath: options.lockPath,
    descriptor: options.lockDescriptor,
  });
  const identity = publicationIdentity(job, options);
  reconcilePhdTerminalPublicationJournalStages({
    journalPath: options.journalPath,
    quarantineRoot: options.quarantineRoot,
    jobId: job.jobId,
  });
  let journal = null;
  let journalPresent = true;
  try {
    fs.lstatSync(options.journalPath);
  } catch (error) {
    if (error.code === 'ENOENT') journalPresent = false;
    else throw error;
  }
  if (journalPresent) {
    try {
      journal = readCommittedJournal(options.journalPath);
      if (!validJournal(journal, identity)) {
        throw new Error('journal mismatch');
      }
    } catch {
      quarantine(options.journalPath, options.quarantineRoot, `${job.jobId}.journal-mismatch`);
      journal = null;
    }
  }

  if (fs.existsSync(options.finalRoot)) {
    try {
      const result = adoptDurableTerminalRoot(options);
      if (fs.existsSync(options.publisherStage)) {
        quarantine(options.publisherStage, options.quarantineRoot, `${job.jobId}.duplicate-publisher`);
      }
      if (fs.existsSync(options.producerStage)) {
        quarantine(options.producerStage, options.quarantineRoot, `${job.jobId}.duplicate-producer`);
      }
      atomicJson(options.journalPath, journalRecord(identity, 'published'));
      return { status: 'published', recovered: true, validation: result };
    } catch (error) {
      quarantine(options.finalRoot, options.quarantineRoot, `${job.jobId}.invalid-terminal`);
      journal = null;
    }
  }

  if (fs.existsSync(options.publisherStage)) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(options.publisherStage, 'artifact-manifest.json'), 'utf8'),
      );
      validateTerminalArtifactMetadata(options.publisherStage, manifest);
      validateContent(options.publisherStage, options, true);
      atomicJson(options.journalPath, journalRecord(identity, 'sealed'));
      fs.renameSync(options.publisherStage, options.finalRoot);
      const committed = adoptDurableTerminalRoot(options, { afterRename: true });
      atomicJson(options.journalPath, journalRecord(identity, 'published'));
      if (fs.existsSync(options.producerStage)) {
        quarantine(options.producerStage, options.quarantineRoot, `${job.jobId}.consumed-producer`);
      }
      return { status: 'published', recovered: true, validation: committed };
    } catch (error) {
      quarantine(options.publisherStage, options.quarantineRoot, `${job.jobId}.invalid-publisher`);
      journal = null;
    }
  }

  if (!fs.existsSync(options.producerStage)) {
    return { status: 'needs_execution', recovered: false };
  }

  try {
    assertProducerTree(options.producerStage, options.producerUid, options.producerGid);
    validateContent(options.producerStage, options, false);
    importProducerTree(
      options.producerStage,
      options.publisherStage,
      options.producerUid,
      options.producerGid,
    );
    atomicJson(options.journalPath, journalRecord(identity, 'imported'));
    sealPublisherTree(options.publisherStage);
    validateContent(options.publisherStage, options, true);
    atomicJson(options.journalPath, journalRecord(identity, 'sealed'));
    fs.renameSync(options.publisherStage, options.finalRoot);
    const committed = adoptDurableTerminalRoot(options, { afterRename: true });
    atomicJson(options.journalPath, journalRecord(identity, 'published'));
    quarantine(options.producerStage, options.quarantineRoot, `${job.jobId}.consumed-producer`);
    return { status: 'published', recovered: true, validation: committed };
  } catch (error) {
    if (fs.existsSync(options.publisherStage)) {
      quarantine(options.publisherStage, options.quarantineRoot, `${job.jobId}.partial-publisher`);
    }
    if (fs.existsSync(options.producerStage)) {
      quarantine(options.producerStage, options.quarantineRoot, `${job.jobId}.partial-producer`);
    }
    if (fs.existsSync(options.journalPath)) {
      quarantine(options.journalPath, options.quarantineRoot, `${job.jobId}.partial-journal`);
    }
    return { status: 'needs_execution', recovered: false, rejected: error.message };
  }
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
  };
  try {
    const result = reconcilePhdTerminalPublication({
      jobPath: path.resolve(value('--job')),
      producerStage: path.resolve(value('--producer-stage')),
      publisherStage: path.resolve(value('--publisher-stage')),
      finalRoot: path.resolve(value('--final-root')),
      journalPath: path.resolve(value('--journal')),
      quarantineRoot: path.resolve(value('--quarantine-root')),
      lockPath: path.resolve(value('--lock-path')),
      lockDescriptor: Number(value('--lock-fd')),
      checkoutRoot: path.resolve(value('--checkout-root')),
      producerUid: Number(value('--producer-uid')),
      producerGid: Number(value('--producer-gid')),
      expectedJobFileSha256: value('--expected-job-file-sha256'),
      expectedExecutionIdentity: {
        planDigest: value('--plan-digest'),
        campaignDigest: value('--campaign-digest'),
        descriptorSetSha256: value('--descriptor-set-sha256'),
        productTree: value('--product-tree'),
        runtimeSha256: value('--runtime-sha256'),
        closureSha256: value('--closure-sha256'),
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 4;
  }
}
