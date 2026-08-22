import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { bindApprovedModelExecutable } from '../src/deployment-identity.mjs';
import { sha256Text } from '../src/hash.mjs';

function digest(value) {
  return sha256Text(canonicalJson(value));
}

export function cycle8KernelEvidence({
  binding,
  containerId,
  workspace,
  pid = 5252,
  observedAt = '2026-07-27T12:02:10.000Z',
} = {}) {
  const mount = (mountPoint, {
    fsType,
    options,
    source,
    mountId,
  }) => ({
    mountId,
    parentId: '1',
    majorMinor: '0:42',
    root: '/',
    mountPoint,
    options,
    optionalFields: [],
    fsType,
    source,
    superOptionsSha256: 'e'.repeat(64),
  });
  const rootMount = mount('/', {
    fsType: 'overlay',
    options: ['ro'],
    source: 'overlay',
    mountId: '101',
  });
  const layer = {
    path: `/var/lib/clos-research/overlay2/${containerId.slice(0, 16)}/diff`,
    device: '42',
    inode: '4200',
    uid: 0,
    gid: 0,
    mode: '0555',
    entryCount: 32,
    totalBytes: 16384,
    treeSha256: 'f'.repeat(64),
  };
  const evidence = {
    schemaVersion: 'cortex.learning_os.research_kernel_container_evidence.v1',
    observer: 'linux_procfs_cgroupfs_v1',
    containerId,
    observedAt,
    init: {
      pid,
      startTimeTicks: '987654',
      uid: 0,
      gid: 0,
      namespacePids: [String(pid), '1'],
      cgroup: `/system.slice/docker-${containerId}.scope`,
      executable: {
        path: '/usr/bin/node',
        device: '42',
        inode: '4300',
        bytes: 16384,
        sha256: 'd'.repeat(64),
      },
    },
    namespaces: {
      cgroup: 'cgroup:[2001]',
      ipc: 'ipc:[2002]',
      mnt: 'mnt:[2003]',
      net: 'net:[2004]',
      pid: 'pid:[2005]',
      user: 'user:[1006]',
      uts: 'uts:[2007]',
    },
    hostNamespaces: {
      cgroup: 'cgroup:[1001]',
      ipc: 'ipc:[1002]',
      mnt: 'mnt:[1003]',
      net: 'net:[1004]',
      pid: 'pid:[1005]',
      user: 'user:[1006]',
      uts: 'uts:[1007]',
    },
    security: {
      noNewPrivileges: true,
      seccompMode: 2,
      seccompFilters: 1,
      capabilityHex: {
        CapInh: '0000000000000000',
        CapPrm: '0000000000000000',
        CapEff: '0000000000000000',
        CapBnd: '0000000000000000',
        CapAmb: '0000000000000000',
      },
      lsmProfile: 'docker-default (enforce)',
      lsmPolicy: structuredClone(binding.daemonClosure.securityProfiles.find(
        (profile) => profile.kind === 'apparmor',
      )),
    },
    cgroup: {
      path: `/system.slice/docker-${containerId}.scope`,
      pidsMax: '256',
    },
    network: { interfaces: ['lo'], nonLoopbackIpv4Routes: [] },
    mounts: {
      root: rootMount,
      workspace: {
        ...mount('/workspace', {
          fsType: 'ext4',
          options: ['rw'],
          source: '/dev/root',
          mountId: '102',
        }),
        hostDevice: '42',
        hostInode: '4400',
        containerDevice: '42',
        containerInode: '4400',
      },
      temporary: mount('/tmp', {
        fsType: 'tmpfs',
        options: ['nodev', 'noexec', 'nosuid', 'rw'],
        source: 'tmpfs',
        mountId: '103',
      }),
    },
    rootfs: {
      fsType: 'overlay',
      imageLayers: [layer],
      contentSha256: digest([layer.treeSha256]),
      generationSha256: digest({ root: rootMount, layers: [layer] }),
    },
    helpers: [{
      pid: pid - 1,
      startTimeTicks: '987650',
      cgroup: `/system.slice/containerd-${containerId}.scope`,
      executable: {
        path: '/usr/bin/containerd-shim-runc-v2',
        device: '1',
        inode: '26',
        bytes: 8192,
        sha256: binding.daemonClosure.runtimeHelpers.find(
          (helper) => helper.path.endsWith('containerd-shim-runc-v2'),
        ).sha256,
      },
    }],
  };
  evidence.evidenceSha256 = digest(evidence);
  return evidence;
}

function directory(path, inode, roles = ['trusted_ancestor']) {
  return {
    path,
    roles,
    type: 'directory',
    uid: 0,
    gid: 0,
    mode: '0555',
    device: '1',
    inode: String(inode),
  };
}

function file(path, inode, roles, sha256, {
  bytes = 128,
  mode = '0444',
} = {}) {
  return {
    path,
    roles,
    type: 'file',
    uid: 0,
    gid: 0,
    mode,
    device: '1',
    inode: String(inode),
    bytes,
    sha256,
  };
}

export function cycle7ApprovedResearchRuntimeBinding({
  bytes = 234567,
  sha256 = '8'.repeat(64),
} = {}) {
  const root = `/opt/cortex-learning-os/approved-research-runtimes/${sha256}`;
  const generation = Number.parseInt(sha256[0], 16);
  const daemonPid = 4200 + generation;
  const auxiliaryPid = 4300 + generation;
  const daemonSocketInode = String(1300 + generation);
  const auxiliarySocketInode = String(2400 + generation);
  const runtimeClosure = {
    schemaVersion: 'cortex.learning_os.approved_research_runtime_closure.v1',
    platform: 'linux',
    architecture: 'x86_64',
    linkage: 'static_elf_no_interpreter',
    root,
    immutable: true,
    entryCount: 2,
    entries: [
      {
        path: '.', role: 'runtime_root', type: 'directory',
        uid: 0, gid: 0, mode: '0555',
      },
      {
        path: 'runtime', role: 'entrypoint', type: 'file',
        uid: 0, gid: 0, mode: '0555', bytes, sha256,
      },
    ],
  };
  runtimeClosure.closureSha256 = digest(runtimeClosure);
  const daemonExecutableSha256 = '1'.repeat(64);
  const containerdExecutableSha256 = '9'.repeat(64);
  const runcSha256 = 'b'.repeat(64);
  const shimSha256 = 'c'.repeat(64);
  const seccompSha256 = 'd'.repeat(64);
  const containerdConfigurationSha256 = '0'.repeat(64);
  const daemonConfiguration = {
    'data-root': '/var/lib/clos-research',
    'exec-root': '/run/clos-research',
    containerd: '/run/containerd/containerd.sock',
    'default-runtime': 'runc',
    'seccomp-profile': '/etc/clos-research/research-seccomp.json',
    runtimes: { runc: { path: '/usr/bin/runc' } },
  };
  const configurationBytes = Buffer.from(canonicalJson(daemonConfiguration));
  const configurationSha256 = sha256Text(configurationBytes);
  const entries = [
    directory('/', 1),
    directory('/etc', 2),
    directory('/etc/clos-research', 3, ['configuration_root', 'trusted_ancestor']),
    file(
      '/etc/clos-research/daemon.json',
      4,
      ['configuration_file', 'configuration_root'],
      configurationSha256,
      { bytes: configurationBytes.length },
    ),
    file(
      '/etc/clos-research/research-seccomp.json',
      29,
      ['configuration_root', 'security_profile'],
      seccompSha256,
    ),
    file(
      '/etc/clos-research/containerd.toml',
      30,
      ['auxiliary_configuration', 'configuration_root'],
      containerdConfigurationSha256,
    ),
    directory('/etc/systemd', 5),
    directory('/etc/systemd/system', 6),
    file(
      '/etc/systemd/system/docker.service',
      7,
      ['service_unit'],
      '3'.repeat(64),
    ),
    directory('/etc/systemd/system/docker.service.d', 21),
    file(
      '/etc/systemd/system/docker.service.d/10-cortex.conf',
      22,
      ['service_drop_in'],
      'a'.repeat(64),
    ),
    file(
      '/etc/systemd/system/docker.socket',
      8,
      ['socket_unit'],
      '4'.repeat(64),
    ),
    directory('/opt', 9),
    directory('/opt/clos-research-rootfs', 10, ['rootfs_root', 'trusted_ancestor']),
    file(
      '/opt/clos-research-rootfs/rootfs.index',
      11,
      ['rootfs_root'],
      '5'.repeat(64),
    ),
    directory('/run', 12),
    directory('/run/containerd', 23),
    {
      path: '/run/containerd/containerd.sock',
      roles: ['auxiliary_socket'],
      type: 'socket',
      uid: 0,
      gid: 0,
      mode: '0660',
      device: '1',
      inode: auxiliarySocketInode,
    },
    {
      path: '/run/docker.sock',
      roles: ['daemon_socket'],
      type: 'socket',
      uid: 0,
      gid: 0,
      mode: '0660',
      device: '1',
      inode: daemonSocketInode,
    },
    directory('/usr', 14),
    directory('/usr/bin', 15),
    file(
      '/usr/bin/containerd',
      25,
      ['auxiliary_executable', 'auxiliary_mapped_dependency'],
      containerdExecutableSha256,
      { bytes: 8192, mode: '0555' },
    ),
    file(
      '/usr/bin/containerd-shim-runc-v2',
      26,
      ['runtime_helper'],
      shimSha256,
      { bytes: 8192, mode: '0555' },
    ),
    file(
      '/usr/bin/dockerd',
      16,
      ['daemon_executable', 'mapped_dependency'],
      daemonExecutableSha256,
      { bytes: 4096, mode: '0555' },
    ),
    file(
      '/usr/bin/runc',
      27,
      ['runtime_helper'],
      runcSha256,
      { bytes: 8192, mode: '0555' },
    ),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const daemonClosure = {
    schemaVersion: 'cortex.learning_os.approved_research_daemon_closure.v3',
    kind: 'docker',
    immutable: true,
    serviceUnit: 'docker.service',
    socketUnit: 'docker.socket',
    socketPath: '/run/docker.sock',
    serviceManager: {
      activeState: 'active',
      subState: 'running',
      unitFileState: 'enabled',
      mainPid: daemonPid,
      invocationId: sha256[0].repeat(32),
      controlGroup: '/system.slice/docker.service',
      fragmentPath: '/etc/systemd/system/docker.service',
      dropInPaths: ['/etc/systemd/system/docker.service.d/10-cortex.conf'],
      execStartPath: '/usr/bin/dockerd',
      execStart: '{ path=/usr/bin/dockerd ; argv[]=/usr/bin/dockerd --config-file=/etc/clos-research/daemon.json ; }',
      rootDirectory: '/opt/clos-research-rootfs',
      rootImage: '',
      socketActiveState: 'active',
      socketUnitFileState: 'enabled',
      socketFragmentPath: '/etc/systemd/system/docker.socket',
      socketDropInPaths: [],
      socketListen: '/run/docker.sock (Stream)',
    },
    process: {
      pid: daemonPid,
      startTimeTicks: String(123456 + generation),
      uid: 0,
      gid: 0,
      argv: ['/usr/bin/dockerd', '--config-file=/etc/clos-research/daemon.json'],
      executablePath: '/usr/bin/dockerd',
      executableDevice: '1',
      executableInode: '16',
      executableBytes: 4096,
      executableSha256: daemonExecutableSha256,
      cgroup: '/system.slice/docker.service',
      socketDevice: '1',
      socketInode: daemonSocketInode,
    },
    derivedTopology: {
      configurationFile: '/etc/clos-research/daemon.json',
      configurationBytesBase64: configurationBytes.toString('base64'),
      configurationSha256,
      dataRoot: '/var/lib/clos-research',
      execRoot: '/run/clos-research',
      containerdSocket: '/run/containerd/containerd.sock',
      defaultRuntimeName: 'runc',
      defaultRuntimePath: '/usr/bin/runc',
      shimPath: '/usr/bin/containerd-shim-runc-v2',
      seccompProfilePath: '/etc/clos-research/research-seccomp.json',
    },
    executionStore: {
      dataRoot: '/var/lib/clos-research',
      dataRootDevice: '1',
      dataRootInode: '19',
      dataRootUid: 0,
      dataRootGid: 0,
      dataRootMode: '0700',
      execRoot: '/run/clos-research',
      execRootDevice: '1',
      execRootInode: '28',
      execRootUid: 0,
      execRootGid: 0,
      execRootMode: '0700',
      mutable: true,
      recursivelyHashed: false,
    },
    auxiliaryProcesses: [{
      pid: auxiliaryPid,
      startTimeTicks: String(123400 + generation),
      uid: 0,
      gid: 0,
      argv: [
        '/usr/bin/containerd',
        '--config',
        '/etc/clos-research/containerd.toml',
        '--address',
        '/run/containerd/containerd.sock',
      ],
      configurationFiles: [{
        path: '/etc/clos-research/containerd.toml',
        sha256: containerdConfigurationSha256,
      }],
      executablePath: '/usr/bin/containerd',
      executableBytes: 8192,
      executableSha256: containerdExecutableSha256,
      cgroup: '/system.slice/containerd.service',
      socketDevice: '1',
      socketInode: auxiliarySocketInode,
      mappedDependencySha256s: [containerdExecutableSha256],
    }],
    runtimeHelpers: [
      {
        path: '/usr/bin/containerd-shim-runc-v2',
        bytes: 8192,
        sha256: shimSha256,
        linkage: 'static_elf_no_interpreter',
      },
      {
        path: '/usr/bin/runc',
        bytes: 8192,
        sha256: runcSha256,
        linkage: 'static_elf_no_interpreter',
      },
    ],
    securityProfiles: [
      {
        kind: 'apparmor',
        name: 'docker-default',
        mode: 'enforce',
        kernelPath: '/sys/kernel/security/apparmor/policy/profiles/docker-default.1',
        kernelPolicySha256: 'b'.repeat(64),
        kernelRawPolicySha256: 'c'.repeat(64),
      },
      {
        kind: 'seccomp',
        name: 'cortex-research',
        path: '/etc/clos-research/research-seccomp.json',
        sha256: seccompSha256,
      },
    ],
    roots: [
      { path: '/etc/clos-research', role: 'configuration_root' },
      { path: '/opt/clos-research-rootfs', role: 'rootfs_root' },
    ],
    entryCount: entries.length,
    entries,
  };
  daemonClosure.closureSha256 = digest(daemonClosure);
  return {
    schemaVersion: 'cortex.learning_os.approved_research_runtime.v3',
    kind: 'docker',
    path: `${root}/runtime`,
    bytes,
    sha256,
    runtimeClosure,
    runtimeClosureSha256: runtimeClosure.closureSha256,
    daemonClosure,
    daemonClosureSha256: daemonClosure.closureSha256,
  };
}

export function cycle10QualificationDeployment(sourceDeployment) {
  const executableSha256 = '9'.repeat(64);
  const root = `/opt/cortex-learning-os/approved-model-executors/${executableSha256}`;
  const runtimeClosure = {
    schemaVersion: 'cortex.learning_os.approved_model_runtime_closure.v1',
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
        path: 'codex',
        role: 'entrypoint',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0555',
        bytes: 123456,
        sha256: executableSha256,
      },
    ],
  };
  runtimeClosure.closureSha256 = digest({
    schemaVersion: runtimeClosure.schemaVersion,
    platform: runtimeClosure.platform,
    architecture: runtimeClosure.architecture,
    linkage: runtimeClosure.linkage,
    root: runtimeClosure.root,
    immutable: runtimeClosure.immutable,
    entryCount: runtimeClosure.entryCount,
    entries: runtimeClosure.entries,
  });
  const immutableDeployment = structuredClone(sourceDeployment);
  immutableDeployment.executionClosure.immutable = true;
  immutableDeployment.executionClosure.checkoutSha256 = digest({
    files: immutableDeployment.executionClosure.files,
    entries: immutableDeployment.executionClosure.entries,
    immutable: true,
  });
  immutableDeployment.executionClosure.closureSha256 = digest({
    sourceCommit: immutableDeployment.executionClosure.sourceCommit,
    sourceTree: immutableDeployment.executionClosure.sourceTree,
    productTree: immutableDeployment.executionClosure.productTree,
    checkoutSha256: immutableDeployment.executionClosure.checkoutSha256,
    runtimeSha256: immutableDeployment.executionClosure.runtimeSha256,
  });
  immutableDeployment.closureSha256 = immutableDeployment.executionClosure.closureSha256;
  return bindApprovedModelExecutable(immutableDeployment, {
    schemaVersion: 'cortex.learning_os.approved_model_executable.v1',
    path: `${root}/codex`,
    bytes: 123456,
    sha256: executableSha256,
    runtimeClosure,
    runtimeClosureSha256: runtimeClosure.closureSha256,
  }, cycle7ApprovedResearchRuntimeBinding());
}
