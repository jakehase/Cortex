import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { linuxDescriptorMountId } from './linux-descriptor-identity.mjs';
import { assertInitialRootAuthority } from './linux-root-authority.mjs';

const DIRECTORY_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_DIRECTORY || 0)
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_CLOEXEC || 0);
const FILE_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function descriptorEntry(descriptor, name) {
  return `/proc/self/fd/${descriptor}/${name}`;
}

function currentIdentity() {
  if (typeof process.geteuid !== 'function' || typeof process.getegid !== 'function') {
    throw new Error('authority input requires effective Unix credentials');
  }
  return {
    uid: BigInt(process.geteuid()),
    gid: BigInt(process.getegid()),
  };
}

function exactMetadata(stat, mountId) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs,
    mountId,
  };
}

function directoryIdentity(metadata) {
  const sharedStickyAncestor = (metadata.mode & 0o1000n) !== 0n
    && (metadata.mode & 0o002n) !== 0n;
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode,
    // A sticky shared ancestor such as /tmp legitimately changes link count
    // when unrelated principals create directories. Its stable naming
    // identity is the pinned device/inode/mount/owner/mode tuple. Private
    // ancestors retain exact link-count stability as an additional witness.
    ...(sharedStickyAncestor ? {} : { nlink: metadata.nlink }),
    mountId: metadata.mountId,
  };
}

function sameMetadata(left, right) {
  return Object.keys(left).every((field) => left[field] === right[field]);
}

function readExactBytes(descriptor, expectedLength) {
  const bytes = Buffer.alloc(expectedLength);
  let offset = 0;
  while (offset < expectedLength) {
    const count = fs.readSync(
      descriptor,
      bytes,
      offset,
      expectedLength - offset,
      offset,
    );
    if (count === 0) break;
    offset += count;
  }
  const extra = Buffer.alloc(1);
  const extraLength = fs.readSync(
    descriptor,
    extra,
    0,
    1,
    expectedLength,
  );
  return offset === expectedLength && extraLength === 0 ? bytes : null;
}

function strictUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${label} is not strict UTF-8`);
  }
  return text;
}

function parseExactJson(bytes, label) {
  const text = strictUtf8(bytes, label);
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  const compact = JSON.stringify(record);
  const pretty = JSON.stringify(record, null, 2);
  const exactEncodings = new Set([
    compact,
    `${compact}\n`,
    pretty,
    `${pretty}\n`,
  ]);
  if (!exactEncodings.has(text)) {
    throw new Error(
      `${label} is not an exact deterministic JSON encoding`,
    );
  }
  return record;
}

function safeAncestor(stat, filesystemUid, expectedUid) {
  const stickyWorldWritable = (stat.mode & 0o1000n) !== 0n
    && (stat.mode & 0o002n) !== 0n;
  return stat.isDirectory()
    && stat.nlink > 0n
    && [filesystemUid, expectedUid].includes(stat.uid)
    && ((stat.mode & 0o022n) === 0n
      || (stickyWorldWritable && stat.uid === filesystemUid));
}

function authorityTraversalRoot(parentPath) {
  const descriptorRoot = /^\/proc\/self\/fd\/([1-9][0-9]*)(?:\/(.*))?$/.exec(parentPath);
  if (descriptorRoot) {
    const descriptor = Number(descriptorRoot[1]);
    if (!Number.isSafeInteger(descriptor)) {
      throw new Error('authority input descriptor root is invalid');
    }
    const root = `/proc/self/fd/${descriptor}`;
    return {
      root,
      rootOpenPath: `${root}/.`,
      components: (descriptorRoot[2] || '').split(path.sep).filter(Boolean),
    };
  }
  const root = path.parse(parentPath).root;
  return {
    root,
    rootOpenPath: root,
    components: parentPath.slice(root.length).split(path.sep).filter(Boolean),
  };
}

function openAuthorityParent(targetPath, expectedUid) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('authority input requires Linux descriptor-relative traversal');
  }
  const resolved = path.resolve(targetPath);
  const parentPath = path.dirname(resolved);
  const { root, rootOpenPath, components } = authorityTraversalRoot(parentPath);
  let descriptor = fs.openSync(rootOpenPath, DIRECTORY_FLAGS);
  const chain = [];
  let traversed = root;
  try {
    const filesystemUid = fs.fstatSync(descriptor, { bigint: true }).uid;
    const retainDirectory = () => {
      const stat = fs.fstatSync(descriptor, { bigint: true });
      const metadata = exactMetadata(stat, linuxDescriptorMountId(descriptor));
      if (!safeAncestor(stat, filesystemUid, expectedUid)) {
        throw new Error(`authority input ancestor is unsafe: ${traversed}`);
      }
      chain.push({
        descriptor,
        identity: directoryIdentity(metadata),
        path: traversed,
      });
    };
    retainDirectory();
    for (const component of components) {
      const ancestor = fs.fstatSync(descriptor, { bigint: true });
      if (!safeAncestor(ancestor, filesystemUid, expectedUid)) {
        throw new Error(`authority input ancestor is unsafe: ${traversed}`);
      }
      const child = fs.openSync(
        descriptorEntry(descriptor, component),
        DIRECTORY_FLAGS,
      );
      descriptor = child;
      traversed = path.join(traversed, component);
      retainDirectory();
    }
    const parent = fs.fstatSync(descriptor, { bigint: true });
    if (!safeAncestor(parent, filesystemUid, expectedUid)) {
      throw new Error(`authority input parent is unsafe: ${parentPath}`);
    }
    return {
      descriptor,
      chain,
      components,
      filesystemUid,
      mountId: linuxDescriptorMountId(descriptor),
      path: parentPath,
      resolved,
      root,
      rootOpenPath,
    };
  } catch (error) {
    if (!chain.some((entry) => entry.descriptor === descriptor)) {
      fs.closeSync(descriptor);
    }
    for (const entry of chain.reverse()) fs.closeSync(entry.descriptor);
    throw error;
  }
}

function assertNamedAuthorityParentChain(parent, expectedUid) {
  let descriptor = fs.openSync(parent.rootOpenPath, DIRECTORY_FLAGS);
  let traversed = parent.root;
  try {
    for (let index = 0; index < parent.chain.length; index += 1) {
      const retained = parent.chain[index];
      const retainedStat = fs.fstatSync(retained.descriptor, { bigint: true });
      const retainedMetadata = exactMetadata(
        retainedStat,
        linuxDescriptorMountId(retained.descriptor),
      );
      const namedStat = fs.fstatSync(descriptor, { bigint: true });
      const namedMetadata = exactMetadata(
        namedStat,
        linuxDescriptorMountId(descriptor),
      );
      if (!safeAncestor(retainedStat, parent.filesystemUid, expectedUid)
          || !safeAncestor(namedStat, parent.filesystemUid, expectedUid)
          || !sameMetadata(
            directoryIdentity(retainedMetadata),
            retained.identity,
          )
          || !sameMetadata(
            directoryIdentity(namedMetadata),
            retained.identity,
          )) {
        throw new Error(
          `authority input ancestor identity changed while reading: ${traversed}`,
        );
      }
      if (index === parent.components.length) break;
      const child = fs.openSync(
        descriptorEntry(descriptor, parent.components[index]),
        DIRECTORY_FLAGS,
      );
      fs.closeSync(descriptor);
      descriptor = child;
      traversed = path.join(traversed, parent.components[index]);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function closeAuthorityParent(parent) {
  for (const entry of [...parent.chain].reverse()) {
    fs.closeSync(entry.descriptor);
  }
}

function invokeObserver(observer, phase, context) {
  if (observer === null || observer === undefined) return;
  if (typeof observer !== 'function') {
    throw new Error('authority input observer is invalid');
  }
  observer(phase, context);
}

function snapshotIdentity(metadata) {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mountId: metadata.mountId,
    uid: Number(metadata.uid),
    gid: Number(metadata.gid),
    mode: (metadata.mode & 0o7777n).toString(8).padStart(4, '0'),
    nlink: Number(metadata.nlink),
    size: Number(metadata.size),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
    birthtimeNs: metadata.birthtimeNs.toString(),
  };
}

function snapshotParentIdentity(metadata) {
  const {
    size: _size,
    ...identity
  } = snapshotIdentity(metadata);
  return identity;
}

function samePublicIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readRootBrokeredEntryAt(
  parent,
  name,
  resolved,
  {
    consumeBytes = null,
    expectedBytes = null,
    label,
    minBytes,
    maxBytes,
    observer,
  },
) {
  let descriptor = null;
  let namedDescriptor = null;
  let finalNamedDescriptor = null;
  try {
    const parentBeforeStat = fs.fstatSync(parent.descriptor, { bigint: true });
    const parentBefore = exactMetadata(
      parentBeforeStat,
      linuxDescriptorMountId(parent.descriptor),
    );
    if (!parentBeforeStat.isDirectory()
        || parentBeforeStat.nlink < 1n
        || parentBeforeStat.uid !== 0n
        || parentBeforeStat.gid !== 0n
        || (parentBeforeStat.mode & 0o7777n) !== 0o500n
        || parentBefore.mountId !== parent.mountId) {
      throw new Error(
        `${label} parent does not have the exact root-owned sealed identity`,
      );
    }
    descriptor = fs.openSync(descriptorEntry(parent.descriptor, name), FILE_FLAGS);
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    const before = exactMetadata(
      beforeStat,
      linuxDescriptorMountId(descriptor),
    );
    if (!beforeStat.isFile()
        || beforeStat.nlink !== 1n
        || beforeStat.uid !== 0n
        || beforeStat.gid !== 0n
        || (beforeStat.mode & 0o7777n) !== 0o400n
        || beforeStat.size < BigInt(minBytes)
        || beforeStat.size > BigInt(maxBytes)
        || before.mountId !== parent.mountId) {
      throw new Error(
        `${label} must be a bounded, single-link root-owned mode-0400 regular file`,
      );
    }
    invokeObserver(observer, 'after_open', {
      descriptor,
      label,
      path: resolved,
    });
    const bytes = readExactBytes(descriptor, Number(beforeStat.size));
    const afterRead = exactMetadata(
      fs.fstatSync(descriptor, { bigint: true }),
      linuxDescriptorMountId(descriptor),
    );
    invokeObserver(observer, 'after_read', {
      descriptor,
      label,
      path: resolved,
    });
    namedDescriptor = fs.openSync(
      descriptorEntry(parent.descriptor, name),
      FILE_FLAGS,
    );
    const named = exactMetadata(
      fs.fstatSync(namedDescriptor, { bigint: true }),
      linuxDescriptorMountId(namedDescriptor),
    );
    const committedBytes = readExactBytes(descriptor, Number(beforeStat.size));
    const committed = exactMetadata(
      fs.fstatSync(descriptor, { bigint: true }),
      linuxDescriptorMountId(descriptor),
    );
    const parentAfter = exactMetadata(
      fs.fstatSync(parent.descriptor, { bigint: true }),
      linuxDescriptorMountId(parent.descriptor),
    );
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameMetadata(before, afterRead)
        || !sameMetadata(afterRead, named)
        || !sameMetadata(named, committed)
        || !sameMetadata(parentBefore, parentAfter)) {
      throw new Error(`${label} changed during its protected broker handoff`);
    }
    if (expectedBytes !== null
        && (!Buffer.isBuffer(expectedBytes) || !bytes.equals(expectedBytes))) {
      throw new Error(`${label} differs from the selected immutable object bytes`);
    }
    const snapshot = {
      bytes,
      identity: snapshotIdentity(before),
      parentIdentity: snapshotParentIdentity(parentBefore),
      path: resolved,
    };
    const consumed = consumeBytes === null
      ? undefined
      : consumeBytes(Buffer.from(bytes), {
        identity: structuredClone(snapshot.identity),
        parentIdentity: structuredClone(snapshot.parentIdentity),
        path: resolved,
      });
    if (consumed !== null
        && (typeof consumed === 'object' || typeof consumed === 'function')
        && typeof consumed.then === 'function') {
      throw new Error(`${label} protected consumer must complete synchronously`);
    }
    invokeObserver(observer, 'before_return', {
      descriptor,
      label,
      namedDescriptor,
      path: resolved,
    });
    try {
      finalNamedDescriptor = fs.openSync(
        descriptorEntry(parent.descriptor, name),
        FILE_FLAGS,
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `${label} changed across its protected consumer handoff`,
          { cause: error },
        );
      }
      throw error;
    }
    const finalNamed = exactMetadata(
      fs.fstatSync(finalNamedDescriptor, { bigint: true }),
      linuxDescriptorMountId(finalNamedDescriptor),
    );
    const finalBytes = readExactBytes(descriptor, Number(beforeStat.size));
    const finalPinned = exactMetadata(
      fs.fstatSync(descriptor, { bigint: true }),
      linuxDescriptorMountId(descriptor),
    );
    const finalParent = exactMetadata(
      fs.fstatSync(parent.descriptor, { bigint: true }),
      linuxDescriptorMountId(parent.descriptor),
    );
    if (finalBytes === null
        || !finalBytes.equals(bytes)
        || !sameMetadata(committed, finalPinned)
        || !sameMetadata(finalPinned, finalNamed)
        || !sameMetadata(parentAfter, finalParent)) {
      throw new Error(`${label} changed across its pinned consumer handoff`);
    }
    if (Array.isArray(parent.chain)) {
      assertNamedAuthorityParentChain(parent, 0n);
    }
    return {
      ...snapshot,
      consumed,
    };
  } catch (error) {
    if (error.code === 'ELOOP') {
      throw new Error(`${label} must not be a symbolic link`, { cause: error });
    }
    throw error;
  } finally {
    if (finalNamedDescriptor !== null) fs.closeSync(finalNamedDescriptor);
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function readAuthoritySnapshot(target, {
  label = 'authority input',
  minBytes = 2,
  maxBytes = DEFAULT_MAX_BYTES,
  expectedUid = null,
  expectedGid = null,
  allowedModes = [0o400, 0o600],
  allowedParentModes = null,
  requireStableParent = true,
  observer = null,
  fixtureOnly = false,
  consumeBytes = null,
} = {}) {
  if (typeof target !== 'string' || target.length < 1) {
    throw new Error(`${label} path is required`);
  }
  if (!Number.isSafeInteger(minBytes) || minBytes < 0
      || !Number.isSafeInteger(maxBytes) || maxBytes < minBytes
      || maxBytes > DEFAULT_MAX_BYTES
      || !Array.isArray(allowedModes) || allowedModes.length < 1
      || allowedModes.some((mode) => (
        !Number.isInteger(mode) || mode < 0 || mode > 0o7777
      ))
      || (allowedParentModes !== null
        && (!Array.isArray(allowedParentModes)
          || allowedParentModes.length < 1
          || allowedParentModes.some((mode) => (
            !Number.isInteger(mode) || mode < 0 || mode > 0o7777
          ))))
      || requireStableParent !== true
      || typeof fixtureOnly !== 'boolean'
      || (consumeBytes !== null && typeof consumeBytes !== 'function')
      || (observer !== null && observer !== undefined
        && (typeof observer !== 'function' || fixtureOnly !== true))) {
    throw new Error(`${label} snapshot policy is invalid`);
  }
  const effective = currentIdentity();
  const ownerUid = expectedUid === null ? effective.uid : BigInt(expectedUid);
  const ownerGid = expectedGid === null ? effective.gid : BigInt(expectedGid);
  const modes = new Set(allowedModes.map((mode) => BigInt(mode)));
  const parentModes = allowedParentModes === null
    ? null
    : new Set(allowedParentModes.map((mode) => BigInt(mode)));
  const parent = openAuthorityParent(target, ownerUid);
  let descriptor = null;
  let namedDescriptor = null;
  let finalNamedDescriptor = null;
  try {
    const parentBeforeStat = fs.fstatSync(parent.descriptor, { bigint: true });
    const parentBefore = exactMetadata(parentBeforeStat, parent.mountId);
    if (parentBeforeStat.uid !== ownerUid
        || parentBeforeStat.gid !== ownerGid
        || (parentModes !== null
          && !parentModes.has(parentBeforeStat.mode & 0o7777n))) {
      throw new Error(
        `${label} parent does not have the exact trusted ownership and sealed mode`,
      );
    }
    const name = path.basename(parent.resolved);
    descriptor = fs.openSync(descriptorEntry(parent.descriptor, name), FILE_FLAGS);
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    const before = exactMetadata(beforeStat, beforeMountId);
    if (!beforeStat.isFile()
        || beforeStat.nlink !== 1n
        || beforeStat.uid !== ownerUid
        || beforeStat.gid !== ownerGid
        || !modes.has(beforeStat.mode & 0o7777n)
        || beforeStat.size < BigInt(minBytes)
        || beforeStat.size > BigInt(maxBytes)
        || beforeMountId !== parent.mountId) {
      throw new Error(
        `${label} must be a bounded, single-link regular file with exact trusted ownership and mode`,
      );
    }
    invokeObserver(observer, 'after_open', {
      descriptor,
      path: parent.resolved,
    });
    const bytes = readExactBytes(descriptor, Number(beforeStat.size));
    const afterReadStat = fs.fstatSync(descriptor, { bigint: true });
    const afterRead = exactMetadata(
      afterReadStat,
      linuxDescriptorMountId(descriptor),
    );
    invokeObserver(observer, 'after_read', {
      descriptor,
      path: parent.resolved,
    });
    namedDescriptor = fs.openSync(
      descriptorEntry(parent.descriptor, name),
      FILE_FLAGS,
    );
    const namedStat = fs.fstatSync(namedDescriptor, { bigint: true });
    const named = exactMetadata(namedStat, linuxDescriptorMountId(namedDescriptor));
    const committedBytes = readExactBytes(descriptor, Number(beforeStat.size));
    const committedStat = fs.fstatSync(descriptor, { bigint: true });
    const committed = exactMetadata(
      committedStat,
      linuxDescriptorMountId(descriptor),
    );
    const parentAfterStat = fs.fstatSync(parent.descriptor, { bigint: true });
    const parentAfter = exactMetadata(
      parentAfterStat,
      linuxDescriptorMountId(parent.descriptor),
    );
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameMetadata(before, afterRead)
        || !sameMetadata(afterRead, named)
        || !sameMetadata(named, committed)
        || !sameMetadata(parentBefore, parentAfter)) {
      throw new Error(`${label} changed while its authenticated snapshot was read`);
    }
    assertNamedAuthorityParentChain(parent, ownerUid);
    const snapshot = {
      bytes,
      identity: snapshotIdentity(before),
      parentIdentity: snapshotParentIdentity(parentBefore),
      path: parent.resolved,
    };
    const consumed = consumeBytes === null
      ? undefined
      : consumeBytes(Buffer.from(bytes), {
        identity: structuredClone(snapshot.identity),
        parentIdentity: structuredClone(snapshot.parentIdentity),
        path: snapshot.path,
      });
    if (consumed !== null
        && (typeof consumed === 'object' || typeof consumed === 'function')
        && typeof consumed.then === 'function') {
      throw new Error(`${label} protected consumer must complete synchronously`);
    }
    invokeObserver(observer, 'before_return', {
      descriptor,
      namedDescriptor,
      path: parent.resolved,
    });
    try {
      finalNamedDescriptor = fs.openSync(
        descriptorEntry(parent.descriptor, name),
        FILE_FLAGS,
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `${label} changed across its protected consumer handoff`,
          { cause: error },
        );
      }
      throw error;
    }
    const finalNamed = exactMetadata(
      fs.fstatSync(finalNamedDescriptor, { bigint: true }),
      linuxDescriptorMountId(finalNamedDescriptor),
    );
    const finalBytes = readExactBytes(descriptor, Number(beforeStat.size));
    const finalPinned = exactMetadata(
      fs.fstatSync(descriptor, { bigint: true }),
      linuxDescriptorMountId(descriptor),
    );
    const finalParent = exactMetadata(
      fs.fstatSync(parent.descriptor, { bigint: true }),
      linuxDescriptorMountId(parent.descriptor),
    );
    if (finalBytes === null
        || !finalBytes.equals(bytes)
        || !sameMetadata(committed, finalPinned)
        || !sameMetadata(finalPinned, finalNamed)
        || !sameMetadata(parentAfter, finalParent)) {
      throw new Error(`${label} changed across its protected consumer handoff`);
    }
    assertNamedAuthorityParentChain(parent, ownerUid);
    return {
      ...snapshot,
      consumed,
      consumedUnderPinnedDescriptor: consumeBytes !== null,
    };
  } catch (error) {
    if (error.code === 'ELOOP') {
      throw new Error(`${label} must not be a symbolic link`, { cause: error });
    }
    throw error;
  } finally {
    if (finalNamedDescriptor !== null) fs.closeSync(finalNamedDescriptor);
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
    closeAuthorityParent(parent);
  }
}

export function readAuthorityJson(target, label, options = {}) {
  if (options.consume !== undefined
      && options.consume !== null
      && typeof options.consume !== 'function') {
    throw new Error(`${label} protected JSON consumer is invalid`);
  }
  let record = null;
  const {
    consume = null,
    ...snapshotOptions
  } = options;
  const snapshot = readAuthoritySnapshot(target, {
    ...snapshotOptions,
    label,
    minBytes: options.minBytes ?? 2,
    consumeBytes(bytes, identity) {
      record = parseExactJson(bytes, label);
      return consume === null
        ? record
        : consume(structuredClone(record), identity);
    },
  });
  return {
    ...snapshot,
    record,
  };
}

export function readRootBrokeredAuthorityJson(target, label, options = {}) {
  if (typeof target !== 'string' || target.length < 1) {
    throw new Error(`${label} path is required`);
  }
  const minBytes = options.minBytes ?? 2;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(minBytes) || minBytes < 0
      || !Number.isSafeInteger(maxBytes) || maxBytes < minBytes
      || maxBytes > DEFAULT_MAX_BYTES
      || (options.consume !== null
        && options.consume !== undefined
        && typeof options.consume !== 'function')
      || (options.observer !== null
        && options.observer !== undefined
        && (typeof options.observer !== 'function'
          || options.fixtureOnly !== true))
      || (options.fixtureOnly !== undefined
        && typeof options.fixtureOnly !== 'boolean')) {
    throw new Error(`${label} brokered snapshot policy is invalid`);
  }
  if (options.fixtureOnly !== true && typeof options.consume !== 'function') {
    throw new Error(
      `${label} production brokered snapshot requires a synchronous protected consumer`,
    );
  }
  assertInitialRootAuthority({ fixtureOnly: options.fixtureOnly === true });
  const resolved = path.resolve(target);
  const parent = openAuthorityParent(resolved, 0n);
  const name = path.basename(resolved);
  let objectDirectoryDescriptor = null;
  try {
    const entryOptions = {
      label,
      minBytes,
      maxBytes,
      observer: options.observer ?? null,
    };
    const published = readRootBrokeredEntryAt(
      parent,
      name,
      resolved,
      entryOptions,
    );
    const objectDigest = crypto.createHash('sha256')
      .update(published.bytes)
      .digest('hex');
    const objectName = `${objectDigest}.json`;
    const objectDirectoryPath = path.join(
      path.dirname(resolved),
      '.authenticated-objects',
    );
    const objectPath = path.join(objectDirectoryPath, objectName);
    objectDirectoryDescriptor = fs.openSync(
      descriptorEntry(parent.descriptor, '.authenticated-objects'),
      DIRECTORY_FLAGS,
    );
    const objectDirectoryBefore = exactMetadata(
      fs.fstatSync(objectDirectoryDescriptor, { bigint: true }),
      linuxDescriptorMountId(objectDirectoryDescriptor),
    );
    if (objectDirectoryBefore.uid !== 0n
        || objectDirectoryBefore.gid !== 0n
        || (objectDirectoryBefore.mode & 0o7777n) !== 0o500n
        || objectDirectoryBefore.nlink < 1n
        || objectDirectoryBefore.mountId !== parent.mountId) {
      throw new Error(`${label} immutable object directory is not root-owned and sealed`);
    }
    const objectParent = {
      descriptor: objectDirectoryDescriptor,
      mountId: objectDirectoryBefore.mountId,
      path: objectDirectoryPath,
      resolved: objectPath,
    };
    const immutableObject = readRootBrokeredEntryAt(
      objectParent,
      objectName,
      objectPath,
      {
        ...entryOptions,
        label: `${label} immutable object`,
      },
    );
    const confirmedPublished = readRootBrokeredEntryAt(
      parent,
      name,
      resolved,
      {
        ...entryOptions,
        label: `${label} publication confirmation`,
      },
    );
    const confirmedImmutableObject = readRootBrokeredEntryAt(
      objectParent,
      objectName,
      objectPath,
      {
        ...entryOptions,
        label: `${label} immutable object confirmation`,
      },
    );
    const namedObjectDirectoryDescriptor = fs.openSync(
      descriptorEntry(parent.descriptor, '.authenticated-objects'),
      DIRECTORY_FLAGS,
    );
    let namedObjectDirectory;
    try {
      namedObjectDirectory = exactMetadata(
        fs.fstatSync(namedObjectDirectoryDescriptor, { bigint: true }),
        linuxDescriptorMountId(namedObjectDirectoryDescriptor),
      );
    } finally {
      fs.closeSync(namedObjectDirectoryDescriptor);
    }
    const objectDirectoryAfter = exactMetadata(
      fs.fstatSync(objectDirectoryDescriptor, { bigint: true }),
      linuxDescriptorMountId(objectDirectoryDescriptor),
    );
    if (!published.bytes.equals(immutableObject.bytes)
        || !published.bytes.equals(confirmedPublished.bytes)
        || !published.bytes.equals(confirmedImmutableObject.bytes)
        || !samePublicIdentity(
          published.identity,
          confirmedPublished.identity,
        )
        || !samePublicIdentity(
          immutableObject.identity,
          confirmedImmutableObject.identity,
        )
        || !samePublicIdentity(
          published.parentIdentity,
          confirmedPublished.parentIdentity,
        )
        || !sameMetadata(objectDirectoryBefore, objectDirectoryAfter)
        || !sameMetadata(objectDirectoryAfter, namedObjectDirectory)) {
      throw new Error(
        `${label} alias or content-addressed immutable object changed across the protected consumer handoff`,
      );
    }
    let record = null;
    const consumedImmutableObject = readRootBrokeredEntryAt(
      objectParent,
      objectName,
      objectPath,
      {
        ...entryOptions,
        consumeBytes(bytes, snapshot) {
          try {
            record = JSON.parse(strictUtf8(
              bytes,
              `${label} immutable object`,
            ));
          } catch (error) {
            throw new Error(
              `${label} immutable object is not valid JSON: ${error.message}`,
            );
          }
          const canonicalBytes = Buffer.from(
            `${JSON.stringify(record, null, 2)}\n`,
            'utf8',
          );
          if (!bytes.equals(canonicalBytes)) {
            throw new Error(
              `${label} immutable object is not the canonical broker serialization`,
            );
          }
          return options.consume === null || options.consume === undefined
            ? undefined
            : options.consume(structuredClone(record), snapshot);
        },
        expectedBytes: immutableObject.bytes,
        label: `${label} immutable object consumer handoff`,
      },
    );
    if (!samePublicIdentity(
      immutableObject.identity,
      consumedImmutableObject.identity,
    ) || !samePublicIdentity(
      immutableObject.parentIdentity,
      consumedImmutableObject.parentIdentity,
    )) {
      throw new Error(
        `${label} immutable object identity changed before protected consumption`,
      );
    }
    return {
      ...consumedImmutableObject,
      consumedUnderPinnedDescriptor:
        options.consume !== null && options.consume !== undefined,
      publicationIdentity: published.identity,
      publicationParentIdentity: published.parentIdentity,
      publicationPath: published.path,
      record,
    };
  } finally {
    if (objectDirectoryDescriptor !== null) {
      fs.closeSync(objectDirectoryDescriptor);
    }
    closeAuthorityParent(parent);
  }
}

export function readOptionalAuthorityJson(target, label, options = {}) {
  if (!target) return null;
  try {
    return readAuthorityJson(target, label, options);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.cause?.code === 'ENOENT') return null;
    throw error;
  }
}

export function authorityKeyId(secret) {
  if (typeof secret !== 'string') return null;
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function readAuthoritySecret(target, {
  label = 'authority secret',
  expectedKeyId,
  observer = null,
  fixtureOnly = false,
  consume = null,
} = {}) {
  if (!KEY_ID.test(String(expectedKeyId || ''))) {
    throw new Error(`${label} expected key ID is required`);
  }
  if (consume !== null && typeof consume !== 'function') {
    throw new Error(`${label} protected consumer is invalid`);
  }
  let secret = null;
  const snapshot = readAuthoritySnapshot(target, {
    label,
    minBytes: 32,
    maxBytes: 4096,
    allowedModes: [0o400, 0o600],
    observer,
    fixtureOnly,
    consumeBytes(bytes, identity) {
      secret = strictUtf8(bytes, label).trim();
      if (secret.length < 32 || secret.length > 4096
          || authorityKeyId(secret) !== expectedKeyId) {
        throw new Error(
          `${label} does not match the independently configured key ID`,
        );
      }
      return consume === null
        ? secret
        : consume(secret, identity);
    },
  });
  return {
    ...snapshot,
    keyId: expectedKeyId,
    secret,
  };
}

export function validateAuthorityExpectations({
  subjectId,
  campaignDigest,
  deploymentDigest,
  keyId,
} = {}) {
  if (!ID.test(String(subjectId || ''))
      || !DIGEST.test(String(campaignDigest || ''))
      || !DIGEST.test(String(deploymentDigest || ''))
      || !KEY_ID.test(String(keyId || ''))) {
    throw new Error(
      'expected subject, campaign digest, deployment digest, and HMAC key ID are required',
    );
  }
  return {
    subjectId,
    campaignDigest,
    deploymentDigest,
    keyId,
  };
}

export function assertAuthorityBindings({
  subjectId,
  campaignDigest,
  deploymentDigest,
  keyId,
}, expected, label = 'authority input') {
  const pinned = validateAuthorityExpectations(expected);
  if (subjectId !== pinned.subjectId
      || campaignDigest !== pinned.campaignDigest
      || deploymentDigest !== pinned.deploymentDigest
      || keyId !== pinned.keyId) {
    throw new Error(`${label} differs from the independently configured authority identity`);
  }
  return true;
}
