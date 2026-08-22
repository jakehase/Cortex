import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { linuxDescriptorMountId } from './linux-descriptor-identity.mjs';
import { CLOS_ROOT } from './paths.mjs';

const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_CLOSURE_FILE_BYTES = 64 * 1024 * 1024;
const DIRECTORY_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_DIRECTORY || 0)
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_CLOEXEC || 0);
const FILE_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);
const GIT_EXECUTABLE = '/usr/bin/git';
const GIT_EXECUTABLE_CHILD_FD = 3;
const GIT_EXECUTABLE_CHILD_PATH =
  `/proc/self/fd/${GIT_EXECUTABLE_CHILD_FD}`;
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
  TZ: 'UTC',
});
const REPOSITORY_ROOT = path.resolve(CLOS_ROOT, '..');
const PRODUCT_PREFIX = path.relative(REPOSITORY_ROOT, CLOS_ROOT).split(path.sep).join('/');
const RUNTIME_PREFIXES = Object.freeze([
  `${PRODUCT_PREFIX}/schemas/`,
  `${PRODUCT_PREFIX}/scripts/`,
  `${PRODUCT_PREFIX}/src/`,
  'plugins/cortex-learning-os-live/',
]);

export const EXECUTION_CLOSURE_SCHEMA = 'cortex.learning_os.execution_closure.v2';

function git(args, options = {}) {
  const executable = openPinnedGitExecutable();
  try {
    const result = execFileSync(
      GIT_EXECUTABLE_CHILD_PATH,
      [
        '-c', 'core.fsmonitor=false',
        '-c', 'core.untrackedCache=false',
        '-C', REPOSITORY_ROOT,
        ...args,
      ],
      {
        encoding: options.encoding,
        env: GIT_ENVIRONMENT,
        maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe', executable.descriptor],
        timeout: options.timeout || 10_000,
      },
    );
    assertPinnedGitExecutable(executable);
    return result;
  } finally {
    closePinnedGitExecutable(executable);
  }
}

function safeRelative(relativePath) {
  const components = typeof relativePath === 'string'
    ? relativePath.split('/')
    : [];
  if (typeof relativePath !== 'string'
      || relativePath.length < 1
      || relativePath.length > 512
      || path.isAbsolute(relativePath)
      || /[\\\x00-\x1f\x7f]/.test(relativePath)
      || components.some((component) => (
        component.length < 1 || component === '.' || component === '..'
      ))) {
    throw new Error('product source path must be a safe relative path');
  }
  return relativePath;
}

export function assertSafeProductSourceRelativePath(relativePath) {
  return safeRelative(relativePath);
}

function safeRelativePathValid(relativePath) {
  try {
    return safeRelative(relativePath) === relativePath;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function gitBlobObjectId(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error('Git blob identity requires exact bytes');
  }
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
}

export function assertGitBlobObjectIdentity(
  bytes,
  expectedObjectId,
  label = 'committed product blob',
) {
  if (!Buffer.isBuffer(bytes)
      || !COMMIT.test(String(expectedObjectId || ''))
      || gitBlobObjectId(bytes) !== expectedObjectId) {
    throw new Error(`${label} bytes do not match their declared Git object ID`);
  }
  return true;
}

function descriptorIdentity(descriptor, stat = null) {
  const observed = stat || fs.fstatSync(descriptor, { bigint: true });
  return {
    dev: observed.dev,
    ino: observed.ino,
    uid: observed.uid,
    gid: observed.gid,
    mode: observed.mode,
    nlink: observed.nlink,
    size: observed.size,
    mtimeNs: observed.mtimeNs,
    ctimeNs: observed.ctimeNs,
    birthtimeNs: observed.birthtimeNs,
    mountId: linuxDescriptorMountId(descriptor),
  };
}

function sameDescriptorIdentity(left, right) {
  return Object.keys(left).every((field) => left[field] === right[field]);
}

function assertGitDirectoryAuthority(stat, authority, label) {
  if (!stat.isDirectory()
      || stat.nlink < 1n
      || stat.uid !== authority.uid
      || stat.gid !== authority.gid
      || (stat.mode & 0o7022n) !== 0n
      || (stat.mode & 0o111n) === 0n) {
    throw new Error(
      `Git source authority ancestor is not trusted immutable material: ${label}`,
    );
  }
}

function assertGitExecutableAuthority(stat, authority) {
  if (!stat.isFile()
      || stat.nlink !== 1n
      || stat.uid !== authority.uid
      || stat.gid !== authority.gid
      || (stat.mode & 0o7022n) !== 0n
      || (stat.mode & 0o111n) === 0n
      || stat.size < 1n
      || stat.size > BigInt(MAX_CLOSURE_FILE_BYTES)) {
    throw new Error(
      'Git source authority executable is not a bounded, single-link, trusted executable',
    );
  }
}

function openPinnedGitExecutable() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error(
      'Git source authority requires Linux descriptor-relative execution',
    );
  }
  const parsed = path.parse(GIT_EXECUTABLE);
  const components = GIT_EXECUTABLE.slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  const executableName = components.pop();
  const directories = [];
  let descriptor = null;
  let namedDescriptor = null;
  let retainDirectories = false;
  try {
    let current = fs.openSync(parsed.root, DIRECTORY_FLAGS);
    const rootStat = fs.fstatSync(current, { bigint: true });
    const authority = {
      uid: rootStat.uid,
      gid: rootStat.gid,
    };
    assertGitDirectoryAuthority(rootStat, authority, parsed.root);
    directories.push({
      descriptor: current,
      identity: descriptorIdentity(current, rootStat),
      label: parsed.root,
    });
    let traversed = parsed.root;
    for (const component of components) {
      current = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        DIRECTORY_FLAGS,
      );
      traversed = path.join(traversed, component);
      const stat = fs.fstatSync(current, { bigint: true });
      assertGitDirectoryAuthority(stat, authority, traversed);
      directories.push({
        descriptor: current,
        identity: descriptorIdentity(current, stat),
        label: traversed,
      });
    }
    const parentDescriptor = directories.at(-1).descriptor;
    descriptor = fs.openSync(
      `/proc/self/fd/${parentDescriptor}/${executableName}`,
      FILE_FLAGS,
    );
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    assertGitExecutableAuthority(beforeStat, authority);
    const before = descriptorIdentity(descriptor, beforeStat);
    namedDescriptor = fs.openSync(
      `/proc/self/fd/${parentDescriptor}/${executableName}`,
      FILE_FLAGS,
    );
    const namedStat = fs.fstatSync(namedDescriptor, { bigint: true });
    assertGitExecutableAuthority(namedStat, authority);
    const named = descriptorIdentity(namedDescriptor, namedStat);
    if (!sameDescriptorIdentity(before, named)) {
      throw new Error(
        'Git source authority executable changed during descriptor binding',
      );
    }
    fs.closeSync(namedDescriptor);
    namedDescriptor = null;
    const opened = {
      authority,
      descriptor,
      directories,
      executableName,
      identity: before,
      parentDescriptor,
    };
    retainDirectories = true;
    descriptor = null;
    return opened;
  } catch (error) {
    if (['ELOOP', 'ENOTDIR', 'ENXIO'].includes(error.code)) {
      throw new Error(
        'Git source authority executable contains a no-follow or special-file substitution',
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
    if (!retainDirectories) {
      for (const entry of directories.reverse()) {
        fs.closeSync(entry.descriptor);
      }
    }
  }
}

function assertPinnedGitExecutable(executable) {
  const afterStat = fs.fstatSync(executable.descriptor, { bigint: true });
  assertGitExecutableAuthority(afterStat, executable.authority);
  const after = descriptorIdentity(executable.descriptor, afterStat);
  let namedDescriptor = null;
  try {
    namedDescriptor = fs.openSync(
      `/proc/self/fd/${executable.parentDescriptor}/${executable.executableName}`,
      FILE_FLAGS,
    );
    const namedStat = fs.fstatSync(namedDescriptor, { bigint: true });
    assertGitExecutableAuthority(namedStat, executable.authority);
    const named = descriptorIdentity(namedDescriptor, namedStat);
    if (!sameDescriptorIdentity(executable.identity, after)
        || !sameDescriptorIdentity(after, named)) {
      throw new Error(
        'Git source authority executable changed across its descriptor-bound execution',
      );
    }
    for (const entry of executable.directories) {
      const current = descriptorIdentity(entry.descriptor);
      if (!sameDescriptorIdentity(entry.identity, current)) {
        throw new Error(
          `Git source authority ancestor changed during execution: ${entry.label}`,
        );
      }
    }
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
  }
}

function closePinnedGitExecutable(executable) {
  fs.closeSync(executable.descriptor);
  for (const entry of [...executable.directories].reverse()) {
    fs.closeSync(entry.descriptor);
  }
}

function readExactDescriptorBytes(descriptor, expectedLength) {
  if (!Number.isSafeInteger(expectedLength)
      || expectedLength < 0
      || expectedLength > MAX_CLOSURE_FILE_BYTES) {
    throw new Error('execution closure file size is unsafe');
  }
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

function readStableWorkingTreeFile(target, relative) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(target, FILE_FLAGS);
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    const before = descriptorIdentity(descriptor, beforeStat);
    if (!beforeStat.isFile()
        || beforeStat.nlink !== 1n
        || beforeStat.size < 0n
        || beforeStat.size > BigInt(MAX_CLOSURE_FILE_BYTES)) {
      throw new Error(
        `execution checkout contains an unsafe regular-file candidate: ${relative}`,
      );
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(beforeStat.size));
    const afterRead = descriptorIdentity(descriptor);
    namedDescriptor = fs.openSync(target, FILE_FLAGS);
    const named = descriptorIdentity(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      Number(beforeStat.size),
    );
    const committed = descriptorIdentity(descriptor);
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameDescriptorIdentity(before, afterRead)
        || !sameDescriptorIdentity(afterRead, named)
        || !sameDescriptorIdentity(named, committed)) {
      throw new Error(
        `execution checkout file changed during its descriptor-pinned snapshot: ${relative}`,
      );
    }
    return {
      bytes,
      stat: beforeStat,
    };
  } catch (error) {
    if (['ELOOP', 'ENXIO'].includes(error.code)) {
      throw new Error(
        `execution checkout contains a no-follow or special-file substitution: ${relative}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readStableProductFile(relative) {
  const components = safeRelative(relative).split('/');
  const opened = [];
  let rootDescriptor = null;
  let current = null;
  try {
    rootDescriptor = fs.openSync(CLOS_ROOT, DIRECTORY_FLAGS);
    current = rootDescriptor;
    const rootMountId = linuxDescriptorMountId(rootDescriptor);
    for (const component of components.slice(0, -1)) {
      const descriptor = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        DIRECTORY_FLAGS,
      );
      opened.push(descriptor);
      current = descriptor;
      if (linuxDescriptorMountId(descriptor) !== rootMountId) {
        throw new Error(
          `product input crosses a mount boundary: ${relative}`,
        );
      }
    }
    const stable = readStableWorkingTreeFile(
      `/proc/self/fd/${current}/${components.at(-1)}`,
      relative,
    );
    if (linuxDescriptorMountId(current) !== rootMountId) {
      throw new Error(`product input parent mount changed: ${relative}`);
    }
    return stable.bytes;
  } catch (error) {
    if (['ELOOP', 'ENOTDIR'].includes(error.code)) {
      throw new Error(
        `product input contains a no-follow path substitution: ${relative}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    for (const descriptor of opened.reverse()) fs.closeSync(descriptor);
    if (rootDescriptor !== null) fs.closeSync(rootDescriptor);
  }
}

function closureDigest(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function isRuntimePath(relativePath) {
  return RUNTIME_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function buildExecutionClosure({
  sourceCommit,
  sourceTree,
  productTree,
  files,
  directories = null,
  immutable = false,
} = {}) {
  const directoryPaths = new Set(Array.isArray(directories) ? directories : []);
  for (const file of files) {
    let parent = path.posix.dirname(file.path);
    while (parent !== '.') {
      directoryPaths.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const entries = [
    ...[...directoryPaths].map((entryPath) => ({
      path: entryPath,
      type: 'directory',
      uid: 0,
      gid: 0,
      mode: '0555',
    })),
    ...files.map((file) => ({
      path: file.path,
      type: 'file',
      uid: 0,
      gid: 0,
      mode: file.mode === '100755' ? '0555' : '0444',
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const runtimeFiles = files.filter((file) => isRuntimePath(file.path));
  const checkoutSha256 = closureDigest({ files, entries, immutable });
  const runtimeSha256 = closureDigest(runtimeFiles);
  const identity = {
    sourceCommit,
    sourceTree,
    productTree,
    checkoutSha256,
    runtimeSha256,
  };
  return {
    schemaVersion: EXECUTION_CLOSURE_SCHEMA,
    ...identity,
    closureSha256: closureDigest(identity),
    immutable,
    fileCount: files.length,
    runtimeFileCount: runtimeFiles.length,
    entryCount: entries.length,
    entries,
    files,
  };
}

function workingTreeSnapshot(repositoryRoot = REPOSITORY_ROOT, {
  excludeMutableRuntime = false,
  rootDescriptor = null,
} = {}) {
  if (rootDescriptor !== null
      && (!Number.isInteger(rootDescriptor) || rootDescriptor < 0)) {
    throw new Error('execution checkout root descriptor is invalid');
  }
  const files = [];
  const directories = ['plugins'];
  const ignored = (relative, entry) => (
    excludeMutableRuntime && (
      entry.name === '__pycache__'
    || (entry.isFile() && /[.]py[cod]$/.test(entry.name))
    || (relative.startsWith(`${PRODUCT_PREFIX}/proof-kernel/`)
      && ['.lake', '.toolchain', 'lake-manifest.json'].includes(entry.name))
    )
  );
  const walk = (
    descriptor,
    relativeDirectory,
    expectedMountId,
    parentDescriptor,
    name,
  ) => {
    const before = descriptorIdentity(descriptor);
    if (before.mountId !== expectedMountId) {
      throw new Error(
        `execution checkout crosses a mount boundary: ${relativeDirectory}`,
      );
    }
    directories.push(relativeDirectory);
    for (const entry of fs.readdirSync(
      `/proc/self/fd/${descriptor}`,
      { withFileTypes: true },
    )
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const target = `/proc/self/fd/${descriptor}/${entry.name}`;
      const relative = `${relativeDirectory}/${entry.name}`;
      safeRelative(relative);
      if (entry.isSymbolicLink()) {
        throw new Error(`execution checkout contains a symlink: ${relative}`);
      }
      if (ignored(relative, entry)) continue;
      if (entry.isDirectory()) {
        let child = null;
        try {
          child = fs.openSync(target, DIRECTORY_FLAGS);
          walk(
            child,
            relative,
            expectedMountId,
            descriptor,
            entry.name,
          );
        } catch (error) {
          if (['ELOOP', 'ENOTDIR'].includes(error.code)) {
            throw new Error(
              `execution checkout contains a no-follow directory substitution: ${relative}`,
              { cause: error },
            );
          }
          throw error;
        } finally {
          if (child !== null) fs.closeSync(child);
        }
      } else if (entry.isFile()) {
        const { bytes, stat } = readStableWorkingTreeFile(target, relative);
        files.push({
          path: relative,
          mode: (stat.mode & 0o111n) === 0n ? '100644' : '100755',
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      } else {
        throw new Error(`execution checkout contains an unsupported entry: ${relative}`);
      }
    }
    const after = descriptorIdentity(descriptor);
    let namedDescriptor = null;
    try {
      namedDescriptor = fs.openSync(
        `/proc/self/fd/${parentDescriptor}/${name}`,
        DIRECTORY_FLAGS,
      );
      const named = descriptorIdentity(namedDescriptor);
      if (!sameDescriptorIdentity(before, after)
          || !sameDescriptorIdentity(after, named)) {
        throw new Error(
          `execution checkout directory changed during its descriptor-pinned snapshot: ${relativeDirectory}`,
        );
      }
    } finally {
      if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    }
  };
  const root = path.resolve(repositoryRoot);
  let ownedRootDescriptor = null;
  const checkoutRootDescriptor = rootDescriptor === null
    ? (ownedRootDescriptor = fs.openSync(root, DIRECTORY_FLAGS))
    : rootDescriptor;
  try {
    const rootStat = fs.fstatSync(checkoutRootDescriptor);
    if (!rootStat.isDirectory()) {
      throw new Error('execution checkout root descriptor is not a directory');
    }
    const rootMountId = linuxDescriptorMountId(checkoutRootDescriptor);
    for (const relative of [PRODUCT_PREFIX, 'plugins/cortex-learning-os-live']) {
      const opened = [];
      let current = checkoutRootDescriptor;
      try {
        const components = relative.split('/');
        for (const component of components) {
          const descriptor = fs.openSync(
            `/proc/self/fd/${current}/${component}`,
            DIRECTORY_FLAGS,
          );
          opened.push(descriptor);
          current = descriptor;
          if (linuxDescriptorMountId(descriptor) !== rootMountId) {
            throw new Error(
              `execution checkout crosses a mount boundary: ${relative}`,
            );
          }
        }
        walk(
          current,
          relative,
          rootMountId,
          opened.length === 1
            ? checkoutRootDescriptor
            : opened.at(-2),
          components.at(-1),
        );
      } finally {
        for (const descriptor of opened.reverse()) fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    if (['ELOOP', 'ENOTDIR'].includes(error.code)) {
      throw new Error(
        'execution checkout root contains a no-follow directory substitution',
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (ownedRootDescriptor !== null) fs.closeSync(ownedRootDescriptor);
  }
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    directories: directories.sort((left, right) => left.localeCompare(right)),
  };
}

export function currentCommittedIdentity({ requireClean = false } = {}) {
  const sourceCommit = git(
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    { encoding: 'utf8' },
  ).trim();
  const sourceTree = git(
    ['rev-parse', `${sourceCommit}^{tree}`],
    { encoding: 'utf8' },
  ).trim();
  const productTree = git(
    ['rev-parse', `${sourceCommit}:${PRODUCT_PREFIX}`],
    { encoding: 'utf8' },
  ).trim();
  if (!COMMIT.test(sourceCommit) || !COMMIT.test(sourceTree) || !COMMIT.test(productTree)) {
    throw new Error('current Git commit, repository tree, or product tree is invalid');
  }
  if (requireClean) {
    const status = git([
      'status', '--porcelain=v1', '--untracked-files=all', '--',
      PRODUCT_PREFIX, 'plugins/cortex-learning-os-live',
    ], { encoding: 'utf8' }).trim();
    if (status !== '') throw new Error('committed product or sibling runtime closure is dirty');
  }
  return { sourceCommit, sourceTree, productTree };
}

export function assertCommitTree(sourceCommit, sourceTree, productTree = null) {
  if (!COMMIT.test(String(sourceCommit || '')) || !COMMIT.test(String(sourceTree || ''))
      || (productTree !== null && !COMMIT.test(String(productTree || '')))) {
    throw new Error('declared source commit, repository tree, or product tree is invalid');
  }
  const actualTree = git(['rev-parse', `${sourceCommit}^{tree}`], { encoding: 'utf8' }).trim();
  if (actualTree !== sourceTree) throw new Error('declared source tree does not belong to source commit');
  if (productTree !== null) {
    const actualProductTree = git([
      'rev-parse', `${sourceCommit}:${PRODUCT_PREFIX}`,
    ], { encoding: 'utf8' }).trim();
    if (actualProductTree !== productTree) {
      throw new Error('declared product tree is not sourceCommit:cortex-learning-os');
    }
  }
  return true;
}

export function buildCommittedExecutionClosure({
  sourceCommit,
  sourceTree,
  productTree,
} = {}) {
  assertCommitTree(sourceCommit, sourceTree, productTree);
  const listing = git([
    'ls-tree', '-r', '-z', '-l', sourceCommit, '--',
    PRODUCT_PREFIX, 'plugins/cortex-learning-os-live',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = listing.split('\0').filter(Boolean).map((row) => {
    const match = /^([0-9]{6}) blob ([0-9a-f]{40}) +([0-9]+)\t(.+)$/.exec(row);
    if (!match || !['100644', '100755'].includes(match[1])) {
      throw new Error(`committed execution checkout contains an unsupported entry: ${row}`);
    }
    safeRelative(match[4]);
    const declaredLength = Number(match[3]);
    if (!Number.isSafeInteger(declaredLength)
        || declaredLength < 0
        || declaredLength > MAX_CLOSURE_FILE_BYTES) {
      throw new Error(
        `committed execution blob size is unsafe: ${match[4]}`,
      );
    }
    const bytes = git(['cat-file', 'blob', match[2]], {
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (bytes.length !== declaredLength) {
      throw new Error(`committed execution blob size mismatch: ${match[4]}`);
    }
    assertGitBlobObjectIdentity(
      bytes,
      match[2],
      `committed execution blob ${match[4]}`,
    );
    return {
      path: match[4],
      mode: match[1],
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  return buildExecutionClosure({
    sourceCommit,
    sourceTree,
    productTree,
    files,
    immutable: true,
  });
}

export function buildWorkingTreeExecutionClosure({
  sourceCommit,
  sourceTree,
  productTree = sourceTree,
  repositoryRoot = REPOSITORY_ROOT,
  immutable = false,
} = {}) {
  const snapshot = workingTreeSnapshot(repositoryRoot, {
    excludeMutableRuntime: !immutable,
  });
  return buildExecutionClosure({
    sourceCommit,
    sourceTree,
    productTree,
    files: snapshot.files,
    directories: snapshot.directories,
    immutable,
  });
}

export function validateExecutionClosure(closure) {
  const errors = [];
  const files = closure?.files;
  if (canonicalJson(Object.keys(closure || {}).sort()) !== canonicalJson([
    'checkoutSha256', 'closureSha256', 'entries', 'entryCount', 'fileCount',
    'files', 'immutable', 'productTree', 'runtimeFileCount', 'runtimeSha256',
    'schemaVersion', 'sourceCommit', 'sourceTree',
  ])
      || closure?.schemaVersion !== EXECUTION_CLOSURE_SCHEMA
      || !COMMIT.test(String(closure?.sourceCommit || ''))
      || !COMMIT.test(String(closure?.sourceTree || ''))
      || !COMMIT.test(String(closure?.productTree || ''))
      || !DIGEST.test(String(closure?.checkoutSha256 || ''))
      || !DIGEST.test(String(closure?.runtimeSha256 || ''))
      || !DIGEST.test(String(closure?.closureSha256 || ''))
      || !Number.isInteger(closure?.fileCount) || closure.fileCount < 1
      || typeof closure?.immutable !== 'boolean'
      || !Number.isInteger(closure?.entryCount) || closure.entryCount < closure.fileCount
      || !Array.isArray(closure?.entries)
      || closure.entries.length !== closure.entryCount
      || !Number.isInteger(closure?.runtimeFileCount) || closure.runtimeFileCount < 1
      || !Array.isArray(files) || files.length !== closure?.fileCount
      || files.length > 4096) {
    return { ok: false, errors: ['execution closure header or file set is invalid'] };
  }
  const seen = new Set();
  let previous = '';
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)
        || canonicalJson(Object.keys(file).sort())
          !== canonicalJson(['bytes', 'mode', 'path', 'sha256'])
        || typeof file.path !== 'string' || file.path.length < 1 || file.path.length > 512
        || !safeRelativePathValid(file.path)
        || (!file.path.startsWith(`${PRODUCT_PREFIX}/`)
          && !file.path.startsWith('plugins/cortex-learning-os-live/'))
        || !['100644', '100755'].includes(file.mode)
        || !Number.isInteger(file.bytes) || file.bytes < 0
        || file.bytes > MAX_CLOSURE_FILE_BYTES
        || !DIGEST.test(String(file.sha256 || ''))
        || seen.has(file.path) || (previous && previous.localeCompare(file.path) >= 0)) {
      errors.push(`execution closure file binding is invalid: ${String(file?.path || '')}`);
      continue;
    }
    seen.add(file.path);
    previous = file.path;
  }
  const entrySeen = new Set();
  let previousEntry = '';
  for (const entry of closure.entries) {
    const file = files.find((candidate) => candidate.path === entry?.path);
    if (!exactEntry(entry)
        || (![PRODUCT_PREFIX, 'plugins', 'plugins/cortex-learning-os-live'].includes(entry.path)
          && !entry.path.startsWith(`${PRODUCT_PREFIX}/`)
          && !entry.path.startsWith('plugins/cortex-learning-os-live/'))
        || entrySeen.has(entry.path)
        || (previousEntry && previousEntry.localeCompare(entry.path) >= 0)
        || (entry.type === 'file' && (
          !file
          || entry.mode !== (file.mode === '100755' ? '0555' : '0444')
        ))
        || (entry.type === 'directory' && entry.mode !== '0555')) {
      errors.push(`execution closure filesystem binding is invalid: ${String(entry?.path || '')}`);
      continue;
    }
    entrySeen.add(entry.path);
    previousEntry = entry.path;
    const parent = path.posix.dirname(entry.path);
    if (parent !== '.'
        && ![PRODUCT_PREFIX, 'plugins'].includes(entry.path)
        && !closure.entries.some((candidate) => (
          candidate.path === parent && candidate.type === 'directory'
        ))) {
      errors.push(`execution closure omits parent directory identity: ${entry.path}`);
    }
  }
  for (const file of files) {
    if (!entrySeen.has(file.path)) {
      errors.push(`execution closure omits filesystem identity: ${file.path}`);
    }
  }
  const runtimeFiles = files.filter((file) => isRuntimePath(file.path));
  const identity = {
    sourceCommit: closure.sourceCommit,
    sourceTree: closure.sourceTree,
    productTree: closure.productTree,
    checkoutSha256: closure.checkoutSha256,
    runtimeSha256: closure.runtimeSha256,
  };
  if (closure.fileCount !== files.length
      || closure.runtimeFileCount !== runtimeFiles.length
      || closure.entryCount !== closure.entries.length
      || closure.checkoutSha256 !== closureDigest({
        files,
        entries: closure.entries,
        immutable: closure.immutable,
      })
      || closure.runtimeSha256 !== closureDigest(runtimeFiles)
      || closure.closureSha256 !== closureDigest(identity)) {
    errors.push('execution closure count or digest binding is invalid');
  }
  return { ok: errors.length === 0, errors };
}

function exactEntry(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && canonicalJson(Object.keys(entry).sort())
      === canonicalJson(['gid', 'mode', 'path', 'type', 'uid'])
    && typeof entry.path === 'string' && entry.path.length > 0 && entry.path.length <= 512
    && safeRelativePathValid(entry.path)
    && ['directory', 'file'].includes(entry.type)
    && entry.uid === 0 && entry.gid === 0
    && ['0444', '0555'].includes(entry.mode);
}

function assertObservedExecutionClosure(closure, checkoutRoot, {
  excludeMutableRuntime = false,
  rootDescriptor = null,
} = {}) {
  const observed = workingTreeSnapshot(checkoutRoot, {
    excludeMutableRuntime,
    rootDescriptor,
  });
  if (canonicalJson(observed.files) !== canonicalJson(closure.files)) {
    throw new Error('execution checkout is dirty, substituted, partial, or has extra bytes');
  }
  const observedEntries = [
    ...observed.directories.map((entryPath) => ({
      path: entryPath,
      type: 'directory',
      uid: 0,
      gid: 0,
      mode: '0555',
    })),
    ...observed.files.map((file) => ({
      path: file.path,
      type: 'file',
      uid: 0,
      gid: 0,
      mode: file.mode === '100755' ? '0555' : '0444',
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(observedEntries) !== canonicalJson(closure.entries)) {
    throw new Error('execution checkout directory/file set is partial, injected, or has extra empty material');
  }
}

export function assertExecutionClosureEntrySetAtRoot(closure, checkoutRoot) {
  const validation = validateExecutionClosure(closure);
  if (!validation.ok) throw new Error(`invalid execution closure: ${validation.errors.join('; ')}`);
  const root = path.resolve(checkoutRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('execution checkout root is unsafe');
  }
  assertObservedExecutionClosure(closure, root, {
    excludeMutableRuntime: !closure.immutable,
  });
  return true;
}

function openRootOwnedDirectoryChain(absoluteTarget) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('immutable execution closure requires Linux descriptor-relative traversal');
  }
  const descriptors = [];
  const assertTrusted = (descriptor, label) => {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7022) !== 0 || (stat.mode & 0o100) === 0) {
      throw new Error(`execution checkout ancestor is not root-owned immutable material: ${label}`);
    }
    return stat;
  };
  try {
    let current = fs.openSync(path.parse(absoluteTarget).root, DIRECTORY_FLAGS);
    descriptors.push(current);
    assertTrusted(current, path.parse(absoluteTarget).root);
    let traversed = path.parse(absoluteTarget).root;
    for (const component of absoluteTarget.slice(path.parse(absoluteTarget).root.length)
      .split(path.sep).filter(Boolean)) {
      const next = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        DIRECTORY_FLAGS,
      );
      descriptors.push(next);
      traversed = path.join(traversed, component);
      assertTrusted(next, traversed);
      current = next;
    }
    return {
      descriptors,
      rootDescriptor: current,
      rootStat: fs.fstatSync(current),
      rootView: `/proc/self/fd/${current}`,
    };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) fs.closeSync(descriptor);
    throw error;
  }
}

function assertImmutableClosureDirectoryDescriptor(
  descriptor,
  expectedMountId,
  relative,
) {
  const stat = fs.fstatSync(descriptor, { bigint: true });
  if (!stat.isDirectory()
      || stat.uid !== 0n
      || stat.gid !== 0n
      || (stat.mode & 0o7777n) !== 0o555n
      || stat.nlink < 1n
      || linuxDescriptorMountId(descriptor) !== expectedMountId) {
    throw new Error(
      'execution checkout directory ownership, type, or mode mismatch; '
        + `exact root-owned immutable material required: ${relative}`,
    );
  }
  return stat;
}

function readImmutableClosureFileAt(
  parentDescriptor,
  name,
  file,
  entry,
  expectedMountId,
) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(
      `/proc/self/fd/${parentDescriptor}/${name}`,
      FILE_FLAGS,
    );
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    const before = descriptorIdentity(descriptor, beforeStat);
    if (!beforeStat.isFile()
        || beforeStat.uid !== BigInt(entry.uid)
        || beforeStat.gid !== BigInt(entry.gid)
        || (beforeStat.mode & 0o7777n)
          !== BigInt(Number.parseInt(entry.mode, 8))
        || beforeStat.nlink !== 1n
        || beforeStat.size !== BigInt(file.bytes)
        || before.mountId !== expectedMountId) {
      throw new Error(
        `execution checkout ownership, type, or mode mismatch; link, size, or mount is unsafe: ${entry.path}`,
      );
    }
    const bytes = readExactDescriptorBytes(descriptor, file.bytes);
    const afterRead = descriptorIdentity(descriptor);
    namedDescriptor = fs.openSync(
      `/proc/self/fd/${parentDescriptor}/${name}`,
      FILE_FLAGS,
    );
    const named = descriptorIdentity(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(descriptor, file.bytes);
    const committed = descriptorIdentity(descriptor);
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameDescriptorIdentity(before, afterRead)
        || !sameDescriptorIdentity(afterRead, named)
        || !sameDescriptorIdentity(named, committed)
        || sha256(bytes) !== file.sha256) {
      throw new Error(
        `execution checkout changed during descriptor-relative validation: ${entry.path}`,
      );
    }
    return bytes;
  } catch (error) {
    if (['ELOOP', 'ENXIO'].includes(error.code)) {
      throw new Error(
        `execution checkout entry is not a no-follow regular file: ${entry.path}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function assertExecutionClosureAtRoot(closure, checkoutRoot) {
  const validation = validateExecutionClosure(closure);
  if (!validation.ok) throw new Error(`invalid execution closure: ${validation.errors.join('; ')}`);
  const root = path.resolve(checkoutRoot);
  let trustedChain = null;
  if (closure.immutable) {
    trustedChain = openRootOwnedDirectoryChain(root);
  }
  try {
    const rootStat = trustedChain?.rootStat || fs.lstatSync(root);
    if (!rootStat.isDirectory() || (!trustedChain && rootStat.isSymbolicLink())) {
      throw new Error('execution checkout root is unsafe');
    }
    if (!closure.immutable) {
      assertObservedExecutionClosure(closure, root, {
        excludeMutableRuntime: true,
      });
      return true;
    }
    if (rootStat.uid !== 0 || rootStat.gid !== 0 || (rootStat.mode & 0o7777) !== 0o555) {
      throw new Error('execution checkout root is not root-owned immutable material');
    }
    const rootMountId = linuxDescriptorMountId(trustedChain.rootDescriptor);
    for (const entry of closure.entries) {
      const expectedMode = Number.parseInt(entry.mode, 8);
      const openedParents = [];
      let current = trustedChain.rootDescriptor;
      const components = entry.path.split('/');
      let traversed = '';
      try {
        for (const component of components.slice(0, -1)) {
          const descriptor = fs.openSync(
            `/proc/self/fd/${current}/${component}`,
            DIRECTORY_FLAGS,
          );
          openedParents.push(descriptor);
          current = descriptor;
          traversed = traversed === '' ? component : `${traversed}/${component}`;
          assertImmutableClosureDirectoryDescriptor(
            descriptor,
            rootMountId,
            traversed,
          );
        }
        if (entry.type === 'file') {
          const file = closure.files.find(
            (candidate) => candidate.path === entry.path,
          );
          readImmutableClosureFileAt(
            current,
            components.at(-1),
            file,
            entry,
            rootMountId,
          );
        } else {
          const descriptor = fs.openSync(
            `/proc/self/fd/${current}/${components.at(-1)}`,
            DIRECTORY_FLAGS,
          );
          try {
            const descriptorStat = assertImmutableClosureDirectoryDescriptor(
              descriptor,
              rootMountId,
              entry.path,
            );
            if ((descriptorStat.mode & 0o7777n) !== BigInt(expectedMode)) {
              throw new Error(
                `execution checkout ownership, type, or mode mismatch: ${entry.path}`,
              );
            }
          } finally {
            fs.closeSync(descriptor);
          }
        }
      } finally {
        for (const descriptor of openedParents.reverse()) fs.closeSync(descriptor);
      }
    }
    // Exact expected entries are validated first so ownership, link-count, and
    // full-mode violations retain their specific fail-closed disposition. The
    // descriptor-pinned snapshot then proves there is no injected or missing
    // negative space beyond that exact entry set.
    assertObservedExecutionClosure(closure, root, {
      rootDescriptor: trustedChain.rootDescriptor,
    });
    return true;
  } finally {
    for (const descriptor of trustedChain?.descriptors.reverse() || []) fs.closeSync(descriptor);
  }
}

export function readExecutionClosureFileAtRoot(closure, checkoutRoot, relativePath) {
  const validation = validateExecutionClosure(closure);
  const relative = safeRelative(relativePath);
  const file = closure?.files?.find((candidate) => candidate.path === relative);
  const entry = closure?.entries?.find((candidate) => candidate.path === relative);
  if (!validation.ok || closure.immutable !== true || !file
      || entry?.type !== 'file') {
    throw new Error(`immutable execution closure does not bind file: ${relative}`);
  }
  const root = path.resolve(checkoutRoot);
  const trustedChain = openRootOwnedDirectoryChain(root);
  const opened = [];
  try {
    if (trustedChain.rootStat.uid !== 0
        || trustedChain.rootStat.gid !== 0
        || (trustedChain.rootStat.mode & 0o7777) !== 0o555) {
      throw new Error(
        'immutable execution closure root is not exact root-owned mode-0555 material',
      );
    }
    const rootMountId = linuxDescriptorMountId(trustedChain.rootDescriptor);
    let current = trustedChain.rootDescriptor;
    const components = relative.split('/');
    let traversed = '';
    for (const component of components.slice(0, -1)) {
      const descriptor = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        DIRECTORY_FLAGS,
      );
      opened.push(descriptor);
      current = descriptor;
      traversed = traversed === '' ? component : `${traversed}/${component}`;
      const expectedParent = closure.entries.find((candidate) => (
        candidate.path === traversed
      ));
      if (expectedParent?.type !== 'directory') {
        throw new Error(
          `immutable execution closure omits traversed directory: ${traversed}`,
        );
      }
      assertImmutableClosureDirectoryDescriptor(
        descriptor,
        rootMountId,
        traversed,
      );
    }
    return readImmutableClosureFileAt(
      current,
      components.at(-1),
      file,
      entry,
      rootMountId,
    );
  } finally {
    for (const descriptor of opened.reverse()) fs.closeSync(descriptor);
    for (const descriptor of trustedChain.descriptors.reverse()) fs.closeSync(descriptor);
  }
}

export function readCommittedProductFile(sourceCommit, relativePath) {
  if (!COMMIT.test(String(sourceCommit || ''))) throw new Error('source commit is invalid');
  const relative = safeRelative(relativePath);
  const objectPath = `${PRODUCT_PREFIX}/${relative}`;
  let listing;
  try {
    listing = git([
      'ls-tree', '-z', '-l', sourceCommit, '--', objectPath,
    ], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `committed product input cannot be resolved at ${relative}: ${error.message}`,
    );
  }
  const rows = listing.split('\0').filter(Boolean);
  const match = rows.length === 1
    ? /^([0-9]{6}) blob ([0-9a-f]{40}) +([0-9]+)\t(.+)$/.exec(rows[0])
    : null;
  const declaredLength = match === null ? Number.NaN : Number(match[3]);
  if (match === null
      || !['100644', '100755'].includes(match[1])
      || match[4] !== objectPath
      || !Number.isSafeInteger(declaredLength)
      || declaredLength < 0
      || declaredLength > MAX_CLOSURE_FILE_BYTES) {
    throw new Error(
      `committed product input is missing or unsafe at ${relative}`,
    );
  }
  const bytes = git(['cat-file', 'blob', match[2]], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (bytes.length !== declaredLength) {
    throw new Error(`committed product input size changed at ${relative}`);
  }
  assertGitBlobObjectIdentity(
    bytes,
    match[2],
    `committed product input ${relative}`,
  );
  return bytes;
}

export function readCommittedProductJson(sourceCommit, relativePath) {
  const bytes = readCommittedProductFile(sourceCommit, relativePath);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`committed product JSON is invalid at ${relativePath}: ${error.message}`);
  }
}

function committedProductPathSnapshot(filePath, sourceCommit) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(CLOS_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error('input path is outside the committed product subtree');
  }
  const canonicalRelative = safeRelative(
    relative.split(path.sep).join('/'),
  );
  const committed = readCommittedProductFile(sourceCommit, canonicalRelative);
  const actual = readStableProductFile(canonicalRelative);
  if (!actual.equals(committed)) throw new Error(`product input differs from committed blob: ${relative}`);
  return {
    bytes: actual,
    relative: canonicalRelative,
  };
}

export function assertCommittedProductPath(filePath, sourceCommit) {
  return committedProductPathSnapshot(filePath, sourceCommit).relative;
}

export function readCommittedProductPath(filePath, sourceCommit) {
  return committedProductPathSnapshot(filePath, sourceCommit);
}

export function readCommittedProductJsonPath(filePath, sourceCommit) {
  const snapshot = readCommittedProductPath(filePath, sourceCommit);
  try {
    return {
      ...snapshot,
      record: JSON.parse(snapshot.bytes.toString('utf8')),
    };
  } catch (error) {
    throw new Error(
      `committed product JSON is invalid at ${snapshot.relative}: ${error.message}`,
    );
  }
}
