import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { openExactApprovedRuntimeEntrypoint } from './approved-runtime-root.mjs';

export const APPROVED_RESEARCH_RUNTIME_SCHEMA =
  'cortex.learning_os.approved_research_runtime.v3';
export const APPROVED_RESEARCH_RUNTIME_CLOSURE_SCHEMA =
  'cortex.learning_os.approved_research_runtime_closure.v1';
export const APPROVED_RESEARCH_DAEMON_CLOSURE_SCHEMA =
  'cortex.learning_os.approved_research_daemon_closure.v3';
export const APPROVED_RESEARCH_RUNTIME_ROOT =
  '/opt/cortex-learning-os/approved-research-runtimes';
export const APPROVED_RESEARCH_RUNTIME_CHILD_FD = 4;

const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_UNIT = /^[A-Za-z0-9_.@-]+[.](?:service|socket)$/;
const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;
const MAX_DAEMON_ENTRIES = 50_000;
const APPARMOR_POLICY_ROOT = '/sys/kernel/security/apparmor/policy/profiles';
const O_PATH = 0x200000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFixtureOnlyBoolean(fixtureOnly) {
  if (typeof fixtureOnly !== 'boolean') {
    throw new Error('approved research runtime fixtureOnly must be a boolean');
  }
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function closureDigest(value, omitted = 'closureSha256') {
  const payload = { ...value };
  delete payload[omitted];
  return sha256Text(canonicalJson(payload));
}

function modeString(mode) {
  return `0${(Number(mode) & 0o7777).toString(8).padStart(3, '0')}`;
}

function safeAbsolute(value) {
  return typeof value === 'string'
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && !value.includes('\0');
}

function staticLinuxX64ElfErrors(bytes) {
  if (!Buffer.isBuffer(bytes)
      || bytes.length < 64
      || bytes[0] !== 0x7f
      || bytes[1] !== 0x45
      || bytes[2] !== 0x4c
      || bytes[3] !== 0x46
      || bytes[4] !== 2
      || bytes[5] !== 1
      || bytes.readUInt16LE(18) !== 62) {
    return ['approved research runtime is not a Linux x86-64 ELF object'];
  }
  const table = Number(bytes.readBigUInt64LE(32));
  const entryBytes = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(table) || entryBytes < 56 || count < 1 || count > 4096
      || table + (entryBytes * count) > bytes.length) {
    return ['approved research runtime has an invalid ELF program-header table'];
  }
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(table + (index * entryBytes)) === 3) {
      return ['approved research runtime requires an unbound ELF interpreter'];
    }
  }
  return [];
}

function argvOption(argv, names) {
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    for (const name of names) {
      if (argument === name && index + 1 < argv.length) return argv[index + 1];
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    }
  }
  return null;
}

function deriveDockerTopology(argv, configurationBytes) {
  let configuration;
  try {
    configuration = JSON.parse(configurationBytes.toString('utf8'));
  } catch {
    throw new Error('approved research daemon configuration bytes are not exact JSON');
  }
  if (!isRecord(configuration)) {
    throw new Error('approved research daemon configuration must be an object');
  }
  if ((configuration['authorization-plugins'] || []).length > 0) {
    throw new Error('approved Docker topology cannot delegate authority to an external plugin');
  }
  const configurationFile = argvOption(argv, ['--config-file'])
    || '/etc/docker/daemon.json';
  const dataRoot = argvOption(argv, ['--data-root', '-g'])
    || configuration['data-root']
    || '/var/lib/docker';
  const execRoot = argvOption(argv, ['--exec-root'])
    || configuration['exec-root']
    || '/var/run/docker';
  const containerdSocket = argvOption(argv, ['--containerd'])
    || configuration.containerd
    || '/run/containerd/containerd.sock';
  const defaultRuntimeName = argvOption(argv, ['--default-runtime'])
    || configuration['default-runtime']
    || 'runc';
  const configuredRuntime = configuration.runtimes?.[defaultRuntimeName];
  const defaultRuntimePath = typeof configuredRuntime === 'string'
    ? configuredRuntime
    : configuredRuntime?.path || '/usr/bin/runc';
  const seccompProfilePath = argvOption(argv, ['--seccomp-profile'])
    || configuration['seccomp-profile'];
  const shimPath = path.posix.join(
    path.posix.dirname(defaultRuntimePath),
    'containerd-shim-runc-v2',
  );
  const result = {
    configurationFile,
    configurationBytesBase64: configurationBytes.toString('base64'),
    configurationSha256: sha256Bytes(configurationBytes),
    dataRoot,
    execRoot,
    containerdSocket,
    defaultRuntimeName,
    defaultRuntimePath,
    shimPath,
    seccompProfilePath,
  };
  if (Object.values(result).some((value) => typeof value !== 'string')
      || ![
        result.configurationFile,
        result.dataRoot,
        result.execRoot,
        result.containerdSocket,
        result.defaultRuntimePath,
        result.shimPath,
        result.seccompProfilePath,
      ].every(safeAbsolute)) {
    throw new Error('approved Docker topology could not be derived from authenticated argv/config');
  }
  return result;
}

function deriveDaemonTopology(kind, argv, configurationBytes) {
  if (kind !== 'docker') {
    throw new Error('only the fully measured Docker/containerd substrate is approved');
  }
  return deriveDockerTopology(argv, configurationBytes);
}

function validateExecutionStore(store, topology) {
  return exactKeys(store, [
    'dataRoot', 'dataRootDevice', 'dataRootInode', 'dataRootMode',
    'dataRootUid', 'dataRootGid', 'execRoot', 'execRootDevice',
    'execRootInode', 'execRootMode', 'execRootUid', 'execRootGid',
    'mutable', 'recursivelyHashed',
  ])
    && store.dataRoot === topology.dataRoot
    && store.execRoot === topology.execRoot
    && store.mutable === true
    && store.recursivelyHashed === false
    && ['dataRootDevice', 'dataRootInode', 'execRootDevice', 'execRootInode']
      .every((field) => /^[0-9]+$/.test(String(store[field] || '')))
    && ['dataRootMode', 'execRootMode'].every(
      (field) => /^[0-7]{4}$/.test(String(store[field] || '')),
    )
    && ['dataRootUid', 'dataRootGid', 'execRootUid', 'execRootGid'].every(
      (field) => Number.isSafeInteger(store[field]) && store[field] >= 0,
    );
}

function validateRuntimeHelper(helper) {
  return exactKeys(helper, ['bytes', 'linkage', 'path', 'sha256'])
    && safeAbsolute(helper.path)
    && Number.isSafeInteger(helper.bytes) && helper.bytes > 0
    && DIGEST.test(String(helper.sha256 || ''))
    && helper.linkage === 'static_elf_no_interpreter';
}

function validateSecurityProfile(profile) {
  if (profile?.kind === 'apparmor') {
    return exactKeys(profile, [
      'kind', 'kernelPath', 'kernelPolicySha256', 'kernelRawPolicySha256', 'mode', 'name',
    ])
      && profile.name === 'docker-default'
      && profile.mode === 'enforce'
      && safeAbsolute(profile.kernelPath)
      && DIGEST.test(String(profile.kernelPolicySha256 || ''))
      && DIGEST.test(String(profile.kernelRawPolicySha256 || ''));
  }
  return profile?.kind === 'seccomp'
    && exactKeys(profile, ['kind', 'name', 'path', 'sha256'])
    && profile.name === 'cortex-research'
    && safeAbsolute(profile.path)
    && DIGEST.test(String(profile.sha256 || ''));
}

export function observeAppArmorKernelProfile(name = 'docker-default', {
  policyRoot = APPARMOR_POLICY_ROOT,
} = {}) {
  if (!/^[A-Za-z0-9_.-]{1,160}$/.test(String(name || ''))
      || !safeAbsolute(policyRoot)) {
    throw new Error('AppArmor kernel policy observation requires an exact profile and root');
  }
  const matches = [];
  for (const entry of fs.readdirSync(policyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const profileRoot = path.join(policyRoot, entry.name);
    try {
      const observedName = fs.readFileSync(path.join(profileRoot, 'name'), 'utf8').trim();
      if (observedName !== name) continue;
      const mode = fs.readFileSync(path.join(profileRoot, 'mode'), 'utf8').trim();
      const kernelPolicySha256 = fs.readFileSync(
        path.join(profileRoot, 'sha256'),
        'utf8',
      ).trim();
      const kernelRawPolicySha256 = fs.readFileSync(
        path.join(profileRoot, 'raw_sha256'),
        'utf8',
      ).trim();
      if (!DIGEST.test(kernelPolicySha256) || !DIGEST.test(kernelRawPolicySha256)
          || fs.readFileSync(path.join(profileRoot, 'name'), 'utf8').trim() !== observedName
          || fs.readFileSync(path.join(profileRoot, 'mode'), 'utf8').trim() !== mode
          || fs.readFileSync(path.join(profileRoot, 'sha256'), 'utf8').trim()
            !== kernelPolicySha256
          || fs.readFileSync(path.join(profileRoot, 'raw_sha256'), 'utf8').trim()
            !== kernelRawPolicySha256) {
        throw new Error('loaded AppArmor policy changed during kernel observation');
      }
      matches.push({
        kind: 'apparmor',
        name,
        mode,
        kernelPath: profileRoot,
        kernelPolicySha256,
        kernelRawPolicySha256,
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (matches.length !== 1 || matches[0].mode !== 'enforce') {
    throw new Error('loaded AppArmor policy is absent, ambiguous, or not enforcing');
  }
  return matches[0];
}

function validateAuxiliaryProcess(auxiliary) {
  return exactKeys(auxiliary, [
    'argv', 'cgroup', 'configurationFiles', 'executableBytes', 'executablePath',
    'executableSha256', 'gid', 'mappedDependencySha256s', 'pid', 'socketDevice',
    'socketInode', 'startTimeTicks', 'uid',
  ])
    && Number.isSafeInteger(auxiliary.pid) && auxiliary.pid >= 2
    && auxiliary.uid === 0 && auxiliary.gid === 0
    && Array.isArray(auxiliary.argv) && auxiliary.argv.length > 0
    && auxiliary.argv.every((entry) => typeof entry === 'string' && entry.length > 0)
    && safeAbsolute(auxiliary.executablePath)
    && Number.isSafeInteger(auxiliary.executableBytes) && auxiliary.executableBytes > 0
    && DIGEST.test(String(auxiliary.executableSha256 || ''))
    && typeof auxiliary.cgroup === 'string' && auxiliary.cgroup.startsWith('/')
    && /^[0-9]+$/.test(String(auxiliary.startTimeTicks || ''))
    && /^[0-9]+$/.test(String(auxiliary.socketDevice || ''))
    && /^[0-9]+$/.test(String(auxiliary.socketInode || ''))
    && Array.isArray(auxiliary.mappedDependencySha256s)
    && auxiliary.mappedDependencySha256s.length > 0
    && auxiliary.mappedDependencySha256s.every((entry) => DIGEST.test(String(entry)))
    && canonicalJson(auxiliary.mappedDependencySha256s)
      === canonicalJson([...new Set(auxiliary.mappedDependencySha256s)].sort())
    && Array.isArray(auxiliary.configurationFiles)
    && auxiliary.configurationFiles.length === 1
    && auxiliary.configurationFiles.every((entry) => (
      exactKeys(entry, ['path', 'sha256'])
      && safeAbsolute(entry.path)
      && DIGEST.test(String(entry.sha256 || ''))
    ));
}

function validateDaemonEntry(entry) {
  if (!isRecord(entry)
      || !safeAbsolute(entry.path)
      || !Array.isArray(entry.roles)
      || entry.roles.length < 1
      || entry.roles.some((role) => (
        typeof role !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(role)
      ))
      || canonicalJson(entry.roles) !== canonicalJson([...new Set(entry.roles)].sort())
      || !Number.isSafeInteger(entry.uid) || entry.uid < 0
      || !Number.isSafeInteger(entry.gid) || entry.gid < 0
      || !/^[0-7]{4}$/.test(String(entry.mode || ''))
      || !/^[0-9]+$/.test(String(entry.device || ''))
      || !/^[0-9]+$/.test(String(entry.inode || ''))) {
    return false;
  }
  const numericMode = Number.parseInt(entry.mode, 8);
  if (entry.uid !== 0
      || (numericMode & 0o7000) !== 0
      || (entry.type !== 'socket' && (numericMode & 0o022) !== 0)
      || (entry.type === 'socket' && (numericMode & 0o007) !== 0)
      || (entry.type !== 'socket' && entry.gid !== 0)
      || (entry.type === 'directory' && (numericMode & 0o100) === 0)) {
    return false;
  }
  if (entry.type === 'directory' || entry.type === 'socket') {
    return exactKeys(entry, [
      'device', 'gid', 'inode', 'mode', 'path', 'roles', 'type', 'uid',
    ]);
  }
  return entry.type === 'file'
    && exactKeys(entry, [
      'bytes', 'device', 'gid', 'inode', 'mode', 'path', 'roles', 'sha256',
      'type', 'uid',
    ])
    && Number.isSafeInteger(entry.bytes)
    && entry.bytes >= 0
    && DIGEST.test(String(entry.sha256 || ''));
}

function validateDaemonClosure(daemon, kind) {
  let derivedTopology = null;
  try {
    const configurationBytes = Buffer.from(
      daemon?.derivedTopology?.configurationBytesBase64 || '',
      'base64',
    );
    if (configurationBytes.toString('base64')
        !== daemon?.derivedTopology?.configurationBytesBase64) {
      return false;
    }
    derivedTopology = deriveDaemonTopology(kind, daemon?.process?.argv || [], configurationBytes);
  } catch {
    return false;
  }
  const expectedRoots = derivedTopology === null ? [] : [
    {
      path: path.posix.dirname(derivedTopology.configurationFile),
      role: 'configuration_root',
    },
    {
      path: daemon?.serviceManager?.rootDirectory || '/',
      role: 'rootfs_root',
    },
  ].sort((left, right) => (
    left.path.localeCompare(right.path) || left.role.localeCompare(right.role)
  ));
  if (!exactKeys(daemon, [
    'auxiliaryProcesses', 'closureSha256', 'derivedTopology', 'entries',
    'entryCount', 'executionStore', 'immutable', 'kind', 'process',
    'roots', 'runtimeHelpers', 'schemaVersion', 'securityProfiles',
    'serviceManager', 'serviceUnit', 'socketPath', 'socketUnit',
  ])
      || daemon?.schemaVersion !== APPROVED_RESEARCH_DAEMON_CLOSURE_SCHEMA
      || daemon?.kind !== kind
      || daemon?.immutable !== true
      || !SAFE_UNIT.test(String(daemon?.serviceUnit || ''))
      || !String(daemon.serviceUnit).endsWith('.service')
      || !SAFE_UNIT.test(String(daemon?.socketUnit || ''))
      || !String(daemon.socketUnit).endsWith('.socket')
      || !safeAbsolute(daemon?.socketPath)
      || !Number.isSafeInteger(daemon?.entryCount)
      || daemon.entryCount < 1
      || daemon.entryCount > MAX_DAEMON_ENTRIES
      || !Array.isArray(daemon?.entries)
      || daemon.entries.length !== daemon.entryCount
      || daemon.entries.some((entry) => !validateDaemonEntry(entry))
      || canonicalJson(daemon.entries.map((entry) => entry.path))
        !== canonicalJson([...new Set(daemon.entries.map((entry) => entry.path))].sort())
      || canonicalJson(daemon.derivedTopology) !== canonicalJson(derivedTopology)
      || !validateExecutionStore(daemon.executionStore, derivedTopology)
      || !Array.isArray(daemon?.runtimeHelpers)
      || daemon.runtimeHelpers.length !== 2
      || daemon.runtimeHelpers.some((helper) => !validateRuntimeHelper(helper))
      || canonicalJson(daemon.runtimeHelpers.map((helper) => helper.path))
        !== canonicalJson([...new Set(daemon.runtimeHelpers.map((helper) => helper.path))].sort())
      || !daemon.runtimeHelpers.some(
        (helper) => helper.path === derivedTopology.defaultRuntimePath,
      )
      || !daemon.runtimeHelpers.some((helper) => helper.path === derivedTopology.shimPath)
      || !Array.isArray(daemon?.securityProfiles)
      || daemon.securityProfiles.length !== 2
      || daemon.securityProfiles.some((profile) => !validateSecurityProfile(profile))
      || !daemon.securityProfiles.some((profile) => profile.kind === 'apparmor')
      || !daemon.securityProfiles.some((profile) => (
        profile.kind === 'seccomp'
        && profile.path === derivedTopology.seccompProfilePath
        && daemon.entries.some((entry) => (
          entry.path === profile.path
          && entry.type === 'file'
          && entry.sha256 === profile.sha256
          && entry.roles.includes('security_profile')
        ))
      ))
      || !Array.isArray(daemon?.auxiliaryProcesses)
      || daemon.auxiliaryProcesses.length !== 1
      || daemon.auxiliaryProcesses.some((auxiliary) => !validateAuxiliaryProcess(auxiliary))
      || new Set(daemon.auxiliaryProcesses.map((auxiliary) => auxiliary.pid)).size
        !== daemon.auxiliaryProcesses.length
      || !Array.isArray(daemon?.roots)
      || daemon.roots.length < 1
      || daemon.roots.some((root) => (
        !exactKeys(root, ['path', 'role'])
        || !safeAbsolute(root.path)
        || !['configuration_root', 'rootfs_root'].includes(root.role)
      ))
      || !['configuration_root', 'rootfs_root'].every(
        (role) => daemon.roots.some((root) => root.role === role),
      )
      || canonicalJson(daemon.roots)
        !== canonicalJson(expectedRoots)
      || new Set(daemon.roots.map((root) => `${root.path}\0${root.role}`)).size
        !== daemon.roots.length
      || !exactKeys(daemon?.serviceManager, [
        'activeState', 'controlGroup', 'dropInPaths', 'execStartPath',
        'execStart', 'fragmentPath', 'invocationId', 'mainPid', 'rootDirectory', 'rootImage',
        'socketActiveState', 'socketFragmentPath', 'socketListen',
        'socketDropInPaths', 'socketUnitFileState', 'subState', 'unitFileState',
      ])
      || daemon.serviceManager.activeState !== 'active'
      || !['running', 'start'].includes(daemon.serviceManager.subState)
      || !['enabled', 'enabled-runtime', 'static'].includes(
        daemon.serviceManager.unitFileState,
      )
      || daemon.serviceManager.socketActiveState !== 'active'
      || !['enabled', 'enabled-runtime', 'static'].includes(
        daemon.serviceManager.socketUnitFileState,
      )
      || !safeAbsolute(daemon.serviceManager.fragmentPath)
      || !safeAbsolute(daemon.serviceManager.socketFragmentPath)
      || !safeAbsolute(daemon.serviceManager.execStartPath)
      || typeof daemon.serviceManager.execStart !== 'string'
      || systemdExecPath(daemon.serviceManager.execStart)
        !== daemon.serviceManager.execStartPath
      || !Array.isArray(daemon.serviceManager.dropInPaths)
      || daemon.serviceManager.dropInPaths.some((entry) => !safeAbsolute(entry))
      || canonicalJson(daemon.serviceManager.dropInPaths)
        !== canonicalJson([...new Set(daemon.serviceManager.dropInPaths)].sort())
      || !Array.isArray(daemon.serviceManager.socketDropInPaths)
      || daemon.serviceManager.socketDropInPaths.some((entry) => !safeAbsolute(entry))
      || canonicalJson(daemon.serviceManager.socketDropInPaths)
        !== canonicalJson([...new Set(daemon.serviceManager.socketDropInPaths)].sort())
      || !Number.isSafeInteger(daemon.serviceManager.mainPid)
      || daemon.serviceManager.mainPid < 2
      || !/^[0-9a-f]{32}$/.test(String(daemon.serviceManager.invocationId || ''))
      || typeof daemon.serviceManager.controlGroup !== 'string'
      || !daemon.serviceManager.controlGroup.startsWith('/')
      || !['', ...daemon.roots.map((root) => root.path)].includes(
        daemon.serviceManager.rootDirectory,
      )
      || daemon.serviceManager.rootImage !== ''
      || typeof daemon.serviceManager.socketListen !== 'string'
      || !daemon.serviceManager.socketListen.includes(daemon.socketPath)
      || !exactKeys(daemon?.process, [
        'cgroup', 'executableBytes', 'executableDevice', 'executableInode',
        'executablePath', 'executableSha256', 'gid', 'argv', 'pid', 'socketDevice',
        'socketInode', 'startTimeTicks', 'uid',
      ])
      || daemon.process.pid !== daemon.serviceManager.mainPid
      || !safeAbsolute(daemon.process.executablePath)
      || daemon.process.executablePath !== daemon.serviceManager.execStartPath
      || daemon.process.uid !== 0
      || daemon.process.gid !== 0
      || !Array.isArray(daemon.process.argv)
      || daemon.process.argv.length < 1
      || daemon.process.argv.some((argument) => (
        typeof argument !== 'string' || argument.length < 1 || argument.includes('\0')
      ))
      || daemon.process.argv[0] !== daemon.process.executablePath
      || !/^[0-9]+$/.test(String(daemon.process.startTimeTicks || ''))
      || !/^[0-9]+$/.test(String(daemon.process.executableDevice || ''))
      || !/^[0-9]+$/.test(String(daemon.process.executableInode || ''))
      || !/^[0-9]+$/.test(String(daemon.process.socketDevice || ''))
      || !/^[0-9]+$/.test(String(daemon.process.socketInode || ''))
      || !Number.isSafeInteger(daemon.process.executableBytes)
      || daemon.process.executableBytes < 1
      || !DIGEST.test(String(daemon.process.executableSha256 || ''))
      || daemon.process.cgroup !== daemon.serviceManager.controlGroup
      || daemon.closureSha256 !== closureDigest(daemon)) {
    return false;
  }
  const socketEntry = daemon.entries.find((entry) => entry.path === daemon.socketPath);
  const executableEntry = daemon.entries.find(
    (entry) => entry.path === daemon.process.executablePath,
  );
  return socketEntry?.type === 'socket'
    && socketEntry.device === daemon.process.socketDevice
    && socketEntry.inode === daemon.process.socketInode
    && executableEntry?.type === 'file'
    && executableEntry.device === daemon.process.executableDevice
    && executableEntry.inode === daemon.process.executableInode
    && executableEntry.bytes === daemon.process.executableBytes
    && executableEntry.sha256 === daemon.process.executableSha256
    && daemon.entries.some((entry) => (
      entry.path === daemon.serviceManager.fragmentPath
      && entry.roles.includes('service_unit')
    ))
    && daemon.entries.some((entry) => (
      entry.path === daemon.serviceManager.socketFragmentPath
      && entry.roles.includes('socket_unit')
    ))
    && daemon.serviceManager.dropInPaths.every((dropIn) => daemon.entries.some(
      (entry) => entry.path === dropIn && entry.roles.includes('service_drop_in'),
    ))
    && daemon.serviceManager.socketDropInPaths.every((dropIn) => daemon.entries.some(
      (entry) => entry.path === dropIn && entry.roles.includes('socket_drop_in'),
    ))
    && daemon.entries.some((entry) => (
      entry.path === daemon.derivedTopology.configurationFile
      && entry.type === 'file'
      && entry.sha256 === daemon.derivedTopology.configurationSha256
      && entry.roles.includes('configuration_file')
    ))
    && daemon.runtimeHelpers.every((helper) => daemon.entries.some((entry) => (
      entry.path === helper.path
      && entry.type === 'file'
      && entry.bytes === helper.bytes
      && entry.sha256 === helper.sha256
      && entry.roles.includes('runtime_helper')
    )))
    && daemon.auxiliaryProcesses.every((auxiliary) => daemon.entries.some((entry) => (
      entry.path === auxiliary.executablePath
      && entry.type === 'file'
      && entry.bytes === auxiliary.executableBytes
      && entry.sha256 === auxiliary.executableSha256
      && entry.roles.includes('auxiliary_executable')
    )))
    && daemon.auxiliaryProcesses.every((auxiliary) => (
      auxiliary.configurationFiles.every((configuration) => daemon.entries.some((entry) => (
        entry.path === configuration.path
        && entry.type === 'file'
        && entry.sha256 === configuration.sha256
        && entry.roles.includes('auxiliary_configuration')
      )))
    ))
    && daemon.roots.every((root) => daemon.entries.some((entry) => (
      entry.path === root.path
      && entry.type === 'directory'
      && entry.roles.includes(root.role)
    )));
}

export function validateApprovedResearchDaemonObservation(observation, binding) {
  const errors = [];
  if (!validateDaemonClosure(observation, binding?.kind)
      || observation?.closureSha256 !== binding?.daemonClosureSha256
      || canonicalJson(observation) !== canonicalJson(binding?.daemonClosure)) {
    errors.push('observed research daemon closure differs from the approved live identity');
  }
  return { ok: errors.length === 0, errors };
}

function structuralValidation(binding) {
  const errors = [];
  const expectedRoot = DIGEST.test(String(binding?.sha256 || ''))
    ? `${APPROVED_RESEARCH_RUNTIME_ROOT}/${binding.sha256}`
    : null;
  const closure = binding?.runtimeClosure;
  const daemon = binding?.daemonClosure;
  if (!exactKeys(binding, [
    'bytes', 'daemonClosure', 'daemonClosureSha256', 'kind', 'path',
    'runtimeClosure', 'runtimeClosureSha256', 'schemaVersion', 'sha256',
  ])
      || binding?.schemaVersion !== APPROVED_RESEARCH_RUNTIME_SCHEMA
      || binding?.kind !== 'docker'
      || binding?.path !== `${expectedRoot}/runtime`
      || !Number.isSafeInteger(binding?.bytes)
      || binding.bytes < 1 || binding.bytes > MAX_EXECUTABLE_BYTES
      || !DIGEST.test(String(binding?.sha256 || ''))
      || !DIGEST.test(String(binding?.runtimeClosureSha256 || ''))
      || !DIGEST.test(String(binding?.daemonClosureSha256 || ''))) {
    errors.push('approved research runtime identity is invalid');
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
      path: 'runtime',
      role: 'entrypoint',
      type: 'file',
      uid: 0,
      gid: 0,
      mode: '0555',
      bytes: binding.bytes,
      sha256: binding.sha256,
    },
  ];
  if (!exactKeys(closure, [
    'architecture', 'closureSha256', 'entries', 'entryCount', 'immutable',
    'linkage', 'platform', 'root', 'schemaVersion',
  ])
      || closure?.schemaVersion !== APPROVED_RESEARCH_RUNTIME_CLOSURE_SCHEMA
      || closure?.platform !== 'linux'
      || closure?.architecture !== 'x86_64'
      || closure?.linkage !== 'static_elf_no_interpreter'
      || closure?.root !== expectedRoot
      || closure?.immutable !== true
      || closure?.entryCount !== 2
      || canonicalJson(closure?.entries) !== canonicalJson(expectedEntries)
      || closure?.closureSha256 !== closureDigest(closure)
      || binding?.runtimeClosureSha256 !== closure?.closureSha256) {
    errors.push('approved research runtime execution closure is invalid or detached');
  }
  if (!validateDaemonClosure(daemon, binding?.kind)
      || binding?.daemonClosureSha256 !== daemon?.closureSha256) {
    errors.push('approved research daemon closure is invalid, incomplete, or detached');
  }
  return { ok: errors.length === 0, errors };
}

function runSystemctl(systemctl, unit, properties, commandRunner) {
  const result = commandRunner(systemctl, [
    'show',
    unit,
    '--no-pager',
    ...properties.map((property) => `--property=${property}`),
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `approved research daemon service inspection failed: ${
        result.error?.message || result.stderr || result.stdout || result.status
      }`,
    );
  }
  const observed = {};
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1 || Object.hasOwn(observed, line.slice(0, separator))) {
      throw new Error('approved research daemon service returned ambiguous properties');
    }
    observed[line.slice(0, separator)] = line.slice(separator + 1);
  }
  for (const property of properties) {
    if (!Object.hasOwn(observed, property)) {
      throw new Error(`approved research daemon service omitted ${property}`);
    }
  }
  return observed;
}

function systemdExecPath(value) {
  const match = String(value || '').match(/(?:^|[ ;])path=([^ ;]+)/);
  return match?.[1] || null;
}

function processStartTime(procRoot, pid) {
  const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
  const end = stat.lastIndexOf(')');
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  if (!/^[0-9]+$/.test(String(fields[19] || ''))) {
    throw new Error('approved research daemon process start time is unavailable');
  }
  return fields[19];
}

function processIds(procRoot, pid) {
  const status = fs.readFileSync(path.join(procRoot, String(pid), 'status'), 'utf8');
  const uid = status.match(/^Uid:\s+([0-9]+)\s+\1\s+\1\s+\1$/m);
  const gid = status.match(/^Gid:\s+([0-9]+)\s+\1\s+\1\s+\1$/m);
  if (!uid || !gid) {
    throw new Error('approved research daemon process credential set is not stable');
  }
  return { uid: Number(uid[1]), gid: Number(gid[1]) };
}

function processCgroup(procRoot, pid) {
  const rows = fs.readFileSync(path.join(procRoot, String(pid), 'cgroup'), 'utf8')
    .trim().split(/\r?\n/).filter(Boolean);
  const unified = rows.find((row) => row.startsWith('0::'));
  if (!unified || !unified.slice(3).startsWith('/')) {
    throw new Error('approved research daemon unified cgroup identity is unavailable');
  }
  return unified.slice(3);
}

function processArgv(procRoot, pid) {
  const bytes = fs.readFileSync(path.join(procRoot, String(pid), 'cmdline'));
  if (bytes.length < 2 || bytes.at(-1) !== 0) {
    throw new Error('approved research daemon process argv is unavailable');
  }
  const argv = bytes.subarray(0, -1).toString('utf8').split('\0');
  if (argv.some((argument) => argument.length < 1)) {
    throw new Error('approved research daemon process argv is ambiguous');
  }
  return argv;
}

function mappedFilePaths(procRoot, pid) {
  const result = new Set();
  for (const line of fs.readFileSync(path.join(procRoot, String(pid), 'maps'), 'utf8')
    .split(/\r?\n/)) {
    const match = line.match(/\s(\/.*)$/);
    if (!match) continue;
    const mapped = match[1]
      .replace(/\\040/g, ' ')
      .replace(/\\011/g, '\t')
      .replace(/\\012/g, '\n')
      .replace(/\\134/g, '\\');
    if (mapped.endsWith(' (deleted)')) {
      throw new Error('approved research daemon has a deleted mapped dependency');
    }
    if (safeAbsolute(mapped)) result.add(mapped);
  }
  return [...result].sort();
}

function unixSocketRecord(procRoot, socketPath) {
  const rows = fs.readFileSync(path.join(procRoot, 'net', 'unix'), 'utf8')
    .split(/\r?\n/).slice(1);
  const matches = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    if (fields.length >= 8 && fields.slice(7).join(' ') === socketPath) {
      matches.push({ inode: fields[6], type: fields[4], state: fields[5] });
    }
  }
  if (matches.length !== 1 || !/^[0-9]+$/.test(matches[0].inode)) {
    throw new Error('approved research daemon socket is absent or ambiguous in the kernel');
  }
  return matches[0];
}

function processOwnsSocket(procRoot, pid, inode) {
  const descriptorDirectory = path.join(procRoot, String(pid), 'fd');
  return fs.readdirSync(descriptorDirectory).some((name) => {
    try {
      return fs.readlinkSync(path.join(descriptorDirectory, name)) === `socket:[${inode}]`;
    } catch {
      return false;
    }
  });
}

function socketOwnerPids(procRoot, inode) {
  const owners = [];
  for (const name of fs.readdirSync(procRoot)) {
    if (!/^[1-9][0-9]*$/.test(name)) continue;
    try {
      if (processOwnsSocket(procRoot, Number(name), inode)) owners.push(Number(name));
    } catch {}
  }
  return owners.sort((left, right) => left - right);
}

function mutableDirectoryIdentity(target, fixtureOnly) {
  const opened = descriptorRecord(target, target, {
    fixtureOnly,
    expect: 'directory',
  });
  try {
    const stat = fs.fstatSync(opened.descriptor);
    return {
      path: target,
      device: String(stat.dev),
      inode: String(stat.ino),
      uid: stat.uid,
      gid: stat.gid,
      mode: modeString(stat.mode),
    };
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

function auxiliaryProcessRecord(procRoot, pid, socket, entries, fixtureOnly) {
  const ids = processIds(procRoot, pid);
  if (!fixtureOnly && (ids.uid !== 0 || ids.gid !== 0)) {
    throw new Error('approved research auxiliary process is not root-owned');
  }
  const executablePath = fs.readlinkSync(path.join(procRoot, String(pid), 'exe'));
  if (!safeAbsolute(executablePath) || executablePath.endsWith(' (deleted)')) {
    throw new Error('approved research auxiliary process executable is unsafe');
  }
  observeObject(executablePath, 'auxiliary_executable', entries, { fixtureOnly });
  const argv = processArgv(procRoot, pid);
  const configurationPath = argvOption(argv, ['--config', '-c'])
    || '/etc/containerd/config.toml';
  const configurationBytes = fs.readFileSync(configurationPath);
  if (/^[ \t]*imports[ \t]*=/m.test(configurationBytes.toString('utf8'))) {
    throw new Error('approved containerd configuration cannot import unbound files');
  }
  observeObject(configurationPath, 'auxiliary_configuration', entries, { fixtureOnly });
  const mapped = mappedFilePaths(procRoot, pid);
  for (const dependency of mapped) {
    observeObject(dependency, 'auxiliary_mapped_dependency', entries, { fixtureOnly });
  }
  const executable = entries.get(executablePath);
  const mappedDependencySha256s = [...new Set(mapped.map(
    (dependency) => entries.get(dependency)?.sha256,
  ).filter(Boolean))].sort();
  if (mappedDependencySha256s.length < 1) mappedDependencySha256s.push(executable.sha256);
  return {
    pid,
    startTimeTicks: processStartTime(procRoot, pid),
    uid: ids.uid,
    gid: ids.gid,
    argv,
    configurationFiles: [{
      path: configurationPath,
      sha256: entries.get(configurationPath).sha256,
    }],
    executablePath,
    executableBytes: executable.bytes,
    executableSha256: executable.sha256,
    cgroup: processCgroup(procRoot, pid),
    socketDevice: socket.device,
    socketInode: socket.inode,
    mappedDependencySha256s,
  };
}

function addRole(entries, record, role) {
  const existing = entries.get(record.path);
  if (existing) {
    const comparable = { ...record, roles: existing.roles };
    if (canonicalJson(existing) !== canonicalJson(comparable)) {
      throw new Error(`approved research daemon object changed during observation: ${record.path}`);
    }
    existing.roles = [...new Set([...existing.roles, role])].sort();
    return;
  }
  entries.set(record.path, { ...record, roles: [role] });
}

function hashOpenedFile(descriptor, expectedSize, displayPath) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error(`approved research daemon file size is unsafe: ${displayPath}`);
  }
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  for (;;) {
    const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (read === 0) break;
    total += read;
    if (total > expectedSize) {
      throw new Error(`approved research daemon file grew while hashed: ${displayPath}`);
    }
    hash.update(buffer.subarray(0, read));
  }
  if (total !== expectedSize) {
    throw new Error(`approved research daemon file changed while hashed: ${displayPath}`);
  }
  return { bytes: total, sha256: hash.digest('hex') };
}

function descriptorRecord(view, displayPath, {
  fixtureOnly,
  expect = null,
} = {}) {
  const flags = O_PATH | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0);
  const descriptor = fs.openSync(view, flags);
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    let type = null;
    if (stat.isDirectory()) type = 'directory';
    else if (stat.isFile()) type = 'file';
    else if (stat.isSocket()) type = 'socket';
    if (type === null || (expect !== null && type !== expect)) {
      throw new Error(`approved research daemon object has an unsafe type: ${displayPath}`);
    }
    const uid = Number(stat.uid);
    const gid = Number(stat.gid);
    const mode = modeString(stat.mode);
    const trustedUids = fixtureOnly ? [0, process.getuid()] : [0];
    if (!trustedUids.includes(uid) || (Number(stat.mode) & 0o7000) !== 0
        || (type !== 'socket' && !fixtureOnly && (Number(stat.mode) & 0o022) !== 0)
        || (type === 'socket' && !fixtureOnly && (Number(stat.mode) & 0o007) !== 0)) {
      throw new Error(
        `approved research daemon object is not immutable trusted-owner material: ${displayPath}`,
      );
    }
    const record = {
      path: displayPath,
      type,
      uid,
      gid,
      mode,
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
    };
    if (type === 'file') {
      const contentDescriptor = fs.openSync(
        view,
        fs.constants.O_RDONLY
          | (fs.constants.O_NOFOLLOW || 0)
          | (fs.constants.O_CLOEXEC || 0),
      );
      try {
        const contentStat = fs.fstatSync(contentDescriptor, { bigint: true });
        if (contentStat.dev !== stat.dev || contentStat.ino !== stat.ino
            || contentStat.size !== stat.size) {
          throw new Error(
            `approved research daemon file changed while opened: ${displayPath}`,
          );
        }
        const content = hashOpenedFile(
          contentDescriptor,
          Number(stat.size),
          displayPath,
        );
        record.bytes = content.bytes;
        record.sha256 = content.sha256;
      } finally {
        fs.closeSync(contentDescriptor);
      }
    }
    return { descriptor, record };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function addAncestors(absolutePath, entries, options) {
  const components = path.posix.dirname(absolutePath).split('/').filter(Boolean);
  let traversed = '/';
  let current = descriptorRecord('/', '/', { ...options, expect: 'directory' });
  try {
    addRole(entries, current.record, 'trusted_ancestor');
    for (const component of components) {
      traversed = path.posix.join(traversed, component);
      const next = descriptorRecord(
        `/proc/self/fd/${current.descriptor}/${component}`,
        traversed,
        { ...options, expect: 'directory' },
      );
      addRole(entries, next.record, 'trusted_ancestor');
      fs.closeSync(current.descriptor);
      current = next;
    }
  } finally {
    fs.closeSync(current.descriptor);
  }
}

function observeObject(absolutePath, role, entries, {
  recursive = false,
  fixtureOnly = false,
} = {}) {
  if (!safeAbsolute(absolutePath)) {
    throw new Error(`approved research daemon path is unsafe: ${absolutePath}`);
  }
  addAncestors(absolutePath, entries, { fixtureOnly });
  const walk = (view, displayPath, recurse, requireDirectory = false) => {
    const opened = descriptorRecord(view, displayPath, { fixtureOnly });
    try {
      addRole(entries, opened.record, role);
      if (!recurse) return;
      if (requireDirectory && opened.record.type !== 'directory') {
        throw new Error(
          `approved research daemon recursive root is not a directory: ${displayPath}`,
        );
      }
      if (opened.record.type === 'file') return;
      if (opened.record.type !== 'directory') {
        throw new Error(
          `approved research daemon recursive closure contains a special object: ${displayPath}`,
        );
      }
      const names = fs.readdirSync(`/proc/self/fd/${opened.descriptor}`).sort();
      for (const name of names) {
        if (name.includes('/') || name === '.' || name === '..') {
          throw new Error('approved research daemon directory returned an unsafe entry');
        }
        const childPath = path.posix.join(displayPath, name);
        const childView = `/proc/self/fd/${opened.descriptor}/${name}`;
        walk(childView, childPath, true);
      }
    } finally {
      fs.closeSync(opened.descriptor);
    }
  };
  walk(absolutePath, absolutePath, recursive, recursive);
  if (entries.size > MAX_DAEMON_ENTRIES) {
    throw new Error('approved research daemon closure exceeds the entry bound');
  }
}

function validateDaemonDeclaration(declaration) {
  if (!exactKeys(declaration, [
    'serviceUnit', 'socketPath', 'socketUnit',
  ])
      || !SAFE_UNIT.test(String(declaration?.serviceUnit || ''))
      || !String(declaration.serviceUnit).endsWith('.service')
      || !SAFE_UNIT.test(String(declaration?.socketUnit || ''))
      || !String(declaration.socketUnit).endsWith('.socket')
      || !safeAbsolute(declaration?.socketPath)) {
    throw new Error('approved research daemon observation declaration is invalid');
  }
}

export function observeApprovedResearchDaemon(declaration, {
  kind,
  systemctl = '/usr/bin/systemctl',
  commandRunner = spawnSync,
  procRoot = '/proc',
  appArmorPolicyRoot = APPARMOR_POLICY_ROOT,
  fixtureOnly = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  validateDaemonDeclaration(declaration);
  if (kind !== 'docker'
      || !safeAbsolute(systemctl)
      || process.platform !== 'linux'
      || !fs.existsSync('/proc/self/fd')) {
    throw new Error('approved research daemon observation requires Linux and an exact runtime kind');
  }
  const service = runSystemctl(systemctl, declaration.serviceUnit, [
    'ActiveState', 'SubState', 'UnitFileState', 'MainPID', 'InvocationID',
    'ControlGroup', 'FragmentPath', 'DropInPaths', 'ExecStart', 'RootDirectory',
    'RootImage',
  ], commandRunner);
  const socketUnit = runSystemctl(systemctl, declaration.socketUnit, [
    'ActiveState', 'UnitFileState', 'FragmentPath', 'DropInPaths', 'Listen',
  ], commandRunner);
  const mainPid = Number(service.MainPID);
  const execStartPath = systemdExecPath(service.ExecStart);
  if (service.ActiveState !== 'active'
      || !['running', 'start'].includes(service.SubState)
      || !Number.isSafeInteger(mainPid) || mainPid < 2
      || !safeAbsolute(execStartPath)
      || socketUnit.ActiveState !== 'active'
      || !String(socketUnit.Listen).includes(declaration.socketPath)) {
    throw new Error('approved research daemon service or socket is not active and exact');
  }
  const processExecutablePath = fs.readlinkSync(path.join(procRoot, String(mainPid), 'exe'));
  if (processExecutablePath !== execStartPath || processExecutablePath.endsWith(' (deleted)')) {
    throw new Error('approved research daemon active executable differs from ExecStart');
  }
  const ids = processIds(procRoot, mainPid);
  if (!fixtureOnly && (ids.uid !== 0 || ids.gid !== 0)) {
    throw new Error('approved research daemon process is not root-owned');
  }
  const cgroup = processCgroup(procRoot, mainPid);
  if (cgroup !== service.ControlGroup) {
    throw new Error('approved research daemon process and service cgroup differ');
  }
  const daemonArgv = processArgv(procRoot, mainPid);
  const configurationFile = argvOption(daemonArgv, ['--config-file'])
    || '/etc/docker/daemon.json';
  const configurationBytes = fs.readFileSync(configurationFile);
  const derivedTopology = deriveDaemonTopology(kind, daemonArgv, configurationBytes);

  const entries = new Map();
  observeObject(service.FragmentPath, 'service_unit', entries, { fixtureOnly });
  const dropInPaths = service.DropInPaths.trim()
    ? service.DropInPaths.trim().split(/\s+/).sort()
    : [];
  for (const dropIn of dropInPaths) {
    observeObject(dropIn, 'service_drop_in', entries, { fixtureOnly });
  }
  observeObject(socketUnit.FragmentPath, 'socket_unit', entries, { fixtureOnly });
  const socketDropInPaths = socketUnit.DropInPaths.trim()
    ? socketUnit.DropInPaths.trim().split(/\s+/).sort()
    : [];
  for (const dropIn of socketDropInPaths) {
    observeObject(dropIn, 'socket_drop_in', entries, { fixtureOnly });
  }
  observeObject(processExecutablePath, 'daemon_executable', entries, { fixtureOnly });
  for (const mapped of mappedFilePaths(procRoot, mainPid)) {
    observeObject(mapped, 'mapped_dependency', entries, { fixtureOnly });
  }
  observeObject(derivedTopology.configurationFile, 'configuration_file', entries, {
    fixtureOnly,
  });
  const configurationRoot = path.posix.dirname(derivedTopology.configurationFile);
  observeObject(configurationRoot, 'configuration_root', entries, {
    recursive: true,
    fixtureOnly,
  });
  observeObject(derivedTopology.seccompProfilePath, 'security_profile', entries, {
    fixtureOnly,
  });
  const rootfsRoot = service.RootDirectory || '/';
  observeObject(rootfsRoot, 'rootfs_root', entries, {
    recursive: rootfsRoot !== '/',
    fixtureOnly,
  });
  const runtimeHelperPaths = [...new Set([
    derivedTopology.defaultRuntimePath,
    derivedTopology.shimPath,
  ])].sort();
  for (const helper of runtimeHelperPaths) {
    observeObject(helper, 'runtime_helper', entries, { fixtureOnly });
  }
  const runtimeHelpers = runtimeHelperPaths.map((helper) => {
    const entry = entries.get(helper);
    const helperBytes = fs.readFileSync(helper);
    const helperErrors = staticLinuxX64ElfErrors(helperBytes);
    if (helperErrors.length > 0) {
      throw new Error(`approved research runtime helper is not self-contained: ${helper}`);
    }
    return {
      path: helper,
      bytes: entry.bytes,
      sha256: entry.sha256,
      linkage: 'static_elf_no_interpreter',
    };
  });
  const dataRoot = mutableDirectoryIdentity(derivedTopology.dataRoot, fixtureOnly);
  const execRoot = mutableDirectoryIdentity(derivedTopology.execRoot, fixtureOnly);
  const executionStore = {
    dataRoot: dataRoot.path,
    dataRootDevice: dataRoot.device,
    dataRootInode: dataRoot.inode,
    dataRootUid: dataRoot.uid,
    dataRootGid: dataRoot.gid,
    dataRootMode: dataRoot.mode,
    execRoot: execRoot.path,
    execRootDevice: execRoot.device,
    execRootInode: execRoot.inode,
    execRootUid: execRoot.uid,
    execRootGid: execRoot.gid,
    execRootMode: execRoot.mode,
    mutable: true,
    recursivelyHashed: false,
  };
  const auxiliaryProcesses = [];
  const auxiliarySocket = unixSocketRecord(procRoot, derivedTopology.containerdSocket);
  const owners = socketOwnerPids(procRoot, auxiliarySocket.inode)
    .filter((pid) => pid !== mainPid);
  if (owners.length !== 1) {
    throw new Error('approved containerd socket owner is absent or ambiguous');
  }
  observeObject(derivedTopology.containerdSocket, 'auxiliary_socket', entries, {
    fixtureOnly,
  });
  auxiliaryProcesses.push(auxiliaryProcessRecord(
    procRoot,
    owners[0],
    entries.get(derivedTopology.containerdSocket),
    entries,
    fixtureOnly,
  ));
  const roots = [
    { path: configurationRoot, role: 'configuration_root' },
    { path: rootfsRoot, role: 'rootfs_root' },
  ].sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role));
  observeObject(declaration.socketPath, 'daemon_socket', entries, { fixtureOnly });

  const socket = unixSocketRecord(procRoot, declaration.socketPath);
  const socketEntry = entries.get(declaration.socketPath);
  if (socket.type !== '0001'
      || socket.inode !== socketEntry.inode
      || !processOwnsSocket(procRoot, mainPid, socket.inode)) {
    throw new Error('approved research socket is not owned by the active service peer');
  }
  const executableEntry = entries.get(processExecutablePath);
  const closure = {
    schemaVersion: APPROVED_RESEARCH_DAEMON_CLOSURE_SCHEMA,
    kind,
    immutable: true,
    serviceUnit: declaration.serviceUnit,
    socketUnit: declaration.socketUnit,
    socketPath: declaration.socketPath,
    serviceManager: {
      activeState: service.ActiveState,
      subState: service.SubState,
      unitFileState: service.UnitFileState,
      mainPid,
      invocationId: service.InvocationID,
      controlGroup: service.ControlGroup,
      fragmentPath: service.FragmentPath,
      dropInPaths,
      execStartPath,
      execStart: service.ExecStart,
      rootDirectory: service.RootDirectory,
      rootImage: service.RootImage,
      socketActiveState: socketUnit.ActiveState,
      socketUnitFileState: socketUnit.UnitFileState,
      socketFragmentPath: socketUnit.FragmentPath,
      socketDropInPaths,
      socketListen: socketUnit.Listen,
    },
    process: {
      pid: mainPid,
      startTimeTicks: processStartTime(procRoot, mainPid),
      uid: ids.uid,
      gid: ids.gid,
      argv: daemonArgv,
      executablePath: processExecutablePath,
      executableDevice: executableEntry.device,
      executableInode: executableEntry.inode,
      executableBytes: executableEntry.bytes,
      executableSha256: executableEntry.sha256,
      cgroup,
      socketDevice: socketEntry.device,
      socketInode: socketEntry.inode,
    },
    derivedTopology,
    executionStore,
    auxiliaryProcesses,
    runtimeHelpers,
    securityProfiles: [
      observeAppArmorKernelProfile('docker-default', {
        policyRoot: appArmorPolicyRoot,
      }),
      {
        kind: 'seccomp',
        name: 'cortex-research',
        path: derivedTopology.seccompProfilePath,
        sha256: entries.get(derivedTopology.seccompProfilePath).sha256,
      },
    ],
    roots,
    entryCount: entries.size,
    entries: [...entries.values()].map((entry) => ({
      ...entry,
      roles: [...entry.roles].sort(),
    })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  closure.closureSha256 = closureDigest(closure);
  if (!validateDaemonClosure(closure, kind)) {
    throw new Error('observed approved research daemon closure is not canonical');
  }
  return closure;
}

export function assertApprovedResearchDaemonAtPath(binding, options = {}) {
  const structural = structuralValidation(binding);
  if (!structural.ok) {
    throw new Error(`invalid approved research runtime binding: ${structural.errors.join('; ')}`);
  }
  const observed = observeApprovedResearchDaemon({
    serviceUnit: binding.daemonClosure.serviceUnit,
    socketUnit: binding.daemonClosure.socketUnit,
    socketPath: binding.daemonClosure.socketPath,
  }, { ...options, kind: binding.kind });
  if (canonicalJson(observed) !== canonicalJson(binding.daemonClosure)
      || observed.closureSha256 !== binding.daemonClosureSha256) {
    throw new Error('approved research daemon live closure differs from the signed identity');
  }
  return observed;
}

export function validateApprovedResearchRuntimeBinding(binding, {
  observe = true,
  ...observationOptions
} = {}) {
  const validation = structuralValidation(binding);
  if (validation.ok && observe) {
    try {
      assertApprovedResearchDaemonAtPath(binding, observationOptions);
    } catch (error) {
      validation.errors.push(error.message);
      validation.ok = false;
    }
  }
  return validation;
}

function openTrustedDirectoryChain(absoluteDirectory) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('approved research runtime requires Linux descriptor-relative traversal');
  }
  const descriptors = [];
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  try {
    let current = fs.openSync('/', flags);
    descriptors.push(current);
    let traversed = '/';
    const rootStat = fs.fstatSync(current);
    if (!rootStat.isDirectory() || rootStat.uid !== 0 || rootStat.gid !== 0
        || (rootStat.mode & 0o7022) !== 0 || (rootStat.mode & 0o100) === 0) {
      throw new Error('approved research runtime filesystem root is not immutable root-owned material');
    }
    for (const component of absoluteDirectory.slice(1).split('/').filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${current}/${component}`, flags);
      descriptors.push(next);
      traversed = path.join(traversed, component);
      const stat = fs.fstatSync(next);
      if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0
          || (stat.mode & 0o7022) !== 0 || (stat.mode & 0o100) === 0) {
        throw new Error(
          `approved research runtime ancestor is not immutable root-owned material: ${traversed}`,
        );
      }
      current = next;
    }
    return { descriptors, rootDescriptor: current };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try { fs.closeSync(descriptor); } catch {}
    }
    throw error;
  }
}

export function openApprovedResearchRuntime(binding, observationOptions = {}) {
  const validation = structuralValidation(binding);
  if (!validation.ok) {
    throw new Error(`invalid approved research runtime binding: ${validation.errors.join('; ')}`);
  }
  const daemonObservation = assertApprovedResearchDaemonAtPath(binding, observationOptions);
  const chain = openTrustedDirectoryChain(binding.runtimeClosure.root);
  let descriptor = null;
  try {
    const opened = openApprovedResearchRuntimeClosureAtDescriptor(
      chain.rootDescriptor,
      binding.runtimeClosure,
    );
    descriptor = opened.descriptor;
    const { bytes } = opened;
    const elfErrors = staticLinuxX64ElfErrors(bytes);
    if (elfErrors.length > 0) throw new Error(elfErrors.join('; '));
    return {
      descriptor,
      requestedPath: binding.path,
      executedPath: `/proc/self/fd/${APPROVED_RESEARCH_RUNTIME_CHILD_FD}`,
      endpointArguments: binding.kind === 'docker'
        ? ['--host', `unix://${binding.daemonClosure.socketPath}`]
        : ['--url', `unix://${binding.daemonClosure.socketPath}`],
      daemonObservation,
      identity: {
        invoked: binding.path,
        resolvedPath: `/proc/self/fd/${APPROVED_RESEARCH_RUNTIME_CHILD_FD}`,
        bytes: binding.bytes,
        sha256: binding.sha256,
      },
    };
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    throw error;
  } finally {
    for (const opened of chain.descriptors.reverse()) fs.closeSync(opened);
  }
}

export function openApprovedResearchRuntimeClosureAtDescriptor(rootDescriptor, closure) {
  return openExactApprovedRuntimeEntrypoint({
    closure,
    entrypointPath: 'runtime',
    label: 'approved research runtime',
    rootDescriptor,
  });
}

export function assertApprovedResearchRuntimeAtPath(binding, options = {}) {
  const opened = openApprovedResearchRuntime(binding, options);
  fs.closeSync(opened.descriptor);
  return true;
}

export function buildApprovedResearchRuntimeBinding(executablePath, {
  kind,
  daemon,
  observationOptions = {},
} = {}) {
  const resolved = path.resolve(executablePath);
  const bytes = fs.readFileSync(resolved);
  const sha256 = sha256Bytes(bytes);
  const root = `${APPROVED_RESEARCH_RUNTIME_ROOT}/${sha256}`;
  if (resolved !== `${root}/runtime`) {
    throw new Error(`approved research runtime must be installed at ${root}/runtime`);
  }
  const elfErrors = staticLinuxX64ElfErrors(bytes);
  if (elfErrors.length > 0) throw new Error(elfErrors.join('; '));
  const runtimeClosure = {
    schemaVersion: APPROVED_RESEARCH_RUNTIME_CLOSURE_SCHEMA,
    platform: 'linux',
    architecture: 'x86_64',
    linkage: 'static_elf_no_interpreter',
    root,
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
        path: 'runtime',
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
  runtimeClosure.closureSha256 = closureDigest(runtimeClosure);
  const daemonClosure = observeApprovedResearchDaemon(daemon, {
    ...observationOptions,
    kind,
  });
  const binding = {
    schemaVersion: APPROVED_RESEARCH_RUNTIME_SCHEMA,
    kind,
    path: resolved,
    bytes: bytes.length,
    sha256,
    runtimeClosure,
    runtimeClosureSha256: runtimeClosure.closureSha256,
    daemonClosure,
    daemonClosureSha256: daemonClosure.closureSha256,
  };
  assertApprovedResearchRuntimeAtPath(binding, observationOptions);
  return binding;
}

export function approvedResearchRuntimeStdio(descriptor) {
  const stat = fs.fstatSync(descriptor);
  if (!stat.isFile()) throw new Error('approved research runtime descriptor is not a file');
  return ['ignore', 'pipe', 'pipe', 'ignore', descriptor];
}
