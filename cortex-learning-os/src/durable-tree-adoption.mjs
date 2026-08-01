import fs from 'node:fs';
import path from 'node:path';

const DIRECTORY_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_DIRECTORY || 0)
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_CLOEXEC || 0);
const OBJECT_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);

function descriptorIdentity(descriptor) {
  const stat = fs.fstatSync(descriptor, { bigint: true });
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
    directory: stat.isDirectory(),
    file: stat.isFile(),
  };
}

function sameIdentity(left, right) {
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((field) => left[field] === right[field]);
}

function sameParentIdentity(left, right) {
  return [
    'dev', 'ino', 'uid', 'gid', 'mode', 'birthtimeNs', 'directory', 'file',
  ].every((field) => left[field] === right[field]);
}

function openDirectory(directory) {
  return fs.openSync(directory, DIRECTORY_FLAGS);
}

function assertReopenedDirectoryIdentity(directory, expected, label) {
  const descriptor = openDirectory(directory);
  try {
    if (!sameParentIdentity(descriptorIdentity(descriptor), expected)) {
      throw new Error(`${label} named parent changed across its durability barrier`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncPinnedTree(descriptor, displayPath) {
  const before = descriptorIdentity(descriptor);
  if (!before.directory) {
    throw new Error(`durable tree adoption root is not a directory: ${displayPath}`);
  }
  const names = fs.readdirSync(`/proc/self/fd/${descriptor}`).sort();
  for (const name of names) {
    if (!name || name === '.' || name === '..' || name.includes('/')) {
      throw new Error('durable tree adoption encountered an unsafe entry name');
    }
    const target = `/proc/self/fd/${descriptor}/${name}`;
    const child = fs.openSync(target, OBJECT_FLAGS);
    try {
      const childBefore = descriptorIdentity(child);
      if (childBefore.directory) {
        fsyncPinnedTree(child, path.join(displayPath, name));
      } else if (childBefore.file) {
        fs.fsyncSync(child);
      } else {
        throw new Error(
          `durable tree adoption encountered a special object: ${path.join(displayPath, name)}`,
        );
      }
      const childAfter = descriptorIdentity(child);
      const named = fs.openSync(target, OBJECT_FLAGS);
      try {
        if (!sameIdentity(childBefore, childAfter)
            || !sameIdentity(childAfter, descriptorIdentity(named))) {
          throw new Error(
            `durable tree adoption object changed while being synced: ${
              path.join(displayPath, name)
            }`,
          );
        }
      } finally {
        fs.closeSync(named);
      }
    } finally {
      fs.closeSync(child);
    }
  }
  fs.fsyncSync(descriptor);
  const after = descriptorIdentity(descriptor);
  if (!sameIdentity(before, after)) {
    throw new Error(`durable tree adoption directory changed while being synced: ${displayPath}`);
  }
}

export function durablyAdoptPublishedTree({
  targetPath,
  sourceParentPath = null,
  validate,
  label = 'published tree',
} = {}) {
  const resolvedTarget = path.resolve(String(targetPath || ''));
  const targetParentPath = path.dirname(resolvedTarget);
  const resolvedSourceParent = sourceParentPath === null
    ? null
    : path.resolve(String(sourceParentPath || ''));
  if (!path.isAbsolute(String(targetPath || ''))
      || resolvedTarget !== targetPath
      || resolvedTarget === path.parse(resolvedTarget).root
      || (resolvedSourceParent !== null
        && (!path.isAbsolute(String(sourceParentPath || ''))
          || resolvedSourceParent !== sourceParentPath))
      || typeof validate !== 'function') {
    throw new Error(`${label} durability adoption requires exact paths and validation`);
  }

  const targetParent = openDirectory(targetParentPath);
  let sourceParent = null;
  let target = null;
  let namedTarget = null;
  try {
    const targetParentBefore = descriptorIdentity(targetParent);
    if (!targetParentBefore.directory) {
      throw new Error(`${label} target parent is not a directory`);
    }
    if (resolvedSourceParent !== null && resolvedSourceParent !== targetParentPath) {
      sourceParent = openDirectory(resolvedSourceParent);
    }
    const sourceParentBefore = sourceParent === null
      ? null
      : descriptorIdentity(sourceParent);
    if (sourceParentBefore !== null && !sourceParentBefore.directory) {
      throw new Error(`${label} source parent is not a directory`);
    }

    target = fs.openSync(
      `/proc/self/fd/${targetParent}/${path.basename(resolvedTarget)}`,
      DIRECTORY_FLAGS,
    );
    const targetBefore = descriptorIdentity(target);
    validate();
    fsyncPinnedTree(target, resolvedTarget);
    if (sourceParent !== null) fs.fsyncSync(sourceParent);
    fs.fsyncSync(targetParent);

    const targetAfter = descriptorIdentity(target);
    const targetParentAfter = descriptorIdentity(targetParent);
    const sourceParentAfter = sourceParent === null
      ? null
      : descriptorIdentity(sourceParent);
    namedTarget = fs.openSync(
      `/proc/self/fd/${targetParent}/${path.basename(resolvedTarget)}`,
      DIRECTORY_FLAGS,
    );
    if (!sameIdentity(targetBefore, targetAfter)
        || !sameIdentity(targetAfter, descriptorIdentity(namedTarget))
        || !sameParentIdentity(targetParentBefore, targetParentAfter)
        || (sourceParentBefore !== null
          && !sameParentIdentity(sourceParentBefore, sourceParentAfter))) {
      throw new Error(`${label} inode or parent changed across its durability barrier`);
    }
    assertReopenedDirectoryIdentity(
      targetParentPath,
      targetParentAfter,
      `${label} target`,
    );
    if (sourceParent !== null) {
      assertReopenedDirectoryIdentity(
        resolvedSourceParent,
        sourceParentAfter,
        `${label} source`,
      );
    }
    const result = validate();
    if (!sameIdentity(targetAfter, descriptorIdentity(target))
        || !sameIdentity(targetAfter, descriptorIdentity(namedTarget))) {
      throw new Error(`${label} changed during post-barrier validation`);
    }
    return result;
  } finally {
    if (namedTarget !== null) fs.closeSync(namedTarget);
    if (target !== null) fs.closeSync(target);
    if (sourceParent !== null) fs.closeSync(sourceParent);
    fs.closeSync(targetParent);
  }
}
