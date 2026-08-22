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
const MAX_PUBLICATION_BYTES = 64 * 1024 * 1024;
const MAX_ADOPTION_SNAPSHOT_ATTEMPTS = 8;
const INJECTED_CRASH = Symbol('authenticated-publication-injected-crash');
const RESERVED_STAGE_TARGET = /^[.].+[.]publish-/;
const RESERVED_ROOT_STAGE_TARGET = /^[.].+[.]root-publish-/;
const IMMUTABLE_OBJECT_DIRECTORY = '.authenticated-objects';
const AUTHORITY_QUARANTINE_DIRECTORY = '.authenticated-quarantine';
const CONTENT_ADDRESSED_OBJECT = /^([0-9a-f]{64})[.]json$/;
const AUTHORITY_QUARANTINE_ENTRY =
  /^([0-9a-f]{64})-([0-9a-f]{64})[.]json$/;
const ROOT_STAGE_ENTRY =
  /^[.](.+)[.]root-publish-([0-9a-f]{64})-([0-9a-f]{32})[.]tmp$/;
const LEGACY_ROOT_STAGE_ENTRY =
  /^[.](.+)[.]root-publish-([0-9a-f]{32})[.]tmp$/;

function injectCrash(crashInjector, phase) {
  if (crashInjector === null || crashInjector === undefined) return;
  if (typeof crashInjector !== 'function') {
    throw new Error('authenticated publication crash injector is invalid');
  }
  try {
    crashInjector(phase);
  } catch (error) {
    if (error !== null && typeof error === 'object') error[INJECTED_CRASH] = true;
    throw error;
  }
}

function descriptorEntry(descriptor, name) {
  return `/proc/self/fd/${descriptor}/${name}`;
}

function safeAncestor(stat, trustedFilesystemUid, effectiveUid) {
  const stickyWorldWritable = (stat.mode & 0o1000n) !== 0n
    && (stat.mode & 0o002n) !== 0n;
  return stat.isDirectory()
    && stat.nlink > 0n
    && [trustedFilesystemUid, effectiveUid].includes(stat.uid)
    && ((stat.mode & 0o022n) === 0n
      || (stickyWorldWritable && stat.uid === trustedFilesystemUid));
}

function openPublicationDirectory(directoryPath, {
  create,
  tightenFinal,
  allowedFinalModes = [0o700],
} = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('authenticated publication requires Linux descriptor traversal');
  }
  const resolved = path.resolve(directoryPath);
  const root = path.parse(resolved).root;
  const components = resolved.slice(root.length).split(path.sep).filter(Boolean);
  const effectiveUid = BigInt(process.geteuid());
  const effectiveGid = BigInt(process.getegid());
  if (!Array.isArray(allowedFinalModes)
      || allowedFinalModes.length < 1
      || allowedFinalModes.some((mode) => (
        !Number.isInteger(mode) || mode < 0 || mode > 0o7777
      ))) {
    throw new Error('authenticated publication parent mode policy is invalid');
  }
  const finalModes = new Set(allowedFinalModes.map((mode) => BigInt(mode)));
  let current = fs.openSync(root, DIRECTORY_FLAGS);
  let traversed = root;
  let createdAny = false;
  try {
    const trustedFilesystemUid = fs.fstatSync(current, { bigint: true }).uid;
    for (const component of components) {
      const ancestor = fs.fstatSync(current, { bigint: true });
      if (!safeAncestor(ancestor, trustedFilesystemUid, effectiveUid)) {
        throw new Error(`authenticated publication ancestor is unsafe: ${traversed}`);
      }
      const childView = descriptorEntry(current, component);
      let child;
      try {
        child = fs.openSync(childView, DIRECTORY_FLAGS);
      } catch (error) {
        if (error.code !== 'ENOENT' || create !== true) throw error;
        try {
          fs.mkdirSync(childView, { mode: 0o700 });
          fs.fsyncSync(current);
          createdAny = true;
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        child = fs.openSync(childView, DIRECTORY_FLAGS);
      }
      fs.closeSync(current);
      current = child;
      traversed = path.join(traversed, component);
    }
    const before = fs.fstatSync(current, { bigint: true });
    if (!before.isDirectory()
        || before.nlink < 1n
        || before.uid !== effectiveUid
        || before.gid !== effectiveGid) {
      throw new Error(`authenticated publication parent is unsafe: ${resolved}`);
    }
    if (tightenFinal === true
        && !finalModes.has(before.mode & 0o7777n)) {
      throw new Error(
        `authenticated publication parent must already be owner-only with an allowed protected mode: ${resolved}`,
      );
    }
    const after = fs.fstatSync(current, { bigint: true });
    if (!after.isDirectory()
        || after.nlink < 1n
        || after.uid !== effectiveUid
        || after.gid !== effectiveGid
        || !finalModes.has(after.mode & 0o7777n)) {
      throw new Error(`authenticated publication parent is unsafe: ${resolved}`);
    }
    const mountId = linuxDescriptorMountId(current);
    if (createdAny || tightenFinal === true) fs.fsyncSync(current);
    return {
      descriptor: current,
      identity: {
        dev: after.dev,
        ino: after.ino,
        uid: after.uid,
        gid: after.gid,
        mode: after.mode & 0o7777n,
        nlink: after.nlink,
        mountId,
      },
      mutationIdentity: {
        mtimeNs: after.mtimeNs,
        ctimeNs: after.ctimeNs,
        birthtimeNs: after.birthtimeNs,
      },
      path: resolved,
    };
  } catch (error) {
    fs.closeSync(current);
    throw error;
  }
}

function samePublicationDirectoryIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.mountId === right.mountId;
}

function samePublicationDirectoryMutationIdentity(left, right) {
  return left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

function assertNamedDirectoryIdentity(handle) {
  const named = openPublicationDirectory(handle.path, {
    create: false,
    tightenFinal: false,
  });
  try {
    const observed = named.identity;
    const expected = handle.identity;
    if (!samePublicationDirectoryIdentity(observed, expected)) {
      throw new Error('authenticated publication parent identity changed');
    }
  } finally {
    fs.closeSync(named.descriptor);
  }
}

function descriptorFileIdentity(descriptor) {
  const stat = fs.fstatSync(descriptor, { bigint: true });
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode & 0o7777n,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs,
    mountId: linuxDescriptorMountId(descriptor),
  };
}

function readExactDescriptorBytes(descriptor, expectedLength) {
  if (!Number.isSafeInteger(expectedLength)
      || expectedLength < 0
      || expectedLength > MAX_PUBLICATION_BYTES) {
    throw new Error('authenticated publication snapshot length is unsafe');
  }
  const bytes = Buffer.alloc(expectedLength);
  let offset = 0;
  while (offset < expectedLength) {
    const read = fs.readSync(
      descriptor,
      bytes,
      offset,
      expectedLength - offset,
      offset,
    );
    if (read === 0) break;
    offset += read;
  }
  const extra = Buffer.alloc(1);
  const extraBytes = fs.readSync(
    descriptor,
    extra,
    0,
    1,
    expectedLength,
  );
  return offset === expectedLength && extraBytes === 0 ? bytes : null;
}

function disappearedEntry(name) {
  return Object.assign(
    new Error(`authenticated publication entry disappeared while opening: ${name}`),
    { code: 'ENOENT' },
  );
}

function stableFileAt(handle, name, expectedBytes = null, {
  allowEmpty = false,
} = {}) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(descriptorEntry(handle.descriptor, name), FILE_FLAGS);
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    if (before.nlink < 1n) throw disappearedEntry(name);
    if (!before.isFile()
        || before.dev !== handle.identity.dev
        || beforeMountId !== handle.identity.mountId
        || before.uid !== handle.identity.uid
        || before.gid !== BigInt(process.getegid())
        || (before.mode & 0o7777n) !== 0o600n
        || (!allowEmpty && before.size < 1n)
        || before.size > BigInt(MAX_PUBLICATION_BYTES)
        || (expectedBytes !== null
          && before.size !== BigInt(expectedBytes.length))) {
      throw new Error(`authenticated publication entry is unsafe: ${name}`);
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const after = fs.fstatSync(descriptor, { bigint: true });
    namedDescriptor = fs.openSync(
      descriptorEntry(handle.descriptor, name),
      FILE_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const namedMountId = linuxDescriptorMountId(namedDescriptor);
    if (after.nlink < 1n || named.nlink < 1n) {
      throw disappearedEntry(name);
    }
    if (bytes === null
        || BigInt(bytes.length) !== before.size
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.uid !== before.uid
        || after.gid !== before.gid
        || after.mode !== before.mode
        || after.nlink !== before.nlink
        || after.size !== before.size
        || after.mtimeNs !== before.mtimeNs
        || after.ctimeNs !== before.ctimeNs
        || after.birthtimeNs !== before.birthtimeNs
        || named.dev !== after.dev
        || named.ino !== after.ino
        || named.uid !== after.uid
        || named.gid !== after.gid
        || named.mode !== after.mode
        || named.nlink !== after.nlink
        || named.size !== after.size
        || named.mtimeNs !== after.mtimeNs
        || named.ctimeNs !== after.ctimeNs
        || named.birthtimeNs !== after.birthtimeNs) {
      throw new Error(`authenticated publication entry changed while reading: ${name}`);
    }
    if (namedMountId !== beforeMountId) {
      throw new Error(`authenticated publication entry mount changed while reading: ${name}`);
    }
    fs.closeSync(namedDescriptor);
    namedDescriptor = null;
    return {
      bytes,
      descriptor,
      identity: {
        dev: before.dev,
        ino: before.ino,
        uid: before.uid,
        gid: before.gid,
        mode: before.mode & 0o7777n,
        nlink: before.nlink,
        size: before.size,
        mtimeNs: before.mtimeNs,
        ctimeNs: before.ctimeNs,
        birthtimeNs: before.birthtimeNs,
        mountId: beforeMountId,
      },
      name,
    };
  } catch (error) {
    if (namedDescriptor !== null) {
      fs.closeSync(namedDescriptor);
      namedDescriptor = null;
    }
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    throw error;
  }
}

function closeStableFile(entry) {
  if (entry?.descriptor !== null && entry?.descriptor !== undefined) {
    fs.closeSync(entry.descriptor);
    entry.descriptor = null;
  }
}

function revalidatePinnedFile(
  entry,
  expectedBytes,
  authenticateBytes,
  changedMessage,
) {
  const before = descriptorFileIdentity(entry.descriptor);
  const bytes = readExactDescriptorBytes(entry.descriptor, expectedBytes.length);
  const after = descriptorFileIdentity(entry.descriptor);
  if (bytes === null
      || !bytes.equals(expectedBytes)
      || authenticateBytes(bytes) !== true
      || !sameUnchangedPublishedInode(entry.identity, before)
      || !sameUnchangedPublishedInode(before, after)) {
    throw new Error(changedMessage);
  }
}

function samePublishedInode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.birthtimeNs === right.birthtimeNs
    && left.mountId === right.mountId;
}

function sameUnchangedPublishedInode(left, right) {
  return samePublishedInode(left, right)
    && left.nlink === right.nlink
    && left.ctimeNs === right.ctimeNs;
}

function revalidateFinalNamedTarget({
  handle,
  targetName,
  selected,
  authenticateBytes,
  crashInjector,
  crashPhase,
  changedMessage,
}) {
  const named = openPublicationDirectory(handle.path, {
    create: false,
    tightenFinal: false,
  });
  let pinned = null;
  let committedParent = null;
  let rebound = null;
  let commitWitness = null;
  let commitWitnessParent = null;
  let durableCommitWitness = null;
  let durableCommitWitnessParent = null;
  try {
    if (!samePublicationDirectoryIdentity(named.identity, handle.identity)) {
      throw new Error('authenticated publication parent identity changed');
    }
    injectCrash(crashInjector, crashPhase);
    pinned = authenticatedTargetEntry(
      named,
      targetName,
      authenticateBytes,
    );
    if (pinned === null
        || pinned.identity.nlink !== 1n
        || !sameUnchangedPublishedInode(selected.identity, pinned.identity)
        || !pinned.bytes.equals(selected.bytes)) {
      throw new Error(changedMessage);
    }
    fs.fsyncSync(pinned.descriptor);
    fs.fsyncSync(named.descriptor);

    committedParent = openPublicationDirectory(handle.path, {
      create: false,
      tightenFinal: false,
    });
    if (!samePublicationDirectoryIdentity(
      committedParent.identity,
      handle.identity,
    ) || !samePublicationDirectoryIdentity(
      committedParent.identity,
      named.identity,
    ) || !samePublicationDirectoryMutationIdentity(
      committedParent.mutationIdentity,
      named.mutationIdentity,
    )) {
      throw new Error(
        'authenticated publication parent identity changed during named-parent operation',
      );
    }

    injectCrash(crashInjector, `${crashPhase}_pinned`);
    rebound = authenticatedTargetEntry(
      committedParent,
      targetName,
      authenticateBytes,
    );
    if (rebound === null
        || rebound.identity.nlink !== 1n
        || !sameUnchangedPublishedInode(pinned.identity, rebound.identity)
        || !rebound.bytes.equals(pinned.bytes)) {
      throw new Error(changedMessage);
    }
    fs.fsyncSync(rebound.descriptor);
    fs.fsyncSync(committedParent.descriptor);

    // Close the freshly resolved name while the earlier named-target
    // descriptor remains pinned, then re-read that pinned inode.  This binds
    // in-place changes that do not alter parent-directory metadata as well as
    // unlink/relink substitutions at the final commit boundary.
    closeStableFile(rebound);
    rebound = null;

    const namedAfter = openPublicationDirectory(handle.path, {
      create: false,
      tightenFinal: false,
    });
    try {
      const committedAfterStat = fs.fstatSync(
        committedParent.descriptor,
        { bigint: true },
      );
      const committedAfter = {
        dev: committedAfterStat.dev,
        ino: committedAfterStat.ino,
        uid: committedAfterStat.uid,
        gid: committedAfterStat.gid,
        mode: committedAfterStat.mode & 0o7777n,
        nlink: committedAfterStat.nlink,
        mountId: linuxDescriptorMountId(committedParent.descriptor),
      };
      const committedAfterMutation = {
        mtimeNs: committedAfterStat.mtimeNs,
        ctimeNs: committedAfterStat.ctimeNs,
        birthtimeNs: committedAfterStat.birthtimeNs,
      };
      if (!samePublicationDirectoryIdentity(
        namedAfter.identity,
        handle.identity,
      ) || !samePublicationDirectoryIdentity(
        committedAfter,
        committedParent.identity,
      ) || !samePublicationDirectoryIdentity(
        namedAfter.identity,
        committedAfter,
      ) || !samePublicationDirectoryMutationIdentity(
        namedAfter.mutationIdentity,
        named.mutationIdentity,
      ) || !samePublicationDirectoryMutationIdentity(
        committedAfterMutation,
        committedParent.mutationIdentity,
      )) {
        throw new Error(
          'authenticated publication parent identity changed during named-parent operation',
        );
      }
      revalidatePinnedFile(
        pinned,
        selected.bytes,
        authenticateBytes,
        changedMessage,
      );
      fs.fsyncSync(pinned.descriptor);
      fs.fsyncSync(namedAfter.descriptor);
    } finally {
      fs.closeSync(namedAfter.descriptor);
    }

    // The pinned inode above deliberately outlives every freshly resolved
    // target descriptor.  Close it before the last path witness so a target
    // name change in that close-to-return boundary cannot inherit the
    // successful pinned snapshot.  The witness is resolved through a new
    // no-follow traversal and must retain both the selected inode and the
    // directory mutation identity established by the preceding commit.
    closeStableFile(pinned);
    pinned = null;
    injectCrash(crashInjector, `${crashPhase}_before_commit_witness`);
    commitWitnessParent = openPublicationDirectory(handle.path, {
      create: false,
      tightenFinal: false,
    });
    if (!samePublicationDirectoryIdentity(
      commitWitnessParent.identity,
      handle.identity,
    ) || !samePublicationDirectoryIdentity(
      commitWitnessParent.identity,
      committedParent.identity,
    ) || !samePublicationDirectoryMutationIdentity(
      commitWitnessParent.mutationIdentity,
      committedParent.mutationIdentity,
    )) {
      throw new Error(
        'authenticated publication parent identity changed before final commit witness',
      );
    }
    commitWitness = authenticatedTargetEntry(
      commitWitnessParent,
      targetName,
      authenticateBytes,
    );
    if (commitWitness === null
        || commitWitness.identity.nlink !== 1n
        || !sameUnchangedPublishedInode(
          selected.identity,
          commitWitness.identity,
        )
        || !commitWitness.bytes.equals(selected.bytes)) {
      throw new Error(changedMessage);
    }
    fs.fsyncSync(commitWitness.descriptor);
    fs.fsyncSync(commitWitnessParent.descriptor);
    injectCrash(
      crashInjector,
      `${crashPhase}_after_commit_witness_fsync`,
    );

    // The final durability barrier is itself an observable operation. Re-read
    // both the pinned inode and its freshly resolved name after that barrier so
    // an in-place write or unlink/relink during fsync cannot be reported as a
    // successful authenticated publication.
    revalidatePinnedFile(
      commitWitness,
      selected.bytes,
      authenticateBytes,
      changedMessage,
    );
    durableCommitWitnessParent = openPublicationDirectory(handle.path, {
      create: false,
      tightenFinal: false,
    });
    if (!samePublicationDirectoryIdentity(
      durableCommitWitnessParent.identity,
      handle.identity,
    ) || !samePublicationDirectoryIdentity(
      durableCommitWitnessParent.identity,
      commitWitnessParent.identity,
    ) || !samePublicationDirectoryMutationIdentity(
      durableCommitWitnessParent.mutationIdentity,
      commitWitnessParent.mutationIdentity,
    )) {
      throw new Error(
        'authenticated publication parent changed across final durability barrier',
      );
    }
    durableCommitWitness = authenticatedTargetEntry(
      durableCommitWitnessParent,
      targetName,
      authenticateBytes,
    );
    if (durableCommitWitness === null
        || durableCommitWitness.identity.nlink !== 1n
        || !sameUnchangedPublishedInode(
          commitWitness.identity,
          durableCommitWitness.identity,
        )
        || !durableCommitWitness.bytes.equals(commitWitness.bytes)) {
      throw new Error(changedMessage);
    }
    return {
      parentIdentity: durableCommitWitnessParent.identity,
      parentMutationIdentity: durableCommitWitnessParent.mutationIdentity,
      targetIdentity: durableCommitWitness.identity,
      targetBytes: durableCommitWitness.bytes,
    };
  } finally {
    closeStableFile(durableCommitWitness);
    if (durableCommitWitnessParent !== null) {
      fs.closeSync(durableCommitWitnessParent.descriptor);
    }
    closeStableFile(commitWitness);
    if (commitWitnessParent !== null) {
      fs.closeSync(commitWitnessParent.descriptor);
    }
    closeStableFile(rebound);
    closeStableFile(pinned);
    if (committedParent !== null) fs.closeSync(committedParent.descriptor);
    fs.closeSync(named.descriptor);
  }
}

function revalidateAfterPinnedDescriptorRelease({
  handle,
  targetName,
  snapshot,
  authenticateBytes,
  crashInjector,
  crashPhase,
  confirmationCrashPhase,
  changedMessage,
}) {
  injectCrash(crashInjector, crashPhase);
  const confirmSnapshot = () => {
    const parent = openPublicationDirectory(handle.path, {
      create: false,
      tightenFinal: false,
    });
    let target = null;
    try {
      if (!samePublicationDirectoryIdentity(parent.identity, handle.identity)
          || !samePublicationDirectoryIdentity(
            parent.identity,
            snapshot.parentIdentity,
          )
          || !samePublicationDirectoryMutationIdentity(
            parent.mutationIdentity,
            snapshot.parentMutationIdentity,
          )) {
        throw new Error(
          'authenticated publication parent changed after pinned descriptor release',
        );
      }
      target = authenticatedTargetEntry(
        parent,
        targetName,
        authenticateBytes,
      );
      if (target === null
          || target.identity.nlink !== 1n
          || !sameUnchangedPublishedInode(
            snapshot.targetIdentity,
            target.identity,
          )
          || !target.bytes.equals(snapshot.targetBytes)) {
        throw new Error(changedMessage);
      }
    } finally {
      closeStableFile(target);
      fs.closeSync(parent.descriptor);
    }
  };
  confirmSnapshot();
  injectCrash(crashInjector, confirmationCrashPhase);
  // The first return witness deliberately closes both of its descriptors.
  // Resolve the parent and target once more after that descriptor-free
  // interval so a close-triggered unlink, replacement, or rewrite cannot
  // inherit the earlier successful snapshot.
  confirmSnapshot();
}

function stagingEntries(handle, targetName, expectedBytes) {
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^[.]${escaped}[.]publish-[0-9a-f]{32}[.]tmp$`);
  const prefix = `.${targetName}.publish-`;
  const entries = [];
  for (const name of fs.readdirSync(`/proc/self/fd/${handle.descriptor}`).sort()) {
    if (!name.startsWith(prefix)) continue;
    if (!pattern.test(name)) {
      throw new Error(`authenticated publication staging name is unsafe: ${name}`);
    }
    let entry;
    try {
      entry = stableFileAt(handle, name, null, { allowEmpty: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    entry.exact = entry.bytes.equals(expectedBytes);
    entries.push(entry);
  }
  return entries;
}

function unlinkEntry(handle, name) {
  fs.unlinkSync(descriptorEntry(handle.descriptor, name));
}

function authenticatedTargetEntry(handle, targetName, authenticateBytes) {
  let target;
  try {
    target = stableFileAt(handle, targetName);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    if (authenticateBytes(target.bytes) !== true) {
      throw new Error(
        'authenticated publication target entry is unsafe or unauthenticated',
      );
    }
    return target;
  } catch (error) {
    closeStableFile(target);
    throw error;
  }
}

function targetEntry(handle, targetName, expectedBytes, authenticateBytes) {
  const target = authenticatedTargetEntry(
    handle,
    targetName,
    authenticateBytes,
  );
  if (target === null) return null;
  if (!target.bytes.equals(expectedBytes)) {
    closeStableFile(target);
    throw new Error(
      'authenticated publication target already exists with different bytes',
    );
  }
  return target;
}

function adoptExistingTarget(
  handle,
  targetName,
  expectedBytes,
  authenticateBytes,
  crashInjector,
) {
  for (let attempt = 0; attempt < MAX_ADOPTION_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const target = authenticatedTargetEntry(
      handle,
      targetName,
      authenticateBytes,
    );
    if (target === null) return false;
    const byteIdentical = target.bytes.equals(expectedBytes);
    let committed = null;
    let final = null;
    let checkpoint = null;
    let staging = [];
    let snapshotChanged = false;
    let removedTargetAlias = false;
    let releasedDescriptorSnapshot = null;
    let publicationCommitted = false;
    try {
      injectCrash(crashInjector, 'after_adopt_target_open');
      staging = stagingEntries(handle, targetName, expectedBytes);
      const aliases = staging.filter((entry) => (
        entry.identity.dev === target.identity.dev
        && entry.identity.ino === target.identity.ino
      ));
      removedTargetAlias = aliases.length > 0;
      const independent = staging.filter((entry) => !aliases.includes(entry));
      if (target.identity.nlink !== BigInt(aliases.length + 1)
          || independent.some((entry) => entry.identity.nlink !== 1n)) {
        snapshotChanged = true;
      } else {
        fs.fsyncSync(target.descriptor);
        fs.fsyncSync(handle.descriptor);
        injectCrash(crashInjector, 'after_adopt_fsync');
        for (const entry of staging) {
          try {
            unlinkEntry(handle, entry.name);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        if (staging.length > 0) {
          fs.fsyncSync(target.descriptor);
          fs.fsyncSync(handle.descriptor);
          injectCrash(crashInjector, 'after_adopt_cleanup_fsync');
        }
      }
      if (snapshotChanged) {
        if (attempt + 1 === MAX_ADOPTION_SNAPSHOT_ATTEMPTS) {
          throw new Error('authenticated publication target has an unknown hard link');
        }
        continue;
      }
      checkpoint = authenticatedTargetEntry(
        handle,
        targetName,
        authenticateBytes,
      );
      if (checkpoint === null) {
        throw new Error('authenticated publication target disappeared during adoption');
      }
      const checkpointSamePublication = samePublishedInode(
        target.identity,
        checkpoint.identity,
      ) && checkpoint.bytes.equals(target.bytes);
      if (!checkpointSamePublication) {
        throw new Error('authenticated publication target inode changed during adoption');
      }
      if (checkpoint.identity.nlink !== 1n) {
        if (attempt + 1 === MAX_ADOPTION_SNAPSHOT_ATTEMPTS) {
          throw new Error('authenticated publication target has an unknown hard link');
        }
        continue;
      }
      const checkpointIdentityExact = removedTargetAlias
        ? samePublishedInode(target.identity, checkpoint.identity)
        : sameUnchangedPublishedInode(target.identity, checkpoint.identity);
      if (!checkpointIdentityExact) {
        throw new Error('authenticated publication target inode changed during adoption');
      }
      fs.fsyncSync(checkpoint.descriptor);
      fs.fsyncSync(handle.descriptor);
      injectCrash(crashInjector, 'before_adopt_final_revalidation');
      final = authenticatedTargetEntry(
        handle,
        targetName,
        authenticateBytes,
      );
      if (final === null) {
        throw new Error('authenticated publication target disappeared during adoption');
      }
      const finalSamePublication = samePublishedInode(
        checkpoint.identity,
        final.identity,
      ) && final.bytes.equals(checkpoint.bytes);
      if (!finalSamePublication) {
        throw new Error('authenticated publication target inode changed during adoption');
      }
      if (final.identity.nlink !== 1n) {
        if (attempt + 1 === MAX_ADOPTION_SNAPSHOT_ATTEMPTS) {
          throw new Error('authenticated publication target has an unknown hard link');
        }
        continue;
      }
      if (!sameUnchangedPublishedInode(checkpoint.identity, final.identity)) {
        throw new Error('authenticated publication target inode changed during adoption');
      }
      fs.fsyncSync(final.descriptor);
      fs.fsyncSync(handle.descriptor);
      assertNamedDirectoryIdentity(handle);
      injectCrash(crashInjector, 'before_adopt_named_target_revalidation');
      committed = authenticatedTargetEntry(
        handle,
        targetName,
        authenticateBytes,
      );
      if (committed === null
          || committed.identity.nlink !== 1n
          || !sameUnchangedPublishedInode(final.identity, committed.identity)
          || !committed.bytes.equals(final.bytes)) {
        throw new Error(
          'authenticated publication target changed after adoption parent revalidation',
        );
      }
      fs.fsyncSync(committed.descriptor);
      fs.fsyncSync(handle.descriptor);
      releasedDescriptorSnapshot = revalidateFinalNamedTarget({
        handle,
        targetName,
        selected: committed,
        authenticateBytes,
        crashInjector,
        crashPhase: 'before_adopt_final_named_target_revalidation',
        changedMessage:
          'authenticated publication target changed during final named-parent adoption revalidation',
      });
      if (!byteIdentical) {
        throw new Error(
          'authenticated publication target already exists with different bytes',
        );
      }
      publicationCommitted = true;
    } finally {
      closeStableFile(committed);
      closeStableFile(final);
      closeStableFile(checkpoint);
      closeStableFile(target);
      for (const entry of staging) closeStableFile(entry);
    }
    if (publicationCommitted) {
      revalidateAfterPinnedDescriptorRelease({
        handle,
        targetName,
        snapshot: releasedDescriptorSnapshot,
        authenticateBytes,
        crashInjector,
        crashPhase:
          'after_adopt_pinned_descriptor_release_before_return_witness',
        confirmationCrashPhase:
          'after_adopt_return_witness_descriptor_release_before_confirmation',
        changedMessage:
          'authenticated publication target changed after adoption pinned descriptor release',
      });
      return true;
    }
  }
  throw new Error('authenticated publication adoption did not stabilize');
}

function exactRecoverableStage(handle, targetName, expectedBytes) {
  const staging = stagingEntries(handle, targetName, expectedBytes);
  const exact = staging.filter((entry) => entry.exact);
  try {
    if (staging.some((entry) => entry.identity.nlink !== 1n)) {
      throw new Error('authenticated publication staging file has an unknown hard link');
    }
    return exact.length === 0 ? null : exact[0].name;
  } finally {
    for (const entry of staging) closeStableFile(entry);
  }
}

function createStage(
  handle,
  targetName,
  expectedBytes,
  crashInjector,
) {
  const name = `.${targetName}.publish-${crypto.randomBytes(16).toString('hex')}.tmp`;
  const descriptor = fs.openSync(
    descriptorEntry(handle.descriptor, name),
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
    0o600,
  );
  try {
    injectCrash(crashInjector, 'after_stage_create');
    fs.writeFileSync(descriptor, expectedBytes);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.closeSync(descriptor);
    if (error?.[INJECTED_CRASH] !== true) {
      try {
        unlinkEntry(handle, name);
        fs.fsyncSync(handle.descriptor);
      } catch {}
    }
    throw error;
  }
  fs.closeSync(descriptor);
  injectCrash(crashInjector, 'after_stage_file_fsync');
  fs.fsyncSync(handle.descriptor);
  return name;
}

function readRootSealedEntry(directoryDescriptor, directoryMountId, name, expectedBytes) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(
      descriptorEntry(directoryDescriptor, name),
      FILE_FLAGS,
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    if (!before.isFile()
        || before.uid !== 0n
        || before.gid !== 0n
        || (before.mode & 0o7777n) !== 0o400n
        || before.nlink !== 1n
        || before.size !== BigInt(expectedBytes.length)
        || beforeMountId !== directoryMountId) {
      throw new Error(`root-authority publication entry is unsafe: ${name}`);
    }
    const bytes = readExactDescriptorBytes(descriptor, expectedBytes.length);
    const after = fs.fstatSync(descriptor, { bigint: true });
    namedDescriptor = fs.openSync(
      descriptorEntry(directoryDescriptor, name),
      FILE_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const namedMountId = linuxDescriptorMountId(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      expectedBytes.length,
    );
    const committed = fs.fstatSync(descriptor, { bigint: true });
    for (const observed of [after, named, committed]) {
      if (observed.dev !== before.dev
          || observed.ino !== before.ino
          || observed.uid !== before.uid
          || observed.gid !== before.gid
          || observed.mode !== before.mode
          || observed.nlink !== before.nlink
          || observed.size !== before.size
          || observed.mtimeNs !== before.mtimeNs
          || observed.ctimeNs !== before.ctimeNs
          || observed.birthtimeNs !== before.birthtimeNs) {
        throw new Error(`root-authority publication entry changed while reading: ${name}`);
      }
    }
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(expectedBytes)
        || !committedBytes.equals(expectedBytes)
        || namedMountId !== beforeMountId) {
      throw new Error(`root-authority publication bytes changed while reading: ${name}`);
    }
    return {
      bytes,
      descriptor,
      identity: descriptorFileIdentity(descriptor),
      name,
    };
  } catch (error) {
    if (namedDescriptor !== null) {
      fs.closeSync(namedDescriptor);
      namedDescriptor = null;
    }
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
  }
}

function openRootAuthoritySubdirectory(handle, name, {
  create,
  label,
}) {
  const view = descriptorEntry(handle.descriptor, name);
  let descriptor;
  try {
    descriptor = fs.openSync(view, DIRECTORY_FLAGS);
  } catch (error) {
    if (error.code === 'ENOENT' && create !== true) return null;
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(view, { mode: 0o700 });
    fs.fsyncSync(handle.descriptor);
    descriptor = fs.openSync(view, DIRECTORY_FLAGS);
  }
  const stat = fs.fstatSync(descriptor, { bigint: true });
  if (!stat.isDirectory()
      || stat.uid !== 0n
      || stat.gid !== 0n
      || stat.nlink < 1n
      || ![0o500n, 0o700n].includes(stat.mode & 0o7777n)
      || linuxDescriptorMountId(descriptor) !== handle.identity.mountId) {
    fs.closeSync(descriptor);
    throw new Error(`root-authority publication ${label} directory is unsafe`);
  }
  if ((stat.mode & 0o7777n) !== 0o500n) {
    fs.fchmodSync(descriptor, 0o500);
    fs.fsyncSync(descriptor);
  }
  const sealed = fs.fstatSync(descriptor, { bigint: true });
  if (!sealed.isDirectory()
      || sealed.uid !== 0n
      || sealed.gid !== 0n
      || sealed.nlink < 1n
      || (sealed.mode & 0o7777n) !== 0o500n) {
    fs.closeSync(descriptor);
    throw new Error(
      `root-authority publication ${label} directory did not seal`,
    );
  }
  return {
    descriptor,
    mountId: linuxDescriptorMountId(descriptor),
    name,
  };
}

function openRootObjectDirectory(handle, { create }) {
  return openRootAuthoritySubdirectory(
    handle,
    IMMUTABLE_OBJECT_DIRECTORY,
    { create, label: 'object' },
  );
}

function openRootAuthorityQuarantineDirectory(handle, { create }) {
  return openRootAuthoritySubdirectory(
    handle,
    AUTHORITY_QUARANTINE_DIRECTORY,
    { create, label: 'quarantine' },
  );
}

function sealRootAuthorityDirectory(handle) {
  fs.fchmodSync(handle.descriptor, 0o500);
  fs.fsyncSync(handle.descriptor);
  const sealed = fs.fstatSync(handle.descriptor, { bigint: true });
  if (!sealed.isDirectory()
      || sealed.uid !== 0n
      || sealed.gid !== 0n
      || sealed.nlink < 1n
      || (sealed.mode & 0o7777n) !== 0o500n
      || linuxDescriptorMountId(handle.descriptor) !== handle.identity.mountId) {
    throw new Error('root-authority publication parent did not seal');
  }
}

function confirmRootAuthorityHandoff({
  handle,
  objectDirectory,
  objectName,
  targetName,
  expectedBytes,
  authenticateBytes,
}) {
  const namedParent = openPublicationDirectory(handle.path, {
    create: false,
    tightenFinal: false,
    allowedFinalModes: [0o500],
  });
  let namedObjectDirectoryDescriptor = null;
  let object = null;
  let published = null;
  try {
    const pinnedParentStat = fs.fstatSync(handle.descriptor, { bigint: true });
    const pinnedParentIdentity = {
      dev: pinnedParentStat.dev,
      ino: pinnedParentStat.ino,
      uid: pinnedParentStat.uid,
      gid: pinnedParentStat.gid,
      mode: pinnedParentStat.mode & 0o7777n,
      nlink: pinnedParentStat.nlink,
      mountId: linuxDescriptorMountId(handle.descriptor),
    };
    const objectDirectoryStat = fs.fstatSync(
      objectDirectory.descriptor,
      { bigint: true },
    );
    namedObjectDirectoryDescriptor = fs.openSync(
      descriptorEntry(
        namedParent.descriptor,
        IMMUTABLE_OBJECT_DIRECTORY,
      ),
      DIRECTORY_FLAGS,
    );
    const namedObjectDirectoryStat = fs.fstatSync(
      namedObjectDirectoryDescriptor,
      { bigint: true },
    );
    const namedObjectDirectoryMountId = linuxDescriptorMountId(
      namedObjectDirectoryDescriptor,
    );
    if (!samePublicationDirectoryIdentity(
      namedParent.identity,
      pinnedParentIdentity,
    )
        || objectDirectoryStat.uid !== 0n
        || objectDirectoryStat.gid !== 0n
        || objectDirectoryStat.nlink < 1n
        || (objectDirectoryStat.mode & 0o7777n) !== 0o500n
        || linuxDescriptorMountId(objectDirectory.descriptor)
          !== objectDirectory.mountId
        || namedObjectDirectoryStat.dev !== objectDirectoryStat.dev
        || namedObjectDirectoryStat.ino !== objectDirectoryStat.ino
        || namedObjectDirectoryStat.uid !== objectDirectoryStat.uid
        || namedObjectDirectoryStat.gid !== objectDirectoryStat.gid
        || namedObjectDirectoryStat.mode !== objectDirectoryStat.mode
        || namedObjectDirectoryStat.nlink !== objectDirectoryStat.nlink
        || namedObjectDirectoryMountId !== objectDirectory.mountId) {
      throw new Error(
        'root-authority protected naming layer changed before final handoff',
      );
    }
    object = readRootSealedEntry(
      namedObjectDirectoryDescriptor,
      namedObjectDirectoryMountId,
      objectName,
      expectedBytes,
    );
    published = readRootSealedEntry(
      namedParent.descriptor,
      namedParent.identity.mountId,
      targetName,
      expectedBytes,
    );
    if (object === null
        || published === null
        || !object.bytes.equals(published.bytes)
        || authenticateBytes(object.bytes) !== true
        || authenticateBytes(published.bytes) !== true) {
      throw new Error(
        'root-authority final content-addressed handoff did not authenticate',
      );
    }
    fs.fsyncSync(object.descriptor);
    fs.fsyncSync(published.descriptor);
    fs.fsyncSync(namedObjectDirectoryDescriptor);
    fs.fsyncSync(objectDirectory.descriptor);
    fs.fsyncSync(namedParent.descriptor);
  } finally {
    closeStableFile(object);
    closeStableFile(published);
    if (namedObjectDirectoryDescriptor !== null) {
      fs.closeSync(namedObjectDirectoryDescriptor);
    }
    fs.closeSync(namedParent.descriptor);
  }
}

function reconcileRootStages(
  directoryDescriptor,
  directoryMountId,
  finalName,
  prefix,
  expectedBytes,
) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stagePattern = new RegExp(
    `^${escapedPrefix}(?:[0-9a-f]{64}-)?[0-9a-f]{32}[.]tmp$`,
  );
  for (const name of fs.readdirSync(`/proc/self/fd/${directoryDescriptor}`).sort()) {
    if (!name.startsWith(prefix)) continue;
    if (!stagePattern.test(name)) {
      throw new Error(`root-authority crash stage name is unsafe: ${name}`);
    }
    let descriptor = null;
    try {
      descriptor = fs.openSync(
        descriptorEntry(directoryDescriptor, name),
        FILE_FLAGS,
      );
      const stat = fs.fstatSync(descriptor, { bigint: true });
      let linkedToFinal = false;
      if (stat.nlink === 2n) {
        let finalDescriptor = null;
        try {
          finalDescriptor = fs.openSync(
            descriptorEntry(directoryDescriptor, finalName),
            FILE_FLAGS,
          );
          const finalStat = fs.fstatSync(finalDescriptor, { bigint: true });
          linkedToFinal = finalStat.dev === stat.dev && finalStat.ino === stat.ino;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          linkedToFinal = false;
        } finally {
          if (finalDescriptor !== null) fs.closeSync(finalDescriptor);
        }
      }
      const stageMode = stat.mode & 0o7777n;
      const safe = stat.isFile()
        && stat.uid === 0n
        && stat.gid === 0n
        && [1n, 2n].includes(stat.nlink)
        && (stat.nlink === 1n || linkedToFinal)
        && (stat.nlink === 1n
          ? [0o400n, 0o600n].includes(stageMode)
          : stageMode === 0o400n)
        && linuxDescriptorMountId(descriptor) === directoryMountId
        && stat.size <= BigInt(expectedBytes.length);
      const exact = safe
        && stat.size === BigInt(expectedBytes.length)
        && readExactDescriptorBytes(descriptor, expectedBytes.length)?.equals(
          expectedBytes,
        );
      fs.closeSync(descriptor);
      descriptor = null;
      if (!safe || (stageMode === 0o400n && !exact)) {
        throw new Error(`root-authority crash stage is unsafe: ${name}`);
      }
      // A one-link stage is not reachable through the committed name. It may
      // contain any prefix of the intended bytes when the broker lost power
      // inside write(2), so a mode-0600 stage can be discarded after its
      // protected metadata and bounded length are authenticated. Mode 0400 is
      // the broker's durable "bytes complete" marker: both one-link pre-link
      // stages and two-link committed stages must retain the exact intended
      // bytes. Corruption after sealing is evidence, not an incomplete write.
      fs.unlinkSync(descriptorEntry(directoryDescriptor, name));
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }
  fs.fsyncSync(directoryDescriptor);
}

function canonicalRootAuthorityJson(bytes) {
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return false;
    const record = JSON.parse(text);
    return bytes.equals(Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'));
  } catch {
    return false;
  }
}

function rootAuthorityQuarantineName(stageName, bytes) {
  return `${
    crypto.createHash('sha256').update(stageName, 'utf8').digest('hex')
  }-${
    crypto.createHash('sha256').update(bytes).digest('hex')
  }.json`;
}

function readRootAuthorityQuarantineEntry(
  quarantineDirectory,
  name,
  {
    expectedBytes = null,
    expectedStageName = null,
    allowTransitLink = false,
  } = {},
) {
  const match = AUTHORITY_QUARANTINE_ENTRY.exec(name);
  if (match === null
      || (expectedStageName !== null
        && crypto.createHash('sha256')
          .update(expectedStageName, 'utf8')
          .digest('hex') !== match[1])) {
    throw new Error(
      `root-authority quarantine entry name is unsafe: ${name}`,
    );
  }
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(
      descriptorEntry(quarantineDirectory.descriptor, name),
      FILE_FLAGS,
    );
    const before = descriptorFileIdentity(descriptor);
    if (before.uid !== 0n
        || before.gid !== 0n
        || before.mode !== 0o400n
        || ![1n, ...(allowTransitLink ? [2n, 3n] : [])].includes(before.nlink)
        || before.size < 2n
        || before.size > BigInt(MAX_PUBLICATION_BYTES)
        || before.mountId !== quarantineDirectory.mountId) {
      throw new Error(
        `root-authority quarantine entry metadata is unsafe: ${name}`,
      );
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const after = descriptorFileIdentity(descriptor);
    namedDescriptor = fs.openSync(
      descriptorEntry(quarantineDirectory.descriptor, name),
      FILE_FLAGS,
    );
    const named = descriptorFileIdentity(namedDescriptor);
    if (bytes === null
        || !canonicalRootAuthorityJson(bytes)
        || crypto.createHash('sha256').update(bytes).digest('hex') !== match[2]
        || (expectedBytes !== null
          && (!Buffer.isBuffer(expectedBytes) || !bytes.equals(expectedBytes)))
        || !sameUnchangedPublishedInode(before, after)
        || !sameUnchangedPublishedInode(after, named)) {
      throw new Error(
        `root-authority quarantine entry changed or is corrupt: ${name}`,
      );
    }
    return {
      bytes,
      descriptor,
      identity: before,
      name,
    };
  } catch (error) {
    if (namedDescriptor !== null) {
      fs.closeSync(namedDescriptor);
      namedDescriptor = null;
    }
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
  }
}

function assertRootAuthorityQuarantineNamespace(
  quarantineDirectory,
  { allowTransitLinks },
) {
  for (const name of fs.readdirSync(
    `/proc/self/fd/${quarantineDirectory.descriptor}`,
  ).sort()) {
    const entry = readRootAuthorityQuarantineEntry(
      quarantineDirectory,
      name,
      { allowTransitLink: allowTransitLinks },
    );
    closeStableFile(entry);
  }
}

function quarantineLegacyRootAuthorityStage({
  crashInjector,
  finalName,
  quarantineDirectory,
  sourceDescriptor,
  sourceMountId,
  stageDescriptor,
  stageName,
  sealedBytes,
}) {
  const quarantineName = rootAuthorityQuarantineName(
    stageName,
    sealedBytes,
  );
  let stageIdentity = descriptorFileIdentity(stageDescriptor);
  if (stageIdentity.mountId !== sourceMountId
      || stageIdentity.mode !== 0o400n
      || ![1n, 2n, 3n].includes(stageIdentity.nlink)) {
    throw new Error(
      `legacy root-authority stage cannot be quarantined safely: ${stageName}`,
    );
  }
  let finalDescriptor = null;
  const openLinkedFinal = () => {
    let descriptor = null;
    try {
      descriptor = fs.openSync(
        descriptorEntry(sourceDescriptor, finalName),
        FILE_FLAGS,
      );
      const identity = descriptorFileIdentity(descriptor);
      if (identity.mountId !== sourceMountId
          || identity.uid !== 0n
          || identity.gid !== 0n
          || identity.mode !== 0o400n
          || identity.size !== stageIdentity.size) {
        throw new Error(
          `legacy root-authority stage final alias is unsafe: ${stageName}`,
        );
      }
      if (identity.dev !== stageIdentity.dev
          || identity.ino !== stageIdentity.ino) {
        fs.closeSync(descriptor);
        return null;
      }
      return descriptor;
    } catch (error) {
      if (descriptor !== null) fs.closeSync(descriptor);
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  let quarantined = null;
  try {
    finalDescriptor = openLinkedFinal();
    quarantined = readRootAuthorityQuarantineEntry(
      quarantineDirectory,
      quarantineName,
      {
        expectedBytes: sealedBytes,
        expectedStageName: stageName,
        allowTransitLink: true,
      },
    );
    if (quarantined === null) {
      const expectedSourceLinks = finalDescriptor === null ? 1n : 2n;
      if (stageIdentity.nlink !== expectedSourceLinks) {
        throw new Error(
          `legacy root-authority stage has an unknown hard link: ${stageName}`,
        );
      }
      fs.linkSync(
        descriptorEntry(sourceDescriptor, stageName),
        descriptorEntry(quarantineDirectory.descriptor, quarantineName),
      );
      injectCrash(crashInjector, 'root_quarantine_after_link');
      quarantined = readRootAuthorityQuarantineEntry(
        quarantineDirectory,
        quarantineName,
        {
          expectedBytes: sealedBytes,
          expectedStageName: stageName,
          allowTransitLink: true,
        },
      );
      fs.fsyncSync(quarantined.descriptor);
      fs.fsyncSync(quarantineDirectory.descriptor);
      injectCrash(crashInjector, 'root_quarantine_after_link_fsync');
    }
    stageIdentity = descriptorFileIdentity(stageDescriptor);
    if (finalDescriptor !== null) {
      fs.closeSync(finalDescriptor);
      finalDescriptor = null;
    }
    finalDescriptor = openLinkedFinal();
    const expectedTransitLinks = finalDescriptor === null ? 2n : 3n;
    const quarantinedIdentity = descriptorFileIdentity(
      quarantined.descriptor,
    );
    if (stageIdentity.dev !== quarantined.identity.dev
        || stageIdentity.ino !== quarantined.identity.ino
        || stageIdentity.mountId !== quarantined.identity.mountId
        || stageIdentity.nlink !== expectedTransitLinks
        || quarantinedIdentity.nlink !== expectedTransitLinks) {
      throw new Error(
        `legacy root-authority stage quarantine handoff changed: ${stageName}`,
      );
    }
    if (finalDescriptor !== null) {
      fs.closeSync(finalDescriptor);
      finalDescriptor = null;
      fs.unlinkSync(descriptorEntry(sourceDescriptor, finalName));
      injectCrash(crashInjector, 'root_quarantine_after_final_unlink');
      fs.fsyncSync(sourceDescriptor);
      stageIdentity = descriptorFileIdentity(stageDescriptor);
      if (stageIdentity.nlink !== 2n
          || descriptorFileIdentity(quarantined.descriptor).nlink !== 2n) {
        throw new Error(
          `legacy root-authority linked alias quarantine changed: ${stageName}`,
        );
      }
    }
    fs.unlinkSync(descriptorEntry(sourceDescriptor, stageName));
    injectCrash(crashInjector, 'root_quarantine_after_source_unlink');
    fs.fsyncSync(sourceDescriptor);
  } finally {
    if (finalDescriptor !== null) fs.closeSync(finalDescriptor);
    closeStableFile(quarantined);
  }
  const committed = readRootAuthorityQuarantineEntry(
    quarantineDirectory,
    quarantineName,
    {
      expectedBytes: sealedBytes,
      expectedStageName: stageName,
    },
  );
  try {
    fs.fsyncSync(committed.descriptor);
    fs.fsyncSync(quarantineDirectory.descriptor);
  } finally {
    closeStableFile(committed);
  }
}

function sealedRootAuthorityStageValid(bytes, stage, {
  contentAddressed,
  requestedExpectedBytes,
  requestedFinalName,
}) {
  if (bytes === null || !canonicalRootAuthorityJson(bytes)) return false;
  const bytesDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (stage.expectedSha256 !== null) {
    return bytesDigest === stage.expectedSha256
      && (!contentAddressed
        || CONTENT_ADDRESSED_OBJECT.exec(stage.finalName)?.[1]
          === stage.expectedSha256);
  }
  if (contentAddressed) {
    return CONTENT_ADDRESSED_OBJECT.exec(stage.finalName)?.[1] === bytesDigest;
  }
  // Legacy alias stages did not encode their intended bytes. They can only be
  // recovered automatically when the retry supplies the same final name and
  // exact bytes. A sealed legacy stage for another alias is unprovable and is
  // retained as repair evidence rather than discarded as an incomplete write.
  return stage.finalName === requestedFinalName
    && Buffer.isBuffer(requestedExpectedBytes)
    && bytes.equals(requestedExpectedBytes);
}

function rootStageIdentity(stageName, { contentAddressed }) {
  const currentMatch = ROOT_STAGE_ENTRY.exec(stageName);
  const legacyMatch = currentMatch === null
    ? LEGACY_ROOT_STAGE_ENTRY.exec(stageName)
    : null;
  const match = currentMatch || legacyMatch;
  if (match === null) return null;
  const finalName = match[1];
  if (finalName.length < 1
      || finalName === '.'
      || finalName === '..'
      || /[\0/\x00-\x1f\x7f]/.test(finalName)
      || finalName === IMMUTABLE_OBJECT_DIRECTORY
      || finalName === AUTHORITY_QUARANTINE_DIRECTORY
      || RESERVED_STAGE_TARGET.test(finalName)
      || RESERVED_ROOT_STAGE_TARGET.test(finalName)
      || (contentAddressed && !CONTENT_ADDRESSED_OBJECT.test(finalName))) {
    return null;
  }
  return {
    expectedSha256: currentMatch?.[2] || null,
    finalName,
  };
}

function reconcileRootAuthorityNamespaceStages(
  directoryDescriptor,
  directoryMountId,
  {
    crashInjector = null,
    contentAddressed,
    quarantineDirectory = null,
    requestedExpectedBytes = null,
    requestedFinalName = null,
  },
) {
  // Recovery is namespace-wide rather than scoped to the next requested
  // digest/name. A power loss may precede any signed successor selection, so a
  // different idempotent retry must still either authenticate and unlink the
  // old broker stage or fail closed on it. Linked stages are committed inodes:
  // retain their final name and remove only the redundant temporary link.
  let changed = false;
  for (const stageName of fs.readdirSync(
    `/proc/self/fd/${directoryDescriptor}`,
  ).sort()) {
    if (!stageName.startsWith('.') || !stageName.includes('.root-publish-')) {
      continue;
    }
    const stageIdentity = rootStageIdentity(stageName, { contentAddressed });
    if (stageIdentity === null) {
      throw new Error(
        `root-authority crash stage name is unsafe: ${stageName}`,
      );
    }
    const { finalName } = stageIdentity;
    let stageDescriptor = null;
    let finalDescriptor = null;
    try {
      stageDescriptor = fs.openSync(
        descriptorEntry(directoryDescriptor, stageName),
        FILE_FLAGS,
      );
      const stage = fs.fstatSync(stageDescriptor, { bigint: true });
      const stageMountId = linuxDescriptorMountId(stageDescriptor);
      const stageMode = stage.mode & 0o7777n;
      if (!stage.isFile()
          || stage.uid !== 0n
          || stage.gid !== 0n
          || ![0o400n, 0o600n].includes(stageMode)
          || ![
            1n,
            2n,
            ...(stageIdentity.expectedSha256 === null ? [3n] : []),
          ].includes(stage.nlink)
          || (stage.nlink > 1n && stageMode !== 0o400n)
          || stage.size > BigInt(MAX_PUBLICATION_BYTES)
          || stageMountId !== directoryMountId) {
        throw new Error(
          `root-authority crash stage is unsafe: ${stageName}`,
        );
      }
      const sealedBytes = stageMode === 0o400n
        ? readExactDescriptorBytes(
          stageDescriptor,
          Number(stage.size),
        )
        : null;
      const sealedStageValid = stageMode !== 0o400n
        || sealedRootAuthorityStageValid(
          sealedBytes,
          stageIdentity,
          {
            contentAddressed,
            requestedExpectedBytes,
            requestedFinalName,
          },
        );
      const canonicalLegacyAlias = stageMode === 0o400n
        && stageIdentity.expectedSha256 === null
        && contentAddressed === false
        && canonicalRootAuthorityJson(sealedBytes);
      let quarantineInProgress = false;
      if (canonicalLegacyAlias && quarantineDirectory !== null) {
        const quarantineName = rootAuthorityQuarantineName(
          stageName,
          sealedBytes,
        );
        const quarantined = readRootAuthorityQuarantineEntry(
          quarantineDirectory,
          quarantineName,
          {
            expectedBytes: sealedBytes,
            expectedStageName: stageName,
            allowTransitLink: true,
          },
        );
        if (quarantined !== null) {
          quarantineInProgress = quarantined.identity.dev === stage.dev
            && quarantined.identity.ino === stage.ino
            && quarantined.identity.nlink === stage.nlink
            && [2n, 3n].includes(stage.nlink);
          closeStableFile(quarantined);
          if (!quarantineInProgress) {
            throw new Error(
              `legacy root-authority stage quarantine identity conflicts: ${stageName}`,
            );
          }
        }
      }
      if (stage.nlink === 3n && !quarantineInProgress) {
        throw new Error(
          `legacy root-authority stage has an unknown hard link: ${stageName}`,
        );
      }
      const ambiguousLegacyAlias = canonicalLegacyAlias && !sealedStageValid;
      if ((ambiguousLegacyAlias || quarantineInProgress)
          && quarantineDirectory !== null) {
        quarantineLegacyRootAuthorityStage({
          crashInjector,
          finalName,
          quarantineDirectory,
          sourceDescriptor: directoryDescriptor,
          sourceMountId: directoryMountId,
          stageDescriptor,
          stageName,
          sealedBytes,
        });
        fs.closeSync(stageDescriptor);
        stageDescriptor = null;
        changed = true;
        continue;
      }
      if (!sealedStageValid) {
        throw new Error(
          `sealed root-authority crash stage is unsafe: ${stageName}`,
        );
      }
      if (stage.nlink === 2n) {
        finalDescriptor = fs.openSync(
          descriptorEntry(directoryDescriptor, finalName),
          FILE_FLAGS,
        );
        const final = fs.fstatSync(finalDescriptor, { bigint: true });
        if (!final.isFile()
            || final.dev !== stage.dev
            || final.ino !== stage.ino
            || final.uid !== stage.uid
            || final.gid !== stage.gid
            || final.mode !== stage.mode
            || final.nlink !== stage.nlink
            || final.size !== stage.size
            || final.mtimeNs !== stage.mtimeNs
            || final.ctimeNs !== stage.ctimeNs
            || final.birthtimeNs !== stage.birthtimeNs
            || linuxDescriptorMountId(finalDescriptor) !== directoryMountId
            || stageMode !== 0o400n) {
          throw new Error(
            `root-authority linked crash stage is unsafe: ${stageName}`,
          );
        }
      }
      if (finalDescriptor !== null) {
        fs.closeSync(finalDescriptor);
        finalDescriptor = null;
      }
      fs.closeSync(stageDescriptor);
      stageDescriptor = null;
      fs.unlinkSync(descriptorEntry(directoryDescriptor, stageName));
      changed = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `root-authority crash stage lost its committed name: ${stageName}`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      if (finalDescriptor !== null) fs.closeSync(finalDescriptor);
      if (stageDescriptor !== null) fs.closeSync(stageDescriptor);
    }
  }
  if (changed) fs.fsyncSync(directoryDescriptor);
}

function createRootSealedEntry(
  directoryDescriptor,
  directoryMountId,
  name,
  expectedBytes,
  crashInjector,
  phasePrefix,
) {
  const stagePrefix = `.${name}.root-publish-`;
  reconcileRootStages(
    directoryDescriptor,
    directoryMountId,
    name,
    stagePrefix,
    expectedBytes,
  );
  const existing = readRootSealedEntry(
    directoryDescriptor,
    directoryMountId,
    name,
    expectedBytes,
  );
  if (existing !== null) {
    closeStableFile(existing);
    return false;
  }
  const expectedSha256 = crypto.createHash('sha256')
    .update(expectedBytes)
    .digest('hex');
  const stageName = `${stagePrefix}${expectedSha256}-${
    crypto.randomBytes(16).toString('hex')
  }.tmp`;
  const stageDescriptor = fs.openSync(
    descriptorEntry(directoryDescriptor, stageName),
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
    0o600,
  );
  try {
    injectCrash(crashInjector, `${phasePrefix}_after_stage_create`);
    fs.writeFileSync(stageDescriptor, expectedBytes);
    fs.fsyncSync(stageDescriptor);
    fs.fchmodSync(stageDescriptor, 0o400);
    fs.fsyncSync(stageDescriptor);
  } finally {
    fs.closeSync(stageDescriptor);
  }
  injectCrash(crashInjector, `${phasePrefix}_after_stage_fsync`);
  try {
    fs.linkSync(
      descriptorEntry(directoryDescriptor, stageName),
      descriptorEntry(directoryDescriptor, name),
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  injectCrash(crashInjector, `${phasePrefix}_after_link`);
  fs.fsyncSync(directoryDescriptor);
  fs.unlinkSync(descriptorEntry(directoryDescriptor, stageName));
  fs.fsyncSync(directoryDescriptor);
  const committed = readRootSealedEntry(
    directoryDescriptor,
    directoryMountId,
    name,
    expectedBytes,
  );
  if (committed === null) {
    throw new Error('root-authority publication disappeared after commit');
  }
  closeStableFile(committed);
  return true;
}

function publishThroughRootAuthorityBroker({
  target,
  targetName,
  expectedBytes,
  authenticateBytes,
  crashInjector,
  fixtureOnly,
}) {
  assertInitialRootAuthority({ fixtureOnly });
  const handle = openPublicationDirectory(path.dirname(target), {
    create: true,
    tightenFinal: true,
    allowedFinalModes: [0o500, 0o700],
  });
  if (handle.identity.uid !== 0n || handle.identity.gid !== 0n) {
    fs.closeSync(handle.descriptor);
    throw new Error('root-authority publication parent is not root-owned');
  }
  let objectDirectory = null;
  let quarantineDirectory = null;
  try {
    // The broker performs every mutation through root-held descriptors after
    // removing directory write permission. A candidate UID therefore never
    // regains name-mutation authority, including at the broker's final close.
    sealRootAuthorityDirectory(handle);
    quarantineDirectory = openRootAuthorityQuarantineDirectory(
      handle,
      { create: false },
    );
    if (quarantineDirectory !== null) {
      assertRootAuthorityQuarantineNamespace(
        quarantineDirectory,
        { allowTransitLinks: true },
      );
    }
    const ensureQuarantineDirectory = () => {
      if (quarantineDirectory === null) {
        quarantineDirectory = openRootAuthorityQuarantineDirectory(
          handle,
          { create: true },
        );
      }
      return quarantineDirectory;
    };
    const rootStageNames = fs.readdirSync(
      `/proc/self/fd/${handle.descriptor}`,
    );
    const hasLegacyAliasStage = rootStageNames.some((name) => (
      name.startsWith('.')
      && name.includes('.root-publish-')
      && LEGACY_ROOT_STAGE_ENTRY.test(name)
    ));
    reconcileRootAuthorityNamespaceStages(
      handle.descriptor,
      handle.identity.mountId,
      {
        crashInjector,
        contentAddressed: false,
        quarantineDirectory: hasLegacyAliasStage
          ? ensureQuarantineDirectory()
          : quarantineDirectory,
        requestedExpectedBytes: expectedBytes,
        requestedFinalName: targetName,
      },
    );
    if (quarantineDirectory !== null) {
      assertRootAuthorityQuarantineNamespace(
        quarantineDirectory,
        { allowTransitLinks: false },
      );
    }
    objectDirectory = openRootObjectDirectory(handle, { create: true });
    reconcileRootAuthorityNamespaceStages(
      objectDirectory.descriptor,
      objectDirectory.mountId,
      { contentAddressed: true },
    );
    const objectDigest = crypto.createHash('sha256').update(expectedBytes).digest('hex');
    const objectName = `${objectDigest}.json`;
    createRootSealedEntry(
      objectDirectory.descriptor,
      objectDirectory.mountId,
      objectName,
      expectedBytes,
      crashInjector,
      'root_object',
    );
    injectCrash(crashInjector, 'root_broker_after_object_commit');
    createRootSealedEntry(
      handle.descriptor,
      handle.identity.mountId,
      targetName,
      expectedBytes,
      crashInjector,
      'root_target',
    );
    injectCrash(crashInjector, 'root_broker_after_target_commit');
    const object = readRootSealedEntry(
      objectDirectory.descriptor,
      objectDirectory.mountId,
      objectName,
      expectedBytes,
    );
    const published = readRootSealedEntry(
      handle.descriptor,
      handle.identity.mountId,
      targetName,
      expectedBytes,
    );
    try {
      if (object === null
          || published === null
          || !object.bytes.equals(published.bytes)
          || authenticateBytes(object.bytes) !== true
          || authenticateBytes(published.bytes) !== true) {
        throw new Error('root-authority content-addressed publication did not authenticate');
      }
      fs.fsyncSync(object.descriptor);
      fs.fsyncSync(published.descriptor);
      fs.fsyncSync(objectDirectory.descriptor);
      fs.fsyncSync(handle.descriptor);
    } finally {
      closeStableFile(object);
      closeStableFile(published);
    }
    sealRootAuthorityDirectory(handle);
    injectCrash(crashInjector, 'root_broker_after_authority_handoff');
    confirmRootAuthorityHandoff({
      handle,
      objectDirectory,
      objectName,
      targetName,
      expectedBytes,
      authenticateBytes,
    });
    // The content descriptors used by the final confirmation are now closed.
    // An unprivileged candidate may run at this exact boundary, but both
    // root-owned naming layers remain mode 0500, so it has no kernel-granted
    // authority to replace the committed alias or content-addressed object.
    injectCrash(
      crashInjector,
      'root_broker_after_final_confirmation_descriptor_release',
    );
    return target;
  } finally {
    if (quarantineDirectory !== null) {
      try {
        fs.fchmodSync(quarantineDirectory.descriptor, 0o500);
        fs.fsyncSync(quarantineDirectory.descriptor);
      } catch {}
      fs.closeSync(quarantineDirectory.descriptor);
    }
    if (objectDirectory !== null) {
      try {
        fs.fchmodSync(objectDirectory.descriptor, 0o500);
        fs.fsyncSync(objectDirectory.descriptor);
      } catch {}
      fs.closeSync(objectDirectory.descriptor);
    }
    try {
      sealRootAuthorityDirectory(handle);
    } catch {}
    fs.closeSync(handle.descriptor);
  }
}

export function atomicWriteAuthenticatedJson(targetPath, record, {
  authenticate = null,
  crashInjector = null,
  fixtureOnly = false,
  rootAuthorityBrokerFixture = false,
} = {}) {
  if (typeof targetPath !== 'string' || targetPath.length < 1) {
    throw new Error('authenticated publication target is required');
  }
  if (authenticate !== null
      && (typeof authenticate !== 'function' || authenticate(record) !== true)) {
    throw new Error('refusing to persist unauthenticated output');
  }
  const serialized = JSON.stringify(record, null, 2);
  if (typeof serialized !== 'string') {
    throw new Error('authenticated publication record is not JSON serializable');
  }
  const expectedBytes = Buffer.from(`${serialized}\n`, 'utf8');
  if (expectedBytes.length < 2 || expectedBytes.length > MAX_PUBLICATION_BYTES) {
    throw new Error('authenticated publication byte length is invalid');
  }
  const authenticateBytes = (bytes) => {
    try {
      const candidate = JSON.parse(bytes.toString('utf8'));
      const canonicalBytes = Buffer.from(
        `${JSON.stringify(candidate, null, 2)}\n`,
        'utf8',
      );
      return bytes.equals(canonicalBytes)
        && (authenticate === null || authenticate(candidate) === true);
    } catch {
      return false;
    }
  };
  if (authenticateBytes(expectedBytes) !== true) {
    throw new Error('refusing to persist unauthenticated serialized output');
  }
  if (typeof fixtureOnly !== 'boolean'
      || typeof rootAuthorityBrokerFixture !== 'boolean'
      || (rootAuthorityBrokerFixture && !fixtureOnly)) {
    throw new Error(
      'authenticated publication fixture authority policy is invalid',
    );
  }
  const target = path.resolve(targetPath);
  const targetName = path.basename(target);
  if (targetName === '.' || targetName === '..' || /[\0/]/.test(targetName)) {
    throw new Error('authenticated publication target name is unsafe');
  }
  if (/[\x00-\x1f\x7f]/.test(targetName)) {
    throw new Error(
      'authenticated publication target name contains a control character',
    );
  }
  if (targetName === IMMUTABLE_OBJECT_DIRECTORY
      || targetName === AUTHORITY_QUARANTINE_DIRECTORY
      || RESERVED_STAGE_TARGET.test(targetName)
      || RESERVED_ROOT_STAGE_TARGET.test(targetName)) {
    throw new Error(
      'authenticated publication target uses a reserved authority namespace',
    );
  }
  if (fixtureOnly !== true || rootAuthorityBrokerFixture) {
    return publishThroughRootAuthorityBroker({
      target,
      targetName,
      expectedBytes,
      authenticateBytes,
      crashInjector,
      fixtureOnly: rootAuthorityBrokerFixture,
    });
  }
  const handle = openPublicationDirectory(path.dirname(target), {
    create: true,
    tightenFinal: true,
  });
  let stageName = null;
  let publicationStage = null;
  try {
    if (adoptExistingTarget(
      handle,
      targetName,
      expectedBytes,
      authenticateBytes,
      crashInjector,
    )) {
      return target;
    }
    injectCrash(crashInjector, 'after_initial_target_absence');
    stageName = exactRecoverableStage(handle, targetName, expectedBytes);
    if (stageName === null) {
      stageName = createStage(
        handle,
        targetName,
        expectedBytes,
        crashInjector,
      );
      injectCrash(crashInjector, 'after_stage_fsync');
    }
    try {
      publicationStage = stableFileAt(handle, stageName, expectedBytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const adopted = adoptExistingTarget(
        handle,
        targetName,
        expectedBytes,
        authenticateBytes,
        crashInjector,
      );
      if (!adopted) throw error;
      return target;
    }
    if (publicationStage.identity.nlink !== 1n) {
      const adopted = adoptExistingTarget(
        handle,
        targetName,
        expectedBytes,
        authenticateBytes,
        crashInjector,
      );
      if (!adopted) {
        throw new Error('authenticated publication staging file has an unknown hard link');
      }
      return target;
    }
    if (!publicationStage.bytes.equals(expectedBytes)
        || authenticateBytes(publicationStage.bytes) !== true) {
      throw new Error('authenticated publication staging file is unsafe');
    }
    // A recoverable stage can have survived process death after its bytes became
    // visible but before the dead publisher reached either durability barrier.
    // Re-sync the selected inode and its name before using it as the source of
    // the no-replace link.  This is intentionally unconditional: a caller must
    // not have to distinguish a newly created stage from an adopted one.
    fs.fsyncSync(publicationStage.descriptor);
    fs.fsyncSync(handle.descriptor);
    injectCrash(crashInjector, 'after_prelink_stage_fsync');
    assertNamedDirectoryIdentity(handle);
    injectCrash(crashInjector, 'before_target_link_revalidation');
    let namedPublicationStage = null;
    try {
      namedPublicationStage = stableFileAt(handle, stageName, expectedBytes);
      const identityChanged = [
        'dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeNs', 'ctimeNs',
        'birthtimeNs', 'mountId',
      ].some((field) => (
        namedPublicationStage.identity[field] !== publicationStage.identity[field]
      ));
      if (identityChanged
          || namedPublicationStage.identity.nlink !== 1n
          || !namedPublicationStage.bytes.equals(expectedBytes)
          || authenticateBytes(namedPublicationStage.bytes) !== true) {
        const adopted = adoptExistingTarget(
          handle,
          targetName,
          expectedBytes,
          authenticateBytes,
          crashInjector,
        );
        if (!adopted) {
          throw new Error(
            'authenticated publication staging identity changed before no-replace link: exact bytes or authentication no longer match',
          );
        }
        return target;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const adopted = adoptExistingTarget(
        handle,
        targetName,
        expectedBytes,
        authenticateBytes,
        crashInjector,
      );
      if (!adopted) throw error;
      return target;
    } finally {
      closeStableFile(namedPublicationStage);
    }
    try {
      fs.linkSync(
        descriptorEntry(handle.descriptor, stageName),
        descriptorEntry(handle.descriptor, targetName),
      );
    } catch (error) {
      if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error;
      const adopted = adoptExistingTarget(
        handle,
        targetName,
        expectedBytes,
        authenticateBytes,
        crashInjector,
      );
      if (!adopted) throw error;
      return target;
    }
    injectCrash(crashInjector, 'after_target_link');
    const linked = targetEntry(handle, targetName, expectedBytes, authenticateBytes);
    try {
      if (linked === null) {
        throw new Error('authenticated publication target disappeared after no-replace link');
      }
      if (linked.identity.dev !== publicationStage.identity.dev
          || linked.identity.ino !== publicationStage.identity.ino
          || ![1n, 2n].includes(linked.identity.nlink)) {
        throw new Error('authenticated publication link transition is unsafe');
      }
      fs.fsyncSync(linked.descriptor);
      injectCrash(crashInjector, 'after_target_file_fsync');
      fs.fsyncSync(handle.descriptor);
    } finally {
      closeStableFile(linked);
    }
    injectCrash(crashInjector, 'after_target_link_fsync');
    try {
      unlinkEntry(handle, stageName);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    stageName = null;
    const staleStages = stagingEntries(handle, targetName, expectedBytes);
    try {
      if (staleStages.some((entry) => entry.identity.nlink !== 1n)) {
        throw new Error('authenticated publication staging file has an unknown hard link');
      }
      for (const entry of staleStages) {
        try {
          unlinkEntry(handle, entry.name);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    } finally {
      for (const entry of staleStages) closeStableFile(entry);
    }
    injectCrash(crashInjector, 'after_stage_unlink');
    fs.fsyncSync(publicationStage.descriptor);
    fs.fsyncSync(handle.descriptor);
    injectCrash(crashInjector, 'after_stage_unlink_fsync');
    const published = targetEntry(handle, targetName, expectedBytes, authenticateBytes);
    let committed = null;
    let releasedDescriptorSnapshot = null;
    try {
      if (published === null) {
        throw new Error('authenticated publication target disappeared after no-replace link');
      }
      if (!samePublishedInode(publicationStage.identity, published.identity)) {
        throw new Error('authenticated publication target inode changed after no-replace link');
      }
      if (published.identity.nlink !== 1n) {
        throw new Error('authenticated publication final link count is unsafe');
      }
      fs.fsyncSync(published.descriptor);
      fs.fsyncSync(handle.descriptor);
      assertNamedDirectoryIdentity(handle);
      injectCrash(crashInjector, 'before_publish_named_target_revalidation');
      committed = targetEntry(
        handle,
        targetName,
        expectedBytes,
        authenticateBytes,
      );
      if (committed === null
          || committed.identity.nlink !== 1n
          || !sameUnchangedPublishedInode(published.identity, committed.identity)
          || !committed.bytes.equals(published.bytes)) {
        throw new Error(
          'authenticated publication target changed after publication parent revalidation',
        );
      }
      fs.fsyncSync(committed.descriptor);
      fs.fsyncSync(handle.descriptor);
      releasedDescriptorSnapshot = revalidateFinalNamedTarget({
        handle,
        targetName,
        selected: committed,
        authenticateBytes,
        crashInjector,
        crashPhase: 'before_publish_final_named_target_revalidation',
        changedMessage:
          'authenticated publication target changed during final named-parent publication revalidation',
      });
    } finally {
      closeStableFile(committed);
      closeStableFile(published);
    }
    closeStableFile(publicationStage);
    publicationStage = null;
    revalidateAfterPinnedDescriptorRelease({
      handle,
      targetName,
      snapshot: releasedDescriptorSnapshot,
      authenticateBytes,
      crashInjector,
      crashPhase:
        'after_publish_pinned_descriptor_release_before_return_witness',
      confirmationCrashPhase:
        'after_publish_return_witness_descriptor_release_before_confirmation',
      changedMessage:
        'authenticated publication target changed after publisher pinned descriptor release',
    });
    return target;
  } catch (error) {
    if (stageName !== null && error?.[INJECTED_CRASH] !== true) {
      try {
        const candidate = stableFileAt(handle, stageName);
        try {
          if (candidate.identity.nlink === 1n) {
            unlinkEntry(handle, stageName);
            fs.fsyncSync(handle.descriptor);
          }
        } finally {
          closeStableFile(candidate);
        }
      } catch {}
    }
    throw error;
  } finally {
    closeStableFile(publicationStage);
    fs.closeSync(handle.descriptor);
  }
}
