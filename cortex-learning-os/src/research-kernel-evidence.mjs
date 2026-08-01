import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { observeAppArmorKernelProfile } from './approved-research-runtime.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';

export const RESEARCH_KERNEL_EVIDENCE_SCHEMA =
  'cortex.learning_os.research_kernel_container_evidence.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]+$/;
const NAMESPACE = /^[a-z]+:\[[0-9]+\]$/;
const CAPABILITY_FIELDS = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'];
const MAX_LAYER_ENTRIES = 250_000;
const MAX_LAYER_BYTES = 64 * 1024 * 1024 * 1024;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function digestWithoutEvidenceSha256(value) {
  const unsigned = { ...value };
  delete unsigned.evidenceSha256;
  return sha256Text(canonicalJson(unsigned));
}

function decodeMountField(value) {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}

function parseStatus(bytes) {
  const result = {};
  for (const line of bytes.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return result;
}

function readStartTime(procRoot, pid) {
  const value = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
  const close = value.lastIndexOf(')');
  const fields = value.slice(close + 2).trim().split(/\s+/);
  if (!DECIMAL.test(String(fields[19] || ''))) {
    throw new Error('container init start time is unavailable');
  }
  return fields[19];
}

function readCgroup(procRoot, pid) {
  const rows = fs.readFileSync(path.join(procRoot, String(pid), 'cgroup'), 'utf8')
    .trim().split(/\r?\n/);
  const unified = rows.find((row) => row.startsWith('0::'));
  if (!unified || !unified.slice(3).startsWith('/')) {
    throw new Error('container init unified cgroup is unavailable');
  }
  return unified.slice(3);
}

function namespaceSet(procRoot, pid) {
  return Object.fromEntries(['cgroup', 'ipc', 'mnt', 'net', 'pid', 'user', 'uts'].map((name) => [
    name,
    fs.readlinkSync(path.join(procRoot, String(pid), 'ns', name)),
  ]));
}

function executableRecord(procRoot, pid) {
  const executableView = path.join(procRoot, String(pid), 'exe');
  const resolvedPath = fs.readlinkSync(executableView);
  if (!path.isAbsolute(resolvedPath) || resolvedPath.endsWith(' (deleted)')) {
    throw new Error('container execution references a deleted or ambiguous executable');
  }
  const descriptor = fs.openSync(
    executableView,
    fs.constants.O_RDONLY
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const stat = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    if (!stat.isFile() || stat.nlink < 1 || bytes.length !== stat.size) {
      throw new Error('container executable is not a stable regular file');
    }
    return {
      path: resolvedPath,
      device: String(stat.dev),
      inode: String(stat.ino),
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseMountInfo(procRoot, pid) {
  return fs.readFileSync(path.join(procRoot, String(pid), 'mountinfo'), 'utf8')
    .trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const fields = line.split(' ');
      const separator = fields.indexOf('-');
      if (separator < 6 || fields.length < separator + 4) {
        throw new Error('container mountinfo is malformed');
      }
      return {
        mountId: fields[0],
        parentId: fields[1],
        majorMinor: fields[2],
        root: decodeMountField(fields[3]),
        mountPoint: decodeMountField(fields[4]),
        options: fields[5].split(',').sort(),
        optionalFields: fields.slice(6, separator).sort(),
        fsType: fields[separator + 1],
        source: decodeMountField(fields[separator + 2]),
        superOptions: fields.slice(separator + 3).join(' ').split(',').sort(),
      };
    });
}

function mountRecord(mount) {
  return {
    mountId: mount.mountId,
    parentId: mount.parentId,
    majorMinor: mount.majorMinor,
    root: mount.root,
    mountPoint: mount.mountPoint,
    options: mount.options,
    optionalFields: mount.optionalFields,
    fsType: mount.fsType,
    source: mount.source,
    superOptionsSha256: sha256Text(canonicalJson(mount.superOptions)),
  };
}

function networkEvidence(procRoot, pid) {
  const devices = fs.readFileSync(path.join(procRoot, String(pid), 'net', 'dev'), 'utf8')
    .split(/\r?\n/).slice(2).map((line) => line.trim().split(':')[0]).filter(Boolean).sort();
  const routes = fs.readFileSync(path.join(procRoot, String(pid), 'net', 'route'), 'utf8')
    .split(/\r?\n/).slice(1).filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0] !== 'lo')
    .map((fields) => ({ interface: fields[0], destination: fields[1], gateway: fields[2] }));
  return { interfaces: devices, nonLoopbackIpv4Routes: routes };
}

function imageLayerTreeIdentity(layerPath) {
  const records = [];
  let totalBytes = 0;
  const walk = (target, relative) => {
    if (records.length >= MAX_LAYER_ENTRIES) {
      throw new Error('container image layer exceeds the recursive entry bound');
    }
    const stat = fs.lstatSync(target, { bigint: true });
    const base = {
      path: relative,
      uid: Number(stat.uid),
      gid: Number(stat.gid),
      mode: `0${(Number(stat.mode) & 0o7777).toString(8).padStart(3, '0')}`,
      linkCount: Number(stat.nlink),
    };
    if (stat.isDirectory()) {
      records.push({ ...base, type: 'directory' });
      for (const name of fs.readdirSync(target).sort()) {
        if (!name || name === '.' || name === '..' || name.includes('/')) {
          throw new Error('container image layer returned an unsafe entry');
        }
        walk(path.join(target, name), relative === '.' ? name : `${relative}/${name}`);
      }
      return;
    }
    if (stat.isSymbolicLink()) {
      records.push({ ...base, type: 'symlink', target: fs.readlinkSync(target) });
      return;
    }
    if (!stat.isFile() || stat.nlink < 1n) {
      throw new Error('container image layer contains an unsupported special object');
    }
    if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)
        || totalBytes + Number(stat.size) > MAX_LAYER_BYTES) {
      throw new Error('container image layer exceeds the recursive byte bound');
    }
    const descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
    );
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
        throw new Error('container image layer file changed while opened');
      }
      const bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor, { bigint: true });
      if (after.dev !== opened.dev || after.ino !== opened.ino
          || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
          || after.ctimeNs !== opened.ctimeNs || bytes.length !== Number(opened.size)) {
        throw new Error('container image layer file changed while hashed');
      }
      totalBytes += bytes.length;
      records.push({
        ...base,
        type: 'file',
        bytes: bytes.length,
        sha256: sha256Bytes(bytes),
      });
    } finally {
      fs.closeSync(descriptor);
    }
  };
  walk(layerPath, '.');
  return {
    entryCount: records.length,
    totalBytes,
    treeSha256: sha256Text(canonicalJson(records)),
  };
}

function imageLayerRecords(rootMount) {
  const lower = rootMount.superOptions.find((entry) => entry.startsWith('lowerdir='));
  if (!lower) throw new Error('container rootfs does not expose independently measurable layers');
  return lower.slice('lowerdir='.length).split(':').map((layerPath) => {
    if (!path.isAbsolute(layerPath)) throw new Error('container image layer path is unsafe');
    const stat = fs.lstatSync(layerPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('container image layer is not a regular directory');
    }
    return {
      path: layerPath,
      device: String(stat.dev),
      inode: String(stat.ino),
      uid: stat.uid,
      gid: stat.gid,
      mode: `0${(stat.mode & 0o7777).toString(8).padStart(3, '0')}`,
      ...imageLayerTreeIdentity(layerPath),
    };
  });
}

function helperChain(procRoot, initPid) {
  const records = [];
  const visited = new Set([initPid]);
  let current = initPid;
  for (let depth = 0; depth < 32; depth += 1) {
    const status = parseStatus(
      fs.readFileSync(path.join(procRoot, String(current), 'status'), 'utf8'),
    );
    const parent = Number(status.PPid);
    if (!Number.isSafeInteger(parent) || parent < 1 || visited.has(parent)) break;
    visited.add(parent);
    if (parent === 1) break;
    try {
      records.push({
        pid: parent,
        startTimeTicks: readStartTime(procRoot, parent),
        cgroup: readCgroup(procRoot, parent),
        executable: executableRecord(procRoot, parent),
      });
    } catch {
      break;
    }
    current = parent;
  }
  return records;
}

function findInitPid(procRoot, containerId) {
  const candidates = [];
  for (const name of fs.readdirSync(procRoot)) {
    if (!/^[1-9][0-9]*$/.test(name)) continue;
    try {
      const pid = Number(name);
      const cgroup = readCgroup(procRoot, pid);
      const status = parseStatus(fs.readFileSync(path.join(procRoot, name, 'status'), 'utf8'));
      const namespacePids = String(status.NSpid || '').split(/\s+/).filter(Boolean);
      if (cgroup.includes(containerId) && namespacePids.at(-1) === '1') candidates.push(pid);
    } catch {}
  }
  if (candidates.length !== 1) {
    throw new Error('exact container init process is absent or ambiguous in kernel evidence');
  }
  return candidates[0];
}

export function observeResearchKernelEvidence({
  containerId,
  workspace,
  procRoot = '/proc',
  cgroupRoot = '/sys/fs/cgroup',
  appArmorPolicyRoot = '/sys/kernel/security/apparmor/policy/profiles',
} = {}) {
  if (!CONTAINER_ID.test(String(containerId || '')) || !path.isAbsolute(workspace)) {
    throw new Error('kernel observation requires an exact container and workspace identity');
  }
  const pid = findInitPid(procRoot, containerId);
  const status = parseStatus(fs.readFileSync(path.join(procRoot, String(pid), 'status'), 'utf8'));
  const cgroupPath = readCgroup(procRoot, pid);
  const cgroupDirectory = path.join(cgroupRoot, ...cgroupPath.split('/').filter(Boolean));
  const mounts = parseMountInfo(procRoot, pid);
  const rootMount = mounts.find((entry) => entry.mountPoint === '/');
  const workspaceMount = mounts.find((entry) => entry.mountPoint === '/workspace');
  const temporaryMount = mounts.find((entry) => entry.mountPoint === '/tmp');
  if (!rootMount || !workspaceMount || !temporaryMount) {
    throw new Error('container root, workspace, or temporary mount is absent');
  }
  const workspaceHostStat = fs.lstatSync(workspace);
  const workspaceContainerStat = fs.lstatSync(
    path.join(procRoot, String(pid), 'root', 'workspace'),
  );
  const init = {
    pid,
    startTimeTicks: readStartTime(procRoot, pid),
    uid: Number(String(status.Uid || '').split(/\s+/)[0]),
    gid: Number(String(status.Gid || '').split(/\s+/)[0]),
    namespacePids: String(status.NSpid || '').split(/\s+/).filter(Boolean),
    cgroup: cgroupPath,
    executable: executableRecord(procRoot, pid),
  };
  const namespaces = namespaceSet(procRoot, pid);
  const hostNamespaces = namespaceSet(procRoot, 'self');
  const lsmProfile = fs.readFileSync(
    path.join(procRoot, String(pid), 'attr', 'current'),
    'utf8',
  ).trim();
  const layers = imageLayerRecords(rootMount);
  const evidence = {
    schemaVersion: RESEARCH_KERNEL_EVIDENCE_SCHEMA,
    observer: 'linux_procfs_cgroupfs_v1',
    containerId,
    observedAt: new Date().toISOString(),
    init,
    namespaces,
    hostNamespaces,
    security: {
      noNewPrivileges: status.NoNewPrivs === '1',
      seccompMode: Number(status.Seccomp),
      seccompFilters: Number(status.Seccomp_filters),
      capabilityHex: Object.fromEntries(CAPABILITY_FIELDS.map((field) => [
        field,
        String(status[field] || '').toLowerCase(),
      ])),
      lsmProfile,
      lsmPolicy: observeAppArmorKernelProfile('docker-default', {
        policyRoot: appArmorPolicyRoot,
      }),
    },
    cgroup: {
      path: cgroupPath,
      pidsMax: fs.readFileSync(path.join(cgroupDirectory, 'pids.max'), 'utf8').trim(),
    },
    network: networkEvidence(procRoot, pid),
    mounts: {
      root: mountRecord(rootMount),
      workspace: {
        ...mountRecord(workspaceMount),
        hostDevice: String(workspaceHostStat.dev),
        hostInode: String(workspaceHostStat.ino),
        containerDevice: String(workspaceContainerStat.dev),
        containerInode: String(workspaceContainerStat.ino),
      },
      temporary: mountRecord(temporaryMount),
    },
    rootfs: {
      fsType: rootMount.fsType,
      imageLayers: layers,
      contentSha256: sha256Text(canonicalJson(
        layers.map((layer) => layer.treeSha256),
      )),
      generationSha256: sha256Text(canonicalJson({
        root: mountRecord(rootMount),
        layers,
      })),
    },
    helpers: helperChain(procRoot, pid),
  };
  evidence.evidenceSha256 = digestWithoutEvidenceSha256(evidence);
  return evidence;
}

export async function waitForResearchKernelEvidence({
  containerIdPath,
  workspace,
  timeoutMs = 10_000,
  pollMs = 10,
  ...options
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const stat = fs.lstatSync(containerIdPath);
      const containerId = fs.readFileSync(containerIdPath, 'utf8').trim();
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
          || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0
          || !CONTAINER_ID.test(containerId)) {
        throw new Error('container id publication is unsafe');
      }
      return observeResearchKernelEvidence({ containerId, workspace, ...options });
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `independent live kernel container observation failed: ${lastError?.message || 'timeout'}`,
  );
}

export function validateResearchKernelEvidence(evidence, {
  containerId,
  workspace,
  expectedCommand = null,
  expectedLsmProfile = null,
  expectedLsmPolicy = null,
  expectedShimSha256 = null,
} = {}) {
  const errors = [];
  const namespaceKeys = ['cgroup', 'ipc', 'mnt', 'net', 'pid', 'user', 'uts'];
  const rootMount = evidence?.mounts?.root;
  const workspaceMount = evidence?.mounts?.workspace;
  const temporaryMount = evidence?.mounts?.temporary;
  const layerPaths = evidence?.rootfs?.imageLayers?.map((entry) => entry?.path) || [];
  if (!exactKeys(evidence, [
    'schemaVersion', 'observer', 'containerId', 'observedAt', 'init', 'namespaces',
    'hostNamespaces', 'security', 'cgroup', 'network', 'mounts', 'rootfs',
    'helpers', 'evidenceSha256',
  ])
      || evidence.schemaVersion !== RESEARCH_KERNEL_EVIDENCE_SCHEMA
      || evidence.observer !== 'linux_procfs_cgroupfs_v1'
      || evidence.containerId !== containerId
      || !CONTAINER_ID.test(String(evidence.containerId || ''))
      || !Number.isFinite(Date.parse(evidence.observedAt))
      || evidence.evidenceSha256 !== digestWithoutEvidenceSha256(evidence)
      || !exactKeys(evidence.init, [
        'pid', 'startTimeTicks', 'uid', 'gid', 'namespacePids', 'cgroup', 'executable',
      ])
      || !Number.isSafeInteger(evidence.init.pid) || evidence.init.pid < 2
      || !DECIMAL.test(String(evidence.init.startTimeTicks || ''))
      || evidence.init.uid !== 0 || evidence.init.gid !== 0
      || !Array.isArray(evidence.init.namespacePids)
      || evidence.init.namespacePids.at(-1) !== '1'
      || evidence.init.cgroup !== evidence.cgroup?.path
      || !exactKeys(evidence.init.executable, [
        'path', 'device', 'inode', 'bytes', 'sha256',
      ])
      || !path.isAbsolute(String(evidence.init.executable.path || ''))
      || !DECIMAL.test(String(evidence.init.executable.device || ''))
      || !DECIMAL.test(String(evidence.init.executable.inode || ''))
      || !Number.isSafeInteger(evidence.init.executable.bytes)
      || evidence.init.executable.bytes < 1
      || !DIGEST.test(String(evidence.init.executable.sha256 || ''))
      || typeof expectedCommand !== 'string'
      || expectedCommand.length < 1
      || path.posix.basename(evidence.init.executable.path)
        !== path.posix.basename(expectedCommand)) {
    errors.push('kernel container init identity is invalid');
  }
  if (!exactKeys(evidence?.namespaces, namespaceKeys)
      || !exactKeys(evidence?.hostNamespaces, namespaceKeys)
      || namespaceKeys.some((name) => !NAMESPACE.test(String(evidence.namespaces?.[name] || ''))
        || !NAMESPACE.test(String(evidence.hostNamespaces?.[name] || '')))
      || ['ipc', 'mnt', 'net', 'pid', 'uts'].some(
        (name) => evidence.namespaces?.[name] === evidence.hostNamespaces?.[name],
      )) {
    errors.push('kernel namespace isolation is incomplete');
  }
  if (!exactKeys(evidence?.security, [
    'noNewPrivileges', 'seccompMode', 'seccompFilters', 'capabilityHex', 'lsmProfile',
    'lsmPolicy',
  ])
      || evidence.security.noNewPrivileges !== true
      || evidence.security.seccompMode !== 2
      || !Number.isSafeInteger(evidence.security.seccompFilters)
      || evidence.security.seccompFilters < 1
      || !exactKeys(evidence.security.capabilityHex, CAPABILITY_FIELDS)
      || CAPABILITY_FIELDS.some(
        (field) => !/^0+$/.test(String(evidence.security.capabilityHex[field] || '')),
      )
      || typeof evidence.security.lsmProfile !== 'string'
      || evidence.security.lsmProfile !== `${expectedLsmProfile} (enforce)`
      || canonicalJson(evidence.security.lsmPolicy) !== canonicalJson(expectedLsmPolicy)) {
    errors.push('kernel capability, seccomp, no-new-privileges, or LSM state is unsafe');
  }
  if (!exactKeys(evidence?.cgroup, ['path', 'pidsMax'])
      || evidence.cgroup.pidsMax !== '256'
      || !evidence.cgroup.path.includes(containerId)) {
    errors.push('kernel cgroup identity or pids limit is invalid');
  }
  if (!exactKeys(evidence?.network, ['interfaces', 'nonLoopbackIpv4Routes'])
      || canonicalJson(evidence.network.interfaces) !== canonicalJson(['lo'])
      || !Array.isArray(evidence.network.nonLoopbackIpv4Routes)
      || evidence.network.nonLoopbackIpv4Routes.length !== 0) {
    errors.push('kernel network namespace is not offline');
  }
  if (!rootMount || rootMount.mountPoint !== '/' || !rootMount.options?.includes('ro')
      || !['overlay', 'fuse-overlayfs'].includes(rootMount.fsType)
      || !workspaceMount || workspaceMount.mountPoint !== '/workspace'
      || !workspaceMount.options?.includes('rw')
      || workspaceMount.hostDevice !== workspaceMount.containerDevice
      || workspaceMount.hostInode !== workspaceMount.containerInode
      || !temporaryMount || temporaryMount.mountPoint !== '/tmp'
      || !['tmpfs', 'ramfs'].includes(temporaryMount.fsType)
      || !temporaryMount.options?.includes('rw')
      || !temporaryMount.options?.includes('noexec')
      || !temporaryMount.options?.includes('nosuid')
      || !temporaryMount.options?.includes('nodev')) {
    errors.push('kernel mount isolation is incomplete');
  }
  if (!exactKeys(evidence?.rootfs, [
    'fsType', 'imageLayers', 'contentSha256', 'generationSha256',
  ])
      || evidence.rootfs.fsType !== rootMount?.fsType
      || !Array.isArray(evidence.rootfs.imageLayers)
      || evidence.rootfs.imageLayers.length < 1
      || new Set(layerPaths).size !== layerPaths.length
      || evidence.rootfs.imageLayers.some((entry) => (
        !exactKeys(entry, [
          'path', 'device', 'inode', 'uid', 'gid', 'mode',
          'entryCount', 'totalBytes', 'treeSha256',
        ])
        || !path.isAbsolute(String(entry.path || ''))
        || !DECIMAL.test(String(entry.device || ''))
        || !DECIMAL.test(String(entry.inode || ''))
        || entry.uid !== 0 || entry.gid !== 0
        || !/^[0-7]{4}$/.test(String(entry.mode || ''))
        || (Number.parseInt(entry.mode, 8) & 0o7222) !== 0
        || !Number.isSafeInteger(entry.entryCount) || entry.entryCount < 1
        || entry.entryCount > MAX_LAYER_ENTRIES
        || !Number.isSafeInteger(entry.totalBytes) || entry.totalBytes < 0
        || entry.totalBytes > MAX_LAYER_BYTES
        || !DIGEST.test(String(entry.treeSha256 || ''))
      ))
      || evidence.rootfs.contentSha256 !== sha256Text(canonicalJson(
        evidence.rootfs.imageLayers.map((layer) => layer.treeSha256),
      ))
      || evidence.rootfs.generationSha256 !== sha256Text(canonicalJson({
        root: rootMount,
        layers: evidence.rootfs.imageLayers,
      }))) {
    errors.push('kernel image-layer generation evidence is invalid');
  }
  if (!Array.isArray(evidence?.helpers) || evidence.helpers.length < 1
      || evidence.helpers.some((helper) => (
        !exactKeys(helper, ['pid', 'startTimeTicks', 'cgroup', 'executable'])
        || !Number.isSafeInteger(helper.pid) || helper.pid < 2
        || !DECIMAL.test(String(helper.startTimeTicks || ''))
        || !DIGEST.test(String(helper.executable?.sha256 || ''))
      ))
      || !DIGEST.test(String(expectedShimSha256 || ''))
      || evidence.helpers[0]?.executable?.sha256 !== expectedShimSha256) {
    errors.push('kernel shim/runtime helper chain is incomplete or unapproved');
  }
  if (workspaceMount && workspaceMount.mountPoint === '/workspace'
      && typeof workspace === 'string' && !path.isAbsolute(workspace)) {
    errors.push('kernel workspace binding is invalid');
  }
  return { ok: errors.length === 0, errors };
}
