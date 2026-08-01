import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { openExactApprovedRuntimeEntrypoint } from './approved-runtime-root.mjs';

export const APPROVED_MODEL_EXECUTABLE_SCHEMA =
  'cortex.learning_os.approved_model_executable.v1';
export const APPROVED_MODEL_RUNTIME_CLOSURE_SCHEMA =
  'cortex.learning_os.approved_model_runtime_closure.v1';
export const APPROVED_MODEL_EXECUTABLE_ROOT =
  '/opt/cortex-learning-os/approved-model-executors';
export const APPROVED_MODEL_EXECUTABLE_CHILD_FD = 3;

const DIGEST = /^[0-9a-f]{64}$/;
const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function runtimeClosureDigest(closure) {
  return sha256Text(canonicalJson({
    schemaVersion: closure.schemaVersion,
    platform: closure.platform,
    architecture: closure.architecture,
    linkage: closure.linkage,
    root: closure.root,
    immutable: closure.immutable,
    entryCount: closure.entryCount,
    entries: closure.entries,
  }));
}

function staticLinuxX64ElfErrors(bytes) {
  const errors = [];
  if (!Buffer.isBuffer(bytes)
      || bytes.length < 64
      || bytes[0] !== 0x7f
      || bytes[1] !== 0x45
      || bytes[2] !== 0x4c
      || bytes[3] !== 0x46
      || bytes[4] !== 2
      || bytes[5] !== 1
      || bytes.readUInt16LE(18) !== 62) {
    return ['approved model executable is not a Linux x86-64 ELF object'];
  }
  const programHeaderOffset = Number(bytes.readBigUInt64LE(32));
  const programHeaderEntryBytes = bytes.readUInt16LE(54);
  const programHeaderCount = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(programHeaderOffset)
      || programHeaderEntryBytes < 56
      || programHeaderCount < 1
      || programHeaderCount > 4096
      || programHeaderOffset + (programHeaderEntryBytes * programHeaderCount) > bytes.length) {
    return ['approved model executable has an invalid ELF program-header table'];
  }
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + (index * programHeaderEntryBytes);
    if (bytes.readUInt32LE(offset) === 3) {
      errors.push('approved model executable requires an unbound ELF interpreter');
      break;
    }
  }
  return errors;
}

export function validateApprovedModelExecutableBinding(binding) {
  const errors = [];
  const closure = binding?.runtimeClosure;
  const executableEntry = closure?.entries?.find((entry) => entry?.role === 'entrypoint');
  const expectedRoot = DIGEST.test(String(binding?.sha256 || ''))
    ? `${APPROVED_MODEL_EXECUTABLE_ROOT}/${binding.sha256}`
    : null;
  if (!exactKeys(binding, [
    'bytes',
    'path',
    'runtimeClosure',
    'runtimeClosureSha256',
    'schemaVersion',
    'sha256',
  ])
      || binding?.schemaVersion !== APPROVED_MODEL_EXECUTABLE_SCHEMA
      || typeof binding?.path !== 'string'
      || !path.posix.isAbsolute(binding.path)
      || !Number.isSafeInteger(binding.bytes)
      || binding.bytes < 1
      || binding.bytes > MAX_EXECUTABLE_BYTES
      || !DIGEST.test(String(binding.sha256 || ''))
      || !DIGEST.test(String(binding.runtimeClosureSha256 || ''))) {
    errors.push('approved model executable identity is invalid');
  }
  if (!exactKeys(closure, [
    'architecture',
    'closureSha256',
    'entries',
    'entryCount',
    'immutable',
    'linkage',
    'platform',
    'root',
    'schemaVersion',
  ])
      || closure?.schemaVersion !== APPROVED_MODEL_RUNTIME_CLOSURE_SCHEMA
      || closure?.platform !== 'linux'
      || closure?.architecture !== 'x86_64'
      || closure?.linkage !== 'static_elf_no_interpreter'
      || closure?.root !== expectedRoot
      || closure?.immutable !== true
      || closure?.entryCount !== 2
      || !Array.isArray(closure?.entries)
      || closure.entries.length !== 2
      || !DIGEST.test(String(closure?.closureSha256 || ''))
      || closure?.closureSha256 !== runtimeClosureDigest(closure)
      || binding?.runtimeClosureSha256 !== closure?.closureSha256) {
    errors.push('approved model executable runtime closure is invalid');
  }
  const expectedEntries = expectedRoot === null ? null : [
    {
      path: '.',
      role: 'runtime_root',
      type: 'directory',
      uid: 0,
      gid: 0,
      mode: '0555',
    },
    {
      path: 'codex',
      role: 'entrypoint',
      type: 'file',
      uid: 0,
      gid: 0,
      mode: '0555',
      bytes: binding.bytes,
      sha256: binding.sha256,
    },
  ];
  if (expectedEntries === null
      || canonicalJson(closure?.entries) !== canonicalJson(expectedEntries)
      || executableEntry?.bytes !== binding?.bytes
      || executableEntry?.sha256 !== binding?.sha256
      || binding?.path !== `${expectedRoot}/codex`) {
    errors.push('approved model executable path, bytes, digest, or entry set is detached');
  }
  return { ok: errors.length === 0, errors };
}

function openTrustedDirectoryChain(absoluteTarget) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('approved model executable requires Linux descriptor-relative traversal');
  }
  const descriptors = [];
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const assertTrusted = (descriptor, label) => {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error(`approved model executable ancestor is not root-owned immutable material: ${label}`);
    }
  };
  try {
    const parsed = path.parse(absoluteTarget);
    let current = fs.openSync(parsed.root, flags);
    descriptors.push(current);
    assertTrusted(current, parsed.root);
    let traversed = parsed.root;
    for (const component of absoluteTarget.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${current}/${component}`, flags);
      descriptors.push(next);
      traversed = path.join(traversed, component);
      assertTrusted(next, traversed);
      current = next;
    }
    return { descriptors, rootDescriptor: current };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) fs.closeSync(descriptor);
    throw error;
  }
}

export function openApprovedModelExecutable(binding) {
  const validation = validateApprovedModelExecutableBinding(binding);
  if (!validation.ok) {
    throw new Error(`invalid approved model executable binding: ${validation.errors.join('; ')}`);
  }
  const trustedChain = openTrustedDirectoryChain(binding.runtimeClosure.root);
  let executableDescriptor = null;
  try {
    const opened = openApprovedModelRuntimeClosureAtDescriptor(
      trustedChain.rootDescriptor,
      binding.runtimeClosure,
    );
    executableDescriptor = opened.descriptor;
    const { bytes } = opened;
    const elfErrors = staticLinuxX64ElfErrors(bytes);
    if (elfErrors.length > 0) throw new Error(elfErrors.join('; '));
    return {
      descriptor: executableDescriptor,
      requestedPath: binding.path,
      executedPath: `/proc/self/fd/${APPROVED_MODEL_EXECUTABLE_CHILD_FD}`,
      identity: {
        invoked: binding.path,
        resolvedPath: `/proc/self/fd/${APPROVED_MODEL_EXECUTABLE_CHILD_FD}`,
        bytes: binding.bytes,
        sha256: binding.sha256,
      },
    };
  } catch (error) {
    if (executableDescriptor !== null) fs.closeSync(executableDescriptor);
    throw error;
  } finally {
    for (const descriptor of trustedChain.descriptors.reverse()) fs.closeSync(descriptor);
  }
}

export function openApprovedModelRuntimeClosureAtDescriptor(rootDescriptor, closure) {
  return openExactApprovedRuntimeEntrypoint({
    closure,
    entrypointPath: 'codex',
    label: 'approved model executable',
    rootDescriptor,
  });
}

export function assertApprovedModelExecutableAtPath(binding) {
  const opened = openApprovedModelExecutable(binding);
  fs.closeSync(opened.descriptor);
  return true;
}

export function buildApprovedModelExecutableBinding(executablePath) {
  const resolved = path.resolve(executablePath);
  const bytes = fs.readFileSync(resolved);
  const sha256 = sha256Bytes(bytes);
  const runtimeRoot = `${APPROVED_MODEL_EXECUTABLE_ROOT}/${sha256}`;
  if (resolved !== `${runtimeRoot}/codex`) {
    throw new Error(`approved model executable must be installed at ${runtimeRoot}/codex`);
  }
  const elfErrors = staticLinuxX64ElfErrors(bytes);
  if (elfErrors.length > 0) throw new Error(elfErrors.join('; '));
  const runtimeClosure = {
    schemaVersion: APPROVED_MODEL_RUNTIME_CLOSURE_SCHEMA,
    platform: 'linux',
    architecture: 'x86_64',
    linkage: 'static_elf_no_interpreter',
    root: runtimeRoot,
    immutable: true,
    entryCount: 2,
    entries: [
      {
        path: '.',
        role: 'runtime_root',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: 'codex',
        role: 'entrypoint',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0555',
        bytes: bytes.length,
        sha256,
      },
    ],
  };
  runtimeClosure.closureSha256 = runtimeClosureDigest(runtimeClosure);
  const binding = {
    schemaVersion: APPROVED_MODEL_EXECUTABLE_SCHEMA,
    path: resolved,
    bytes: bytes.length,
    sha256,
    runtimeClosure,
    runtimeClosureSha256: runtimeClosure.closureSha256,
  };
  assertApprovedModelExecutableAtPath(binding);
  return binding;
}

export function approvedExecutableStdio(descriptor) {
  const stat = fs.fstatSync(descriptor);
  if (!stat.isFile()) throw new Error('approved model executable descriptor is not a file');
  return ['pipe', 'pipe', 'pipe', descriptor];
}
