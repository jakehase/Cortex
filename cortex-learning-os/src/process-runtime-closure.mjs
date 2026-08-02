import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { assertInitialRootAuthority } from './linux-root-authority.mjs';
import { durablyAdoptPublishedTree } from './durable-tree-adoption.mjs';

export const PROCESS_RUNTIME_CLOSURE_SCHEMA =
  'cortex.learning_os.process_runtime_closure.v2';
export const PROCESS_RUNTIME_STORE_ROOT =
  '/var/lib/cortex-learning-os/retention-runtimes';

const DIGEST = /^[0-9a-f]{64}$/;
const DYNAMIC_DEPENDENCY_INSPECTOR = '/usr/bin/ldd';
const FIXED_HELPER_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
  TZ: 'UTC',
});

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function mode(stat) {
  return (stat.mode & 0o7777).toString(8).padStart(4, '0');
}

function sameRuntimeObjectMetadata(left, right) {
  return [
    'dev',
    'ino',
    'uid',
    'gid',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
    'birthtimeMs',
  ].every((field) => left[field] === right[field]);
}

function safeModeErrors(entry) {
  if (!/^[0-7]{4}$/.test(String(entry?.mode || ''))) {
    return ['mode is not four-digit octal'];
  }
  const value = Number.parseInt(entry.mode, 8);
  const errors = [];
  if ((value & 0o7000) !== 0) errors.push('privilege or sticky mode bits are forbidden');
  if ((value & 0o222) !== 0) errors.push('writable runtime image mode is forbidden');
  if (entry.type === 'directory' && (value & 0o505) !== 0o505) {
    errors.push('runtime directory is not owner/service readable and traversable');
  }
  if (['interpreter', 'helper_executable', 'runtime_loader'].includes(entry.role)
      && (value & 0o505) !== 0o505) {
    errors.push('runtime executable is not owner/service readable and executable');
  }
  if (entry.type === 'file' && (value & 0o404) !== 0o404) {
    errors.push('runtime file is not owner/service readable');
  }
  return errors;
}

function helperRuntimeFilePaths(helperFiles) {
  if (helperFiles.length === 0) return [];
  const inspector = fs.realpathSync.native(DYNAMIC_DEPENDENCY_INSPECTOR);
  const inspectorStat = fs.lstatSync(inspector);
  if (!inspectorStat.isFile() || inspectorStat.isSymbolicLink()
      || inspectorStat.uid !== 0 || inspectorStat.gid !== 0
      || (inspectorStat.mode & 0o7022) !== 0
      || (inspectorStat.mode & 0o100) === 0) {
    throw new Error('process runtime dependency inspector is not root-owned immutable material');
  }
  const dependencies = new Set();
  for (const helper of helperFiles) {
    const result = spawnSync(inspector, [helper], {
      encoding: 'utf8',
      env: FIXED_HELPER_ENVIRONMENT,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
    });
    if (result.error || result.status !== 0 || result.signal !== null
        || /\bnot found\b/.test(String(result.stdout || ''))) {
      throw new Error(`process runtime helper dependency closure is incomplete: ${helper}`);
    }
    for (const line of String(result.stdout || '').split('\n')) {
      const match = /(?:=>[ \t]+)?(\/[^ \t(]+)/.exec(line);
      if (match) dependencies.add(path.resolve(match[1]));
    }
  }
  return [...dependencies].sort();
}

function runtimeFilePaths(executablePath = process.execPath) {
  const sharedObjects = process.report?.getReport?.().sharedObjects;
  if (!Array.isArray(sharedObjects)) {
    throw new Error('process runtime cannot enumerate its loaded shared-object closure');
  }
  return [...new Set([
    path.resolve(executablePath),
    ...sharedObjects
      .filter((target) => typeof target === 'string' && path.isAbsolute(target))
      .map((target) => path.resolve(target)),
  ])].sort();
}

function closurePaths(files) {
  const paths = new Set(['/']);
  for (const file of files) {
    paths.add(file);
    let parent = path.dirname(file);
    while (true) {
      paths.add(parent);
      if (parent === '/') break;
      parent = path.dirname(parent);
    }
  }
  return [...paths].sort((left, right) => (
    left.split(path.sep).length - right.split(path.sep).length
      || left.localeCompare(right)
  ));
}

function runtimeClosureDigest(closure) {
  return sha256Text(canonicalJson({
    schemaVersion: closure.schemaVersion,
    platform: closure.platform,
    architecture: closure.architecture,
    executablePath: closure.executablePath,
    loaderPath: closure.loaderPath,
    libraryPaths: closure.libraryPaths,
    entryCount: closure.entryCount,
    entries: closure.entries,
  }));
}

export function validateProcessRuntimeClosure(closure) {
  const errors = [];
  if (!exactKeys(closure, [
    'architecture', 'closureSha256', 'entries', 'entryCount', 'executablePath',
    'libraryPaths', 'loaderPath', 'platform', 'rootDirectory', 'schemaVersion',
  ])
      || closure?.schemaVersion !== PROCESS_RUNTIME_CLOSURE_SCHEMA
      || closure?.platform !== process.platform
      || closure?.architecture !== process.arch
      || typeof closure?.executablePath !== 'string'
      || !path.isAbsolute(closure.executablePath)
      || path.resolve(closure.executablePath) !== closure.executablePath
      || typeof closure?.loaderPath !== 'string'
      || !path.isAbsolute(closure.loaderPath)
      || path.resolve(closure.loaderPath) !== closure.loaderPath
      || !Array.isArray(closure?.libraryPaths)
      || closure.libraryPaths.length < 1
      || closure.libraryPaths.length > 128
      || closure.libraryPaths.some((target) => (
        typeof target !== 'string' || !path.isAbsolute(target)
          || path.resolve(target) !== target
      ))
      || new Set(closure.libraryPaths).size !== closure.libraryPaths.length
      || canonicalJson(closure.libraryPaths)
        !== canonicalJson([...closure.libraryPaths].sort())
      || typeof closure?.rootDirectory !== 'string'
      || !path.isAbsolute(closure.rootDirectory)
      || path.resolve(closure.rootDirectory) !== closure.rootDirectory
      || !Array.isArray(closure?.entries)
      || closure.entryCount !== closure.entries?.length
      || closure.entryCount < 2
      || closure.entryCount > 1024
      || !DIGEST.test(String(closure?.closureSha256 || ''))) {
    return { ok: false, errors: ['process runtime closure fields are invalid'] };
  }
  const observedPaths = new Set();
  for (const entry of closure.entries) {
    const directory = entry?.type === 'directory';
    const executable = ['helper_executable', 'interpreter', 'runtime_loader']
      .includes(entry?.role);
    const mountFile = !directory && entry?.role === 'mount_target';
    const expectedKeys = directory
      ? ['gid', 'mode', 'path', 'role', 'type', 'uid']
      : ['bytes', 'gid', 'mode', 'path', 'role', 'sha256', 'type', 'uid'];
    if (!exactKeys(entry, expectedKeys)
        || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)
        || path.resolve(entry.path) !== entry.path
        || observedPaths.has(entry.path)
        || !['directory', 'file'].includes(entry.type)
        || !Number.isSafeInteger(entry.uid) || entry.uid !== 0
        || !Number.isSafeInteger(entry.gid) || entry.gid !== 0
        || safeModeErrors(entry).length > 0
        || (directory && !['mount_target', 'runtime_ancestor'].includes(entry.role))
        || (directory && entry.mode !== '0555')
        || (!directory
          && ![
            'helper_executable',
            'helper_runtime_object',
            'interpreter',
            'mount_target',
            'runtime_loader',
            'shared_object',
          ].includes(entry.role))
        || (!directory && entry.mode !== (executable ? '0555' : '0444'))
        || (!directory && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0
          || !DIGEST.test(String(entry.sha256 || ''))))
        || (mountFile && (
          entry.bytes !== 0 || entry.sha256 !== sha256Bytes(Buffer.alloc(0))
        ))
        || (!directory && !mountFile && entry.bytes < 1)) {
      errors.push(`process runtime closure entry is invalid: ${entry?.path || '<unknown>'}`);
    }
    observedPaths.add(entry?.path);
  }
  const executable = closure.entries.find((entry) => entry.role === 'interpreter');
  const loader = closure.entries.find((entry) => entry.role === 'runtime_loader');
  const rootEntry = closure.entries.find((entry) => entry.path === '/');
  if (executable?.path !== closure.executablePath
      || closure.entries.filter((entry) => entry.role === 'interpreter').length !== 1
      || loader?.path !== closure.loaderPath
      || closure.entries.filter((entry) => entry.role === 'runtime_loader').length !== 1
      || !closure.libraryPaths.includes(path.dirname(closure.loaderPath))
      || rootEntry?.type !== 'directory'
      || closure.entries.some((entry) => (
        entry.path !== '/'
          && !closure.entries.some((candidate) => (
            candidate.path === path.dirname(entry.path)
              && candidate.type === 'directory'
          ))
      ))
      || closure.libraryPaths.some((libraryPath) => (
        !closure.entries.some((entry) => (
          entry.path === libraryPath && entry.type === 'directory'
        ))
      ))
      || path.basename(path.dirname(closure.rootDirectory)) !== closure.closureSha256
      || path.basename(closure.rootDirectory) !== 'rootfs'
      || closure.closureSha256 !== runtimeClosureDigest(closure)) {
    errors.push('process runtime executable, entry set, or closure digest is detached');
  }
  return { ok: errors.length === 0, errors };
}

export function buildProcessRuntimeClosure({
  executablePath = process.execPath,
  additionalExecutablePaths = [],
  additionalDataPaths = [],
  mountDirectoryPaths = [],
  mountFilePaths = [],
  storeRoot = PROCESS_RUNTIME_STORE_ROOT,
  crashInjector = null,
} = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('delayed production resume requires Linux descriptor validation');
  }
  assertInitialRootAuthority();
  const executable = path.resolve(executablePath);
  if (!Array.isArray(additionalExecutablePaths)
      || additionalExecutablePaths.some((target) => (
        typeof target !== 'string' || !path.isAbsolute(target)
      ))
      || !Array.isArray(additionalDataPaths)
      || additionalDataPaths.length !== 0
      || !Array.isArray(mountDirectoryPaths)
      || mountDirectoryPaths.some((target) => (
        typeof target !== 'string' || !path.isAbsolute(target)
      ))
      || !Array.isArray(mountFilePaths)
      || mountFilePaths.some((target) => (
        typeof target !== 'string' || !path.isAbsolute(target)
      ))
      || typeof storeRoot !== 'string' || !path.isAbsolute(storeRoot)) {
    throw new Error('process runtime helper, mount, or store paths are invalid');
  }
  const loadedFiles = runtimeFilePaths(executable);
  const helperFiles = new Set(
    additionalExecutablePaths.map((target) => path.resolve(target)),
  );
  if (helperFiles.has(executable)
      || loadedFiles.some((target) => helperFiles.has(target))) {
    throw new Error('process runtime helper executable overlaps the loaded runtime');
  }
  const helperRuntimeFiles = new Set(helperRuntimeFilePaths([...helperFiles]));
  const loaderCandidates = loadedFiles.filter((target) => (
    /(?:^|\/)ld-(?:linux|musl)[^/]*[.]so(?:[.][0-9]+)*$/.test(target)
      || /(?:^|\/)ld-linux[^/]*[.]so(?:[.][0-9]+)*$/.test(target)
  ));
  if (loaderCandidates.length !== 1) {
    throw new Error('process runtime cannot identify one exact dynamic loader');
  }
  const loaderPath = loaderCandidates[0];
  const sourceBindings = new Map();
  const bindSource = (logicalPath, role) => {
    const logical = path.resolve(logicalPath);
    const sourcePath = fs.realpathSync.native(logical);
    const existing = sourceBindings.get(logical);
    if (existing && existing.sourcePath !== sourcePath) {
      throw new Error(`process runtime logical path is ambiguous: ${logical}`);
    }
    sourceBindings.set(logical, {
      logical,
      role,
      sourcePath,
    });
  };
  for (const target of loadedFiles) {
    bindSource(
      target,
      target === executable
        ? 'interpreter'
        : target === loaderPath
          ? 'runtime_loader'
          : 'shared_object',
    );
  }
  for (const target of helperFiles) bindSource(target, 'helper_executable');
  for (const target of helperRuntimeFiles) {
    if (!sourceBindings.has(path.resolve(target))) {
      bindSource(target, 'helper_runtime_object');
    }
  }
  for (const binding of sourceBindings.values()) {
    const stat = fs.lstatSync(binding.sourcePath);
    if (stat.isSymbolicLink()
        || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7022) !== 0
        || !stat.isFile()
        || (stat.mode & 0o004) === 0
        || (['interpreter', 'helper_executable', 'runtime_loader'].includes(binding.role)
          && (stat.mode & 0o005) !== 0o005)
        || stat.size < 1) {
      throw new Error(
        `process runtime object is not root-owned immutable material: ${binding.logical}`,
      );
    }
    const descriptor = fs.openSync(
      binding.sourcePath,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
    );
    try {
      const descriptorStat = fs.fstatSync(descriptor);
      const bytes = fs.readFileSync(descriptor);
      if (!descriptorStat.isFile()
          || descriptorStat.dev !== stat.dev || descriptorStat.ino !== stat.ino
          || descriptorStat.uid !== stat.uid || descriptorStat.gid !== stat.gid
          || mode(descriptorStat) !== mode(stat)
          || descriptorStat.size !== bytes.length) {
        throw new Error(
          `process runtime object changed during descriptor binding: ${binding.logical}`,
        );
      }
      if (binding.role === 'interpreter') {
        const currentDescriptor = fs.openSync(
          '/proc/self/exe',
          fs.constants.O_RDONLY | (fs.constants.O_CLOEXEC || 0),
        );
        try {
          const currentStat = fs.fstatSync(currentDescriptor);
          const currentBytes = fs.readFileSync(currentDescriptor);
          if (currentStat.dev !== descriptorStat.dev
              || currentStat.ino !== descriptorStat.ino
              || currentBytes.length !== bytes.length
              || sha256Bytes(currentBytes) !== sha256Bytes(bytes)) {
            throw new Error('signed delayed interpreter is not the currently executing Node object');
          }
        } finally {
          fs.closeSync(currentDescriptor);
        }
      }
      binding.bytes = bytes;
      binding.entry = {
        path: binding.logical,
        role: binding.role,
        type: 'file',
        uid: 0,
        gid: 0,
        mode: ['interpreter', 'helper_executable', 'runtime_loader']
          .includes(binding.role) ? '0555' : '0444',
        bytes: bytes.length,
        sha256: sha256Bytes(bytes),
      };
    } finally {
      fs.closeSync(descriptor);
    }
  }
  const filePaths = [...sourceBindings.keys()];
  const mountDirectories = [...new Set(
    mountDirectoryPaths.map((target) => path.resolve(target)),
  )];
  const mountFiles = [...new Set(
    mountFilePaths.map((target) => path.resolve(target)),
  )];
  if (mountFiles.some((target) => sourceBindings.has(target))
      || mountDirectories.some((target) => sourceBindings.has(target))
      || mountFiles.some((target) => mountDirectories.includes(target))) {
    throw new Error('process runtime mount targets overlap captured runtime files');
  }
  const allPaths = [...filePaths, ...mountDirectories, ...mountFiles];
  const entries = closurePaths(allPaths).map((target) => {
    const binding = sourceBindings.get(target);
    if (binding) return binding.entry;
    if (mountFiles.includes(target)) {
      return {
        path: target,
        role: 'mount_target',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0444',
        bytes: 0,
        sha256: sha256Bytes(Buffer.alloc(0)),
      };
    }
    return {
      path: target,
      role: mountDirectories.includes(target) ? 'mount_target' : 'runtime_ancestor',
      type: 'directory',
      uid: 0,
      gid: 0,
      mode: '0555',
    };
  });
  const libraryPaths = [...new Set(
    [...loadedFiles, ...helperRuntimeFiles]
      .filter((target) => target !== executable)
      .map((target) => path.dirname(target)),
  )].sort();
  const closure = {
    schemaVersion: PROCESS_RUNTIME_CLOSURE_SCHEMA,
    platform: process.platform,
    architecture: process.arch,
    executablePath: executable,
    loaderPath,
    libraryPaths,
    rootDirectory: path.join(storeRoot, 'pending', 'rootfs'),
    entryCount: entries.length,
    entries,
  };
  closure.closureSha256 = runtimeClosureDigest(closure);
  closure.rootDirectory = path.join(storeRoot, closure.closureSha256, 'rootfs');
  const validation = validateProcessRuntimeClosure(closure);
  if (!validation.ok) {
    throw new Error(`invalid process runtime closure: ${validation.errors.join('; ')}`);
  }
  return publishProcessRuntimeClosure(closure, sourceBindings, {
    storeRoot,
    crashInjector,
  });
}

function fsyncDirectory(target) {
  const descriptor = fs.openSync(
    target,
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

function ensureRootOwnedDirectory(target, expectedMode) {
  const resolved = path.resolve(target);
  let traversed = '/';
  for (const component of resolved.slice(1).split('/').filter(Boolean)) {
    const next = path.join(traversed, component);
    if (!fs.existsSync(next)) {
      try {
        fs.mkdirSync(next, { mode: expectedMode });
        fs.chownSync(next, 0, 0);
        fs.chmodSync(next, expectedMode);
        fsyncDirectory(traversed);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const stat = fs.lstatSync(next);
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7022) !== 0) {
      throw new Error(`process runtime store ancestor is unsafe: ${next}`);
    }
    traversed = next;
  }
  const stat = fs.lstatSync(resolved);
  if ((stat.mode & 0o7777) !== expectedMode) {
    fs.chmodSync(resolved, expectedMode);
  }
  return resolved;
}

function runtimeImagePath(physicalRoot, logicalPath) {
  return logicalPath === '/'
    ? physicalRoot
    : path.join(physicalRoot, logicalPath.slice(1));
}

function exactRuntimeManifestBytes(closure) {
  return Buffer.from(`${JSON.stringify(closure, null, 2)}\n`, 'utf8');
}

function assertPublishedRuntimeImage(closure, imageDirectory) {
  const resolvedImage = path.resolve(imageDirectory);
  const imageStat = fs.lstatSync(resolvedImage);
  if (!imageStat.isDirectory() || imageStat.isSymbolicLink()
      || imageStat.uid !== 0 || imageStat.gid !== 0
      || (imageStat.mode & 0o7777) !== 0o555
      || canonicalJson(fs.readdirSync(resolvedImage).sort())
        !== canonicalJson(['closure.json', 'rootfs'])) {
    throw new Error('published process runtime image root is unsafe or has extra entries');
  }
  const manifestPath = path.join(resolvedImage, 'closure.json');
  const descriptor = fs.openSync(
    manifestPath,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const stat = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1
        || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7777) !== 0o444
        || !bytes.equals(exactRuntimeManifestBytes(closure))) {
      throw new Error('published process runtime manifest bytes or metadata changed');
    }
  } finally {
    fs.closeSync(descriptor);
  }
  assertProcessRuntimeClosure(closure, {
    executablePath: closure.executablePath,
    requireCurrentLoadedSet: false,
    rootDirectory: path.join(resolvedImage, 'rootfs'),
  });
  return true;
}

function adoptDurableRuntimeImage(
  closure,
  finalImage,
  stagingRoot,
  crashInjector = null,
  { afterRename = false } = {},
) {
  if (afterRename && typeof crashInjector === 'function') {
    crashInjector('after_runtime_rename_before_parent_fsync');
  }
  return durablyAdoptPublishedTree({
    targetPath: finalImage,
    sourceParentPath: stagingRoot,
    validate: () => assertPublishedRuntimeImage(closure, finalImage),
    label: 'process runtime publication',
  });
}

function quarantineRuntimeStage(stagePath, quarantineRoot, label) {
  const target = path.join(
    quarantineRoot,
    `${label}-${crypto.randomBytes(12).toString('hex')}`,
  );
  fs.renameSync(stagePath, target);
  fsyncDirectory(path.dirname(stagePath));
  fsyncDirectory(quarantineRoot);
}

function entryExistsNoFollow(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function linuxProcessStartTime(pid) {
  try {
    const record = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').trim();
    const commandEnd = record.lastIndexOf(')');
    if (commandEnd < 2) return null;
    const fieldsFromState = record.slice(commandEnd + 2).split(' ');
    const startTime = fieldsFromState[19];
    return /^[0-9]+$/.test(String(startTime || '')) ? startTime : null;
  } catch {
    return null;
  }
}

function publishProcessRuntimeClosure(closure, sourceBindings, {
  storeRoot,
  crashInjector,
}) {
  const resolvedStore = ensureRootOwnedDirectory(storeRoot, 0o755);
  const stagingRoot = ensureRootOwnedDirectory(
    path.join(resolvedStore, '.staging'),
    0o700,
  );
  const quarantineRoot = ensureRootOwnedDirectory(
    path.join(resolvedStore, '.quarantine'),
    0o700,
  );
  const finalImage = path.dirname(closure.rootDirectory);
  if (path.dirname(finalImage) !== resolvedStore
      || path.basename(finalImage) !== closure.closureSha256) {
    throw new Error('process runtime content-addressed destination is detached');
  }
  const stagePrefix = `${closure.closureSha256}.`;
  const stagePattern =
    /^([0-9a-f]{64})[.]([0-9]+)[.]([0-9]+)[.]([0-9a-f]{32})$/;
  for (const name of fs.readdirSync(stagingRoot).sort()) {
    const candidate = path.join(stagingRoot, name);
    const stageIdentity = stagePattern.exec(name);
    let candidateStat;
    try {
      candidateStat = fs.lstatSync(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const publisherPid = stageIdentity === null
      ? null
      : Number(stageIdentity[2]);
    const liveStart = publisherPid === null
      ? null
      : linuxProcessStartTime(publisherPid);
    const livePublisher = liveStart !== null && liveStart === stageIdentity[3];
    const liveForeignPublisher = livePublisher && publisherPid !== process.pid;
    if (stageIdentity === null
        || stageIdentity[1] !== closure.closureSha256) {
      if (liveForeignPublisher) continue;
      quarantineRuntimeStage(
        candidate,
        quarantineRoot,
        `${closure.closureSha256}.${
          stageIdentity === null ? 'malformed-stage' : 'stale-stage'
        }`,
      );
      continue;
    }
    if (liveForeignPublisher) continue;
    if (!candidateStat.isDirectory()
        || (candidateStat.mode & 0o7777) !== 0o555) {
      quarantineRuntimeStage(
        candidate,
        quarantineRoot,
        `${closure.closureSha256}.abandoned-stage`,
      );
      continue;
    }
    try {
      assertPublishedRuntimeImage(closure, candidate);
    } catch {
      if (entryExistsNoFollow(candidate)) {
        quarantineRuntimeStage(
          candidate,
          quarantineRoot,
          `${closure.closureSha256}.invalid-stage`,
        );
      }
      continue;
    }
    if (entryExistsNoFollow(finalImage)) {
      adoptDurableRuntimeImage(closure, finalImage, stagingRoot, crashInjector);
      quarantineRuntimeStage(
        candidate,
        quarantineRoot,
        `${closure.closureSha256}.duplicate-stage`,
      );
      continue;
    }
    try {
      fs.renameSync(candidate, finalImage);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      adoptDurableRuntimeImage(closure, finalImage, stagingRoot, crashInjector);
      if (entryExistsNoFollow(candidate)) {
        quarantineRuntimeStage(
          candidate,
          quarantineRoot,
          `${closure.closureSha256}.duplicate-stage`,
        );
      }
      return closure;
    }
    adoptDurableRuntimeImage(
      closure,
      finalImage,
      stagingRoot,
      crashInjector,
      { afterRename: true },
    );
    return closure;
  }
  if (entryExistsNoFollow(finalImage)) {
    adoptDurableRuntimeImage(closure, finalImage, stagingRoot, crashInjector);
    return closure;
  }
  const processStartTime = linuxProcessStartTime(process.pid);
  if (processStartTime === null) {
    throw new Error('process runtime publisher cannot bind its Linux process identity');
  }
  const stage = path.join(
    stagingRoot,
    `${stagePrefix}${process.pid}.${processStartTime}.${
      crypto.randomBytes(16).toString('hex')
    }`,
  );
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.chownSync(stage, 0, 0);
  const stageRuntimeRoot = path.join(stage, 'rootfs');
  fs.mkdirSync(stageRuntimeRoot, { mode: 0o700 });
  fs.chownSync(stageRuntimeRoot, 0, 0);
  for (const entry of closure.entries) {
    if (entry.path === '/') continue;
    const target = runtimeImagePath(stageRuntimeRoot, entry.path);
    if (entry.type === 'directory') {
      fs.mkdirSync(target, { mode: 0o700 });
      fs.chownSync(target, 0, 0);
      continue;
    }
    const binding = sourceBindings.get(entry.path);
    const bytes = binding?.bytes || Buffer.alloc(0);
    if (bytes.length !== entry.bytes || sha256Bytes(bytes) !== entry.sha256) {
      throw new Error(`process runtime staged source bytes detached: ${entry.path}`);
    }
    const descriptor = fs.openSync(
      target,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
      0o600,
    );
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fchownSync(descriptor, 0, 0);
      fs.fchmodSync(descriptor, Number.parseInt(entry.mode, 8));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  if (typeof crashInjector === 'function') crashInjector('after_runtime_stage_populated');
  const directories = closure.entries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => runtimeImagePath(stageRuntimeRoot, entry.path))
    .sort((left, right) => right.split('/').length - left.split('/').length);
  for (const directory of directories) {
    fsyncDirectory(directory);
    fs.chownSync(directory, 0, 0);
    fs.chmodSync(directory, 0o555);
  }
  const manifestPath = path.join(stage, 'closure.json');
  const manifestDescriptor = fs.openSync(
    manifestPath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
    0o600,
  );
  try {
    fs.writeFileSync(manifestDescriptor, exactRuntimeManifestBytes(closure));
    fs.fchownSync(manifestDescriptor, 0, 0);
    fs.fchmodSync(manifestDescriptor, 0o444);
    fs.fsyncSync(manifestDescriptor);
  } finally {
    fs.closeSync(manifestDescriptor);
  }
  fsyncDirectory(stage);
  fs.chmodSync(stage, 0o555);
  fsyncDirectory(stagingRoot);
  if (typeof crashInjector === 'function') crashInjector('after_runtime_stage_sealed');
  try {
    fs.renameSync(stage, finalImage);
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    adoptDurableRuntimeImage(closure, finalImage, stagingRoot, crashInjector);
    quarantineRuntimeStage(
      stage,
      quarantineRoot,
      `${closure.closureSha256}.duplicate-stage`,
    );
    return closure;
  }
  adoptDurableRuntimeImage(
    closure,
    finalImage,
    stagingRoot,
    crashInjector,
    { afterRename: true },
  );
  if (typeof crashInjector === 'function') crashInjector('after_runtime_publication');
  return closure;
}

export function assertProcessRuntimeClosure(closure, {
  executablePath = closure?.executablePath,
  requireCurrentLoadedSet = true,
  rootDirectory = requireCurrentLoadedSet ? '/' : closure?.rootDirectory,
  allowMountedTargets = requireCurrentLoadedSet,
} = {}) {
  const validation = validateProcessRuntimeClosure(closure);
  if (!validation.ok) {
    throw new Error(`invalid process runtime closure: ${validation.errors.join('; ')}`);
  }
  const resolvedExecutable = path.resolve(executablePath);
  if (resolvedExecutable !== closure.executablePath) {
    throw new Error('process runtime executable path differs from the signed closure');
  }
  const entries = new Map(closure.entries.map((entry) => [entry.path, entry]));
  const interpreterEntry = entries.get(closure.executablePath);
  if (requireCurrentLoadedSet) {
    const currentExecutable = fs.readFileSync('/proc/self/exe');
    if (interpreterEntry?.role !== 'interpreter'
        || currentExecutable.length !== interpreterEntry.bytes
        || sha256Bytes(currentExecutable) !== interpreterEntry.sha256) {
      throw new Error('currently executing Node interpreter differs from the signed closure');
    }
  }
  const expectedLoadedFiles = closure.entries
    .filter((entry) => (
      ['interpreter', 'runtime_loader', 'shared_object'].includes(entry.role)
    ))
    .map((entry) => entry.path)
    .sort();
  if (requireCurrentLoadedSet
      && canonicalJson(runtimeFilePaths(resolvedExecutable))
        !== canonicalJson(expectedLoadedFiles)) {
    throw new Error('currently loaded interpreter/shared-object set differs from signed closure');
  }
  const expectedFiles = closure.entries
    .filter((entry) => (
      entry.type === 'file' && (!allowMountedTargets || entry.role !== 'mount_target')
    ))
    .map((entry) => entry.path)
    .sort();
  const descriptors = [];
  try {
    const directoryFlags = fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY || 0)
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0);
    const physicalRoot = path.resolve(rootDirectory);
    let descriptor = fs.openSync('/', directoryFlags);
    descriptors.push(descriptor);
    let physicalTraversed = '/';
    for (const component of physicalRoot.slice(1).split('/').filter(Boolean)) {
      const ancestorStat = fs.fstatSync(descriptor);
      if (!ancestorStat.isDirectory()
          || ancestorStat.uid !== 0 || ancestorStat.gid !== 0
          || (ancestorStat.mode & 0o7022) !== 0) {
        throw new Error(
          `process runtime image ancestor is unsafe: ${physicalTraversed}`,
        );
      }
      const next = fs.openSync(`/proc/self/fd/${descriptor}/${component}`, directoryFlags);
      descriptors.push(next);
      descriptor = next;
      physicalTraversed = path.join(physicalTraversed, component);
    }
    const rootEntry = entries.get('/');
    const rootStat = fs.fstatSync(descriptor);
    if (!rootEntry || !rootStat.isDirectory()
        || rootStat.uid !== rootEntry.uid || rootStat.gid !== rootEntry.gid
        || mode(rootStat) !== rootEntry.mode) {
      throw new Error('process runtime root directory differs from signed closure');
    }
    const observedPaths = [];
    const walk = (directoryDescriptor, logicalDirectory) => {
      const names = fs.readdirSync(
        `/proc/self/fd/${directoryDescriptor}`,
      ).sort();
      for (const name of names) {
        const logical = logicalDirectory === '/'
          ? `/${name}`
          : `${logicalDirectory}/${name}`;
        const declared = entries.get(logical);
        if (!declared) {
          throw new Error(`process runtime image contains an unsigned path: ${logical}`);
        }
        if (allowMountedTargets && declared.role === 'mount_target') {
          const mounted = fs.lstatSync(
            `/proc/self/fd/${directoryDescriptor}/${name}`,
          );
          if (mounted.isSymbolicLink()
              || (declared.type === 'directory' && !mounted.isDirectory())
              || (declared.type === 'file' && !mounted.isFile())) {
            throw new Error(
              `process runtime mount target type changed or became a symbolic link: ${logical}`,
            );
          }
          observedPaths.push(logical);
          continue;
        }
        const child = fs.openSync(
          `/proc/self/fd/${directoryDescriptor}/${name}`,
          fs.constants.O_RDONLY
            | (declared.type === 'directory' ? (fs.constants.O_DIRECTORY || 0) : 0)
            | (declared.type === 'file' ? (fs.constants.O_NONBLOCK || 0) : 0)
            | (fs.constants.O_NOFOLLOW || 0)
            | (fs.constants.O_CLOEXEC || 0),
        );
        descriptors.push(child);
        const stat = fs.fstatSync(child);
        if ((declared.type === 'directory' && !stat.isDirectory())
            || (declared.type === 'file' && (!stat.isFile() || stat.nlink !== 1))
            || stat.uid !== declared.uid
            || stat.gid !== declared.gid
            || mode(stat) !== declared.mode) {
          throw new Error(
            `process runtime image type, link count, ownership, or mode changed: ${logical}`,
          );
        }
        observedPaths.push(logical);
        if (declared.type === 'directory') walk(child, logical);
        fs.closeSync(child);
        descriptors.splice(descriptors.indexOf(child), 1);
      }
    };
    walk(descriptor, '/');
    const expectedPaths = closure.entries
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath !== '/')
      .filter((entryPath) => {
        if (!allowMountedTargets) return true;
        return !closure.entries.some((entry) => (
          entry.role === 'mount_target'
            && entry.type === 'directory'
            && entryPath.startsWith(`${entry.path}/`)
        ));
      })
      .sort();
    if (canonicalJson(observedPaths.sort()) !== canonicalJson(expectedPaths)) {
      throw new Error('process runtime image recursive entry set is incomplete');
    }
    for (const filePath of expectedFiles) {
      let current = descriptor;
      let traversed = '/';
      const openedForPath = [];
      for (const component of filePath.slice(1).split('/').slice(0, -1)) {
        const next = fs.openSync(`/proc/self/fd/${current}/${component}`, directoryFlags);
        descriptors.push(next);
        openedForPath.push(next);
        traversed = path.join(traversed, component);
        const entry = entries.get(traversed);
        const stat = fs.fstatSync(next);
        if (!entry || entry.type !== 'directory' || !stat.isDirectory()
            || stat.uid !== entry.uid || stat.gid !== entry.gid
            || mode(stat) !== entry.mode) {
          throw new Error(`process runtime ancestor differs from signed closure: ${traversed}`);
        }
        current = next;
      }
      const entry = entries.get(filePath);
      const fileDescriptor = fs.openSync(
        `/proc/self/fd/${current}/${path.basename(filePath)}`,
        fs.constants.O_RDONLY
          | (fs.constants.O_NONBLOCK || 0)
          | (fs.constants.O_NOFOLLOW || 0)
          | (fs.constants.O_CLOEXEC || 0),
      );
      descriptors.push(fileDescriptor);
      const stat = fs.fstatSync(fileDescriptor);
      const bytes = fs.readFileSync(fileDescriptor);
      const afterRead = fs.fstatSync(fileDescriptor);
      if (!entry || !stat.isFile()
          || stat.nlink !== 1
          || stat.uid !== entry.uid || stat.gid !== entry.gid
          || mode(stat) !== entry.mode
          || stat.size !== entry.bytes || bytes.length !== entry.bytes
          || sha256Bytes(bytes) !== entry.sha256
          || !sameRuntimeObjectMetadata(stat, afterRead)) {
        throw new Error(`process runtime file differs during descriptor validation: ${filePath}`);
      }
      for (const opened of openedForPath.reverse()) {
        fs.closeSync(opened);
        descriptors.splice(descriptors.indexOf(opened), 1);
      }
      fs.closeSync(fileDescriptor);
      descriptors.splice(descriptors.indexOf(fileDescriptor), 1);
    }
    return true;
  } finally {
    for (const descriptor of descriptors.reverse()) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

const SERVICE_ACCESS_PROBE = String.raw`
import fs from 'node:fs';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const groups = [...new Set(request.supplementaryGroups.map(Number))].sort((a, b) => a - b);
if (process.geteuid() === 0) {
  process.setgroups(groups);
  process.setgid(request.gid);
  process.setuid(request.uid);
} else {
  const observed = [...new Set(process.getgroups().map(Number))].sort((a, b) => a - b);
  if (process.geteuid() !== request.uid || process.getegid() !== request.gid
      || JSON.stringify(observed) !== JSON.stringify(groups)) {
    throw new Error('cannot assume the requested service credentials');
  }
}
for (const entry of request.entries) {
  fs.accessSync(
    entry.path,
    fs.constants.R_OK
      | (entry.type === 'directory' || entry.executable ? fs.constants.X_OK : 0),
  );
  const descriptor = fs.openSync(
    entry.path,
    (entry.type === 'directory' ? fs.constants.O_DIRECTORY : 0)
      | fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if ((entry.type === 'directory' && !stat.isDirectory())
        || (entry.type === 'file' && !stat.isFile())) {
      throw new Error('service-access object type changed');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
`;

function assertNoExtendedAccessAcls(paths, {
  aclInspector = '/usr/bin/getfacl',
  commandRunner = spawnSync,
} = {}) {
  const resolvedInspector = fs.realpathSync.native(aclInspector);
  const inspectorStat = fs.lstatSync(resolvedInspector);
  if (!inspectorStat.isFile() || inspectorStat.isSymbolicLink()
      || inspectorStat.uid !== 0 || inspectorStat.gid !== 0
      || (inspectorStat.mode & 0o7022) !== 0
      || (inspectorStat.mode & 0o005) !== 0o005) {
    throw new Error('service-access ACL inspector is not root-owned immutable material');
  }
  const descriptor = fs.openSync(
    resolvedInspector,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  let result;
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (descriptorStat.dev !== inspectorStat.dev || descriptorStat.ino !== inspectorStat.ino) {
      throw new Error('service-access ACL inspector changed during descriptor binding');
    }
    result = commandRunner('/proc/self/fd/3', [
      '--absolute-names',
      '--physical',
      '--skip-base',
      ...paths,
    ], {
      encoding: 'utf8',
      env: FIXED_HELPER_ENVIRONMENT,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
    });
  } finally {
    fs.closeSync(descriptor);
  }
  if (result.error || result.status !== 0 || String(result.stdout || '').trim() !== '') {
    throw new Error(
      `process runtime closure has an extended ACL or cannot prove its absence: ${
        result.error?.message || result.stderr || 'extended ACL present'
      }`,
    );
  }
}

export function assertProcessRuntimeClosureServiceAccess(closure, {
  uid,
  gid,
  supplementaryGroups = [gid],
  additionalEntries = [],
  aclInspector = '/usr/bin/getfacl',
  commandRunner = spawnSync,
  credentialRunner = spawnSync,
  rootDirectory = closure?.rootDirectory,
} = {}) {
  const validation = validateProcessRuntimeClosure(closure);
  if (!validation.ok) {
    throw new Error(`invalid process runtime closure: ${validation.errors.join('; ')}`);
  }
  if (!Number.isSafeInteger(uid) || uid < 1
      || !Number.isSafeInteger(gid) || gid < 1
      || !Array.isArray(supplementaryGroups)
      || supplementaryGroups.length < 1
      || supplementaryGroups.some((group) => !Number.isSafeInteger(group) || group < 1)
      || !Array.isArray(additionalEntries)) {
    throw new Error('service-access credential declaration is invalid');
  }
  const entries = [
    ...closure.entries.map((entry) => ({
      path: runtimeImagePath(rootDirectory, entry.path),
      type: entry.type,
      executable: ['interpreter', 'helper_executable', 'runtime_loader']
        .includes(entry.role),
    })),
    ...additionalEntries,
  ];
  for (const declared of closure.entries) {
    const stat = fs.lstatSync(runtimeImagePath(rootDirectory, declared.path));
    if (stat.uid !== declared.uid || stat.gid !== declared.gid
        || mode(stat) !== declared.mode) {
      throw new Error(`service-access runtime metadata differs from closure: ${declared.path}`);
    }
  }
  const observed = new Set();
  for (const entry of entries) {
    if (!exactKeys(entry, ['executable', 'path', 'type'])
        || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)
        || !['directory', 'file'].includes(entry.type)
        || typeof entry.executable !== 'boolean'
        || observed.has(entry.path)) {
      throw new Error('service-access closure entry declaration is invalid');
    }
    observed.add(entry.path);
    const stat = fs.lstatSync(entry.path);
    if (stat.isSymbolicLink()
        || (entry.type === 'directory' ? !stat.isDirectory() : !stat.isFile())
        || (entry.type === 'directory' && (stat.mode & 0o005) !== 0o005)
        || (entry.type === 'file' && (stat.mode & 0o004) === 0)
        || (entry.executable && (stat.mode & 0o005) !== 0o005)) {
      throw new Error(`service identity cannot access immutable closure entry: ${entry.path}`);
    }
  }
  assertNoExtendedAccessAcls([...observed].sort(), {
    aclInspector,
    commandRunner,
  });
  const result = credentialRunner(process.execPath, [
    '--input-type=module',
    '-e',
    SERVICE_ACCESS_PROBE,
  ], {
    input: canonicalJson({
      uid,
      gid,
      supplementaryGroups,
      entries,
    }),
    encoding: 'utf8',
    env: FIXED_HELPER_ENVIRONMENT,
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error(
      `immutable closure is inaccessible to the exact service credentials: ${
        result.error?.message || result.stderr || result.signal || result.status
      }`,
    );
  }
  return true;
}
