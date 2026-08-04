import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  approvedExecutableStdio,
  APPROVED_MODEL_EXECUTABLE_ROOT,
  assertApprovedModelExecutableAtPath,
  validateApprovedModelExecutableBinding,
} from '../src/approved-model-executable.mjs';
import {
  APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  assertQualificationDeployment,
  bindApprovedModelExecutable,
  buildDeploymentBinding,
  deploymentBindingDigest,
  validateDeploymentBinding,
} from '../src/deployment-identity.mjs';
import {
  createExecutionEvidenceCore,
  executionSourceSha256,
  executionEvidenceSha256,
  observeExecutableIdentity,
} from '../src/execution-evidence.mjs';
import { durablyAdoptPublishedTree } from '../src/durable-tree-adoption.mjs';
import {
  assertGitBlobObjectIdentity,
  assertSafeProductSourceRelativePath,
  assertExecutionClosureAtRoot,
  assertExecutionClosureEntrySetAtRoot,
  buildWorkingTreeExecutionClosure,
  readExecutionClosureFileAtRoot,
  validateExecutionClosure,
} from '../src/git-product-source.mjs';
import {
  PHD_DETACHED_JOB_PLAN_SCHEMA,
  PHD_DETACHED_JOB_SCHEMA,
  verifyQualificationHarvestEvidence,
  verifyDetachedQualificationJobPlan,
} from '../src/phd-campaign.mjs';
import { validateProductionControlBundle } from '../src/phd-control-boundary.mjs';
import {
  materializeAuthenticatedQualificationJob,
  snapshotAuthenticatedQualificationPlan,
  verifyExistingQualificationJob,
  verifyQualificationLaunchPlan,
} from '../src/phd-qualification-launch.mjs';
import {
  assertRetentionResumeProcessIdentity,
  assertRetentionResumeRuntimeIdentity,
  assertRetentionServiceIdentity,
  buildRetentionWaitContract,
  installRetentionResumeTimer,
  persistRetentionWaitContract,
  processRetentionResumeTimerFiring,
  readRetentionProtectedJson,
  readRetentionProtectedSecret,
  reconcileRetentionResumeTimer,
  RETENTION_STATUS_SCHEMA,
  verifyRetentionTimerJournal,
  verifyRetentionStatusRecord,
  verifyRetentionWaitContract,
} from '../src/phd-retention.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import { sha256Bytes, sha256Text } from '../src/hash.mjs';
import { openLocalStateRootChain } from '../src/local-state-root-supervisor.mjs';
import {
  assertProcessRuntimeClosure,
  buildProcessRuntimeClosure,
  validateProcessRuntimeClosure,
} from '../src/process-runtime-closure.mjs';
import { initialRootAuthorityAvailable } from '../src/linux-root-authority.mjs';
import {
  validateTerminalArtifactMetadata,
} from '../src/validate-phd-worker-artifact.mjs';
import {
  cycle7ApprovedResearchRuntimeBinding,
} from './research-runtime-fixture.mjs';

const secret = 'phd-durable-operations-test-secret-00000000000000000';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const closRoot = path.dirname(testDirectory);
const concurrencyChild = path.join(testDirectory, 'helpers', 'phd-concurrency-child.mjs');
const terminalJournalRecoveryChild = path.join(
  testDirectory,
  'helpers',
  'phd-terminal-journal-recovery-child.mjs',
);
const mappedRootNamespaceAvailable = (() => {
  if (!fs.existsSync('/usr/bin/unshare')) return false;
  const probe = spawnSync('/usr/bin/unshare', [
    '--user',
    '--map-root-user',
    '/usr/bin/id',
    '-u',
  ], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return probe.status === 0 && probe.stdout.trim() === '0';
})();

function makeFifo(targetPath, mode = '0644') {
  const result = spawnSync('/usr/bin/mkfifo', [
    `--mode=${mode}`,
    targetPath,
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

async function waitForFixtureReady(child, readyPath, stderr) {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(readyPath)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`concurrency fixture exited before ready: ${stderr()}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`concurrency fixture did not become ready: ${stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function stopFixtureChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

function sign(payload, signingSecret = secret) {
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(signingSecret).slice(0, 16),
      digest: crypto.createHmac('sha256', signingSecret)
        .update(canonicalJson(payload))
        .digest('hex'),
    },
  };
}

function resign(record, signingSecret = secret) {
  const { controlPlaneSignature: _signature, ...payload } = record;
  return sign(payload, signingSecret);
}

function resignTimerJournal(record, signingSecret = secret) {
  const journal = structuredClone(record);
  const { controlPlaneSignature: _signature, ...base } = journal;
  for (let index = 0; index < journal.transitions.length; index += 1) {
    const transition = journal.transitions[index];
    if (index === 0) {
      transition.previousJournalDigest = null;
      continue;
    }
    const prefix = journal.transitions.slice(0, index);
    const predecessor = sign({
      ...base,
      phase: prefix.at(-1).phase,
      transitions: prefix,
    }, signingSecret);
    transition.previousJournalDigest = sha256Text(canonicalJson(predecessor));
    if (transition.phase === 'installed') {
      transition.evidence.pendingJournalDigest = transition.previousJournalDigest;
    }
  }
  return resign(journal, signingSecret);
}

function prePidTimerManagerIdentityDigest(inspection) {
  const service = structuredClone(inspection.service);
  const timer = structuredClone(inspection.timer);
  delete service.InvocationID;
  for (const field of [
    'ActiveState', 'SubState', 'ExecStart', 'ExecStartEx', 'ExecStartExDbus',
  ]) delete service[field];
  const calendarMatch = /OnCalendar=(.*?)\s*;\s*next_elapse=/.exec(
    timer.TimersCalendar,
  );
  assert.ok(calendarMatch);
  const calendarExpressions = [calendarMatch[1].trim()];
  for (const field of [
    'ActiveState', 'SubState', 'LastTriggerUSec', 'NextElapseUSecRealtime',
    'TimersCalendar',
  ]) delete timer[field];
  return sha256Text(canonicalJson({
    service,
    timer,
    calendarExpressions,
  }));
}

function downgradeDurableUnitObservation(observation, legacyVersion) {
  if (!Number.isInteger(legacyVersion)
      || legacyVersion < 3
      || legacyVersion > 8) {
    throw new Error('unsupported durable-unit observation fixture version');
  }
  delete observation.directory.mtimeNs;
  delete observation.directory.ctimeNs;
  delete observation.directory.birthtimeNs;
  if (legacyVersion < 8) {
    observation.accessBinding = {
      schemaVersion: 'cortex.learning_os.retention_durable_unit_access.v1',
      accessMode: observation.accessBinding.accessMode,
      bindPath: observation.accessBinding.bindPath,
      rootDirectory: observation.accessBinding.rootDirectory,
      runtimeClosureSha256: observation.accessBinding.runtimeClosureSha256,
      serviceUid: observation.accessBinding.serviceUid,
    };
  }
  if (legacyVersion < 7) {
    delete observation.directory.mountId;
    delete observation.service.mountId;
    delete observation.timer.mountId;
  }
  if (legacyVersion < 6) delete observation.accessBinding;
  if (legacyVersion === 3) {
    delete observation.dropIns;
  } else if (legacyVersion === 4) {
    observation.dropIns = {
      servicePath: `${observation.service.path}.d`,
      serviceAbsent: true,
      timerPath: `${observation.timer.path}.d`,
      timerAbsent: true,
    };
  }
  observation.schemaVersion
    = `cortex.learning_os.retention_durable_unit_observation.v${legacyVersion}`;
  const {
    observationDigest: _observationDigest,
    ...observationPayload
  } = observation;
  observation.observationDigest = sha256Text(canonicalJson(observationPayload));
  return observation;
}

function bindInstalledContractToDurableObservation(
  installed,
  journal,
  observation,
) {
  const contract = structuredClone(installed.contract);
  contract.timerInstallationReceipt.durableUnitObservationDigest
    = observation.observationDigest;
  const signedContract = resign(contract);
  const installedTransition = journal.transitions.find(
    (transition) => transition.phase === 'installed',
  );
  installedTransition.evidence.durableUnitObservationDigest
    = observation.observationDigest;
  installedTransition.evidence.installationReceipt
    = structuredClone(signedContract.timerInstallationReceipt);
  installedTransition.evidence.installedWaitDigest
    = sha256Text(canonicalJson(signedContract));
  return signedContract;
}

function legacyTimerManagerIdentityDigest(inspection) {
  const service = structuredClone(inspection.service);
  const timer = structuredClone(inspection.timer);
  delete service.InvocationID;
  delete service.MainPID;
  delete service.ControlPID;
  delete timer.InvocationID;
  for (const field of [
    'ActiveState', 'SubState', 'ExecStart', 'ExecStartEx', 'ExecStartExDbus',
  ]) delete service[field];
  const calendarExpressions = [];
  let remainder = String(timer.TimersCalendar || '').trim();
  while (remainder !== '') {
    const match = /^\{\s*OnCalendar=(.*?)\s*;\s*next_elapse=.*?\s*\}(?:\s+|$)/.exec(
      remainder,
    );
    if (!match || match[1].trim() === '') {
      throw new Error('legacy timer inspection calendar fixture is invalid');
    }
    calendarExpressions.push(match[1].trim());
    remainder = remainder.slice(match[0].length);
  }
  for (const field of [
    'ActiveState', 'SubState', 'LastTriggerUSec', 'NextElapseUSecRealtime',
    'TimersCalendar',
  ]) delete timer[field];
  return sha256Text(canonicalJson({
    service,
    timer,
    calendarExpressions,
  }));
}

function digest(record) {
  return sha256Text(canonicalJson(record));
}

function approvedExecutableBinding({
  bytes = 123456,
  sha256 = '9'.repeat(64),
} = {}) {
  const root = `${APPROVED_MODEL_EXECUTABLE_ROOT}/${sha256}`;
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
        bytes,
        sha256,
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
  return {
    schemaVersion: 'cortex.learning_os.approved_model_executable.v1',
    path: `${root}/codex`,
    bytes,
    sha256,
    runtimeClosure,
    runtimeClosureSha256: runtimeClosure.closureSha256,
  };
}

function approvedResearchRuntimeBinding({
  bytes = 234567,
  sha256 = '8'.repeat(64),
} = {}) {
  return cycle7ApprovedResearchRuntimeBinding({ bytes, sha256 });
}

function signedWaitingStatus({ evaluatedAt, nextEligibleAt }) {
  return sign({
    schemaVersion: RETENTION_STATUS_SCHEMA,
    subjectId: 'durable-candidate',
    evaluatedAt,
    fixtureOnly: true,
    campaignBinding: null,
    status: 'not_eligible_yet',
    completedWindowCount: 1,
    requiredWindowCount: 2,
    windowEvidenceDigests: ['c'.repeat(64)],
    executionAttestationDigests: ['d'.repeat(64)],
    executionEvidenceRecords: [null],
    authenticatedWindowIntervals: [{
      startedAt: evaluatedAt,
      completedAt: evaluatedAt,
      notBefore: evaluatedAt,
      expiresAt: nextEligibleAt,
    }],
    nextEligibleAt,
    errors: [],
    deploymentDigest: 'a'.repeat(64),
    acquisitionStateDigest: 'b'.repeat(64),
    retainedMasteryQualified: false,
    truthBoundary: 'Acquisition and elapsed time do not imply retention.',
  });
}

test('retention status verification recomputes terminal semantics instead of trusting signed labels', () => {
  const now = '2026-07-28T01:00:00.000Z';
  const next = '2026-07-28T02:00:00.000Z';
  const waiting = signedWaitingStatus({ evaluatedAt: now, nextEligibleAt: next });
  assert.equal(verifyRetentionStatusRecord(waiting, secret), true);

  const forgedZeroWindow = resign({
    ...waiting,
    fixtureOnly: false,
    campaignBinding: {
      campaignId: 'durable-production-campaign',
      campaignDigest: 'e'.repeat(64),
    },
    status: 'retained_mastery_qualified',
    completedWindowCount: 0,
    windowEvidenceDigests: [],
    executionAttestationDigests: [],
    executionEvidenceRecords: [],
    authenticatedWindowIntervals: [],
    nextEligibleAt: null,
    retainedMasteryQualified: true,
    truthBoundary: 'Only the declared signed two-window retention contract is qualified; this does not establish unrestricted mastery or a degree.',
  });
  assert.equal(verifyRetentionStatusRecord(forgedZeroWindow, secret), false);

  const compressedProduction = resign({
    ...forgedZeroWindow,
    completedWindowCount: 2,
    windowEvidenceDigests: ['1'.repeat(64), '2'.repeat(64)],
    executionAttestationDigests: ['3'.repeat(64), '4'.repeat(64)],
    executionEvidenceRecords: [null, null],
    authenticatedWindowIntervals: [
      {
        startedAt: '2026-07-20T00:00:00.000Z',
        completedAt: '2026-07-20T01:00:00.000Z',
        notBefore: '2026-07-20T00:00:00.000Z',
        expiresAt: '2026-07-20T02:00:00.000Z',
      },
      {
        startedAt: '2026-07-21T01:00:00.000Z',
        completedAt: '2026-07-21T02:00:00.000Z',
        notBefore: '2026-07-21T01:00:00.000Z',
        expiresAt: '2026-07-21T03:00:00.000Z',
      },
    ],
  });
  assert.equal(verifyRetentionStatusRecord(compressedProduction, secret), false);
});

function persistedWait(root, {
  createdAt = '2026-07-28T10:00:00.000Z',
  resumeAt = '2026-07-28T11:00:00.000Z',
} = {}) {
  const waitPath = path.join(root, 'retention-wait.json');
  const releasePath = path.join(root, 'retention-release.json');
  const status = signedWaitingStatus({ evaluatedAt: createdAt, nextEligibleAt: resumeAt });
  const wait = buildRetentionWaitContract({
    status,
    statePath: waitPath,
    notifierPath: path.join(root, 'notifier.py'),
    resumeBundlePath: path.join(root, 'resume-bundle.json'),
    releasePath,
    qualificationSecretPath: path.join(root, 'qualification.hmac'),
    createdAt,
    signingSecret: secret,
  });
  return {
    status,
    waitPath,
    persisted: persistRetentionWaitContract({
      contract: wait,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    }),
    releasePath,
  };
}

function fakeSystemdExecRecord({
  argv,
  commandPath,
  extended = false,
  flags = '',
  ignoreErrors = 'no',
}) {
  return [
    `{ path=${commandPath}`,
    `argv[]=${argv.join(' ')}`,
    extended ? `flags=${flags}` : `ignore_errors=${ignoreErrors}`,
    'start_time=[n/a]',
    'stop_time=[n/a]',
    'pid=0',
    'code=(null)',
    'status=0/0 }',
  ].join(' ; ');
}

function fakeTimerRuntime(contract, {
  installed = true,
  mismatch = null,
  fired = false,
  activationState = null,
  failEnableAfterEffectOnce = false,
  fireOnEnable = false,
} = {}) {
  let present = activationState === null ? installed : activationState !== 'absent';
  let partialActivation = ['loaded-disabled', 'enabled-inactive'].includes(activationState)
    ? activationState
    : null;
  let hasFired = fired;
  let firedAt = contract.resumeAt;
  let installCalls = 0;
  let daemonReloadCalls = 0;
  let enableFailuresRemaining = failEnableAfterEffectOnce ? 1 : 0;
  let shouldFireOnEnable = fireOnEnable;
  let activationGeneration = installed ? 1 : 0;
  let serviceInvocationGeneration = 1;
  let serviceMainPid = process.pid;
  let serviceLifecycle = fired ? 'running' : 'inactive';
  let retryResetCalls = 0;
  let retryStartCalls = 0;
  const invocationId = (kind) => sha256Text(
    `${kind}:${contract.subjectId}:${
      kind === 'service' ? serviceInvocationGeneration : activationGeneration
    }`,
  ).slice(0, 32);
  const specDigest = sha256Text(canonicalJson({
    schemaVersion: 'cortex.learning_os.retention_timer_identity.v1',
    subjectId: contract.subjectId,
    sourceStatusDigest: contract.sourceStatusDigest,
    sourceStatusSignature: contract.sourceStatusSignature,
    campaignBinding: contract.campaignBinding,
    deploymentDigest: contract.deploymentDigest,
    acquisitionStateDigest: contract.acquisitionStateDigest,
    nextWindowIndex: contract.nextWindowIndex,
    previousWindowDigest: contract.previousWindowDigest,
    dueTaskDigest: contract.dueTaskDigest,
    resumeAt: contract.resumeAt,
    waitPath: contract.waitPath,
    timerJournalPath: contract.timerJournalPath,
    releasePath: contract.releasePath,
    resumeCommand: contract.resumeCommand,
    resumeExecution: contract.resumeExecution,
    privilegedTimerBroker: contract.privilegedTimerBroker,
    stateRootIdentity: contract.stateRootIdentity,
  }));
  const unitBase = [
    'clos-retention',
    contract.subjectId.replace(/[^A-Za-z0-9-]/g, '-'),
    specDigest.slice(0, 16),
  ].join('-');
  const unitDirectory = path.join(
    contract.stateRootIdentity.path,
    '.retention-systemd-units',
  );
  const resumeTimestamp = new Date(contract.resumeAt).toISOString();
  const [calendarDate, calendarTime] = resumeTimestamp.slice(0, -1).split('T');
  const calendarExpression = calendarTime.endsWith('.000')
    ? `${calendarDate} ${calendarTime.slice(0, -4)} UTC`
    : `${calendarDate} ${calendarTime}000 UTC`;
  const effectiveExecStart = () => {
    const observedPath = mismatch === 'exec-path'
      ? '/bin/false'
      : contract.resumeCommand[0];
    const observedArgv = mismatch === 'exec'
      ? ['/bin/false']
      : (mismatch === 'exec-argv0'
        ? ['/bin/false', ...contract.resumeCommand.slice(1)]
        : (mismatch === 'exec-token-boundary'
          ? [
            contract.resumeCommand[0],
            `${contract.resumeCommand[1]} ${contract.resumeCommand[2]}`,
            ...contract.resumeCommand.slice(3),
          ]
          : contract.resumeCommand));
    const flags = {
      'exec-ignore-errors': 'ignore-failure',
      'exec-privileged': 'privileged',
      'exec-no-setuid': 'no-setuid',
      'exec-ambient': 'ambient',
      'exec-no-env-expand': 'no-env-expand',
    }[mismatch];
    return {
      argv: observedArgv,
      flags: flags === undefined ? [] : [flags],
      path: observedPath,
    };
  };
  const serviceObjectPath = `/org/freedesktop/systemd1/unit/${
    [...`${unitBase}.service`].map((character) => (
      /^[A-Za-z0-9]$/.test(character)
        ? character
        : `_${character.charCodeAt(0).toString(16).padStart(2, '0')}`
    )).join('')
  }`;
  const commandRunner = (command, argv) => {
    if (command === '/fake/busctl') {
      assert.deepEqual(argv, [
        '--json=short',
        'get-property',
        'org.freedesktop.systemd1',
        serviceObjectPath,
        'org.freedesktop.systemd1.Service',
        'ExecStartEx',
      ]);
      const effective = effectiveExecStart();
      const record = [
        effective.path,
        effective.argv,
        effective.flags,
        0, 0, 0, 0, 0, 0, 0,
      ];
      const records = mismatch === 'exec-appended'
        ? [record, ['/bin/false', ['/bin/false'], [], 0, 0, 0, 0, 0, 0, 0]]
        : [mismatch === 'exec-unparsed' ? [...record, 'hostile'] : record];
      return {
        status: 0,
        stdout: `${JSON.stringify({
          type: 'a(sasasttttuii)',
          data: records,
        })}\n`,
        stderr: '',
      };
    }
    assert.equal(command, '/fake/systemctl');
    if (argv[0] === 'daemon-reload') {
      daemonReloadCalls += 1;
      if (!present) {
        present = true;
        partialActivation = 'loaded-disabled';
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'enable') {
      assert.deepEqual(argv, [
        'enable',
        '--now',
        `${unitBase}.timer`,
      ]);
      installCalls += 1;
      present = true;
      activationGeneration += 1;
      if (enableFailuresRemaining > 0) {
        enableFailuresRemaining -= 1;
        partialActivation = 'enabled-inactive';
        return { status: 1, stdout: '', stderr: 'injected enable interruption' };
      }
      partialActivation = null;
      if (shouldFireOnEnable) {
        hasFired = true;
        serviceLifecycle = 'running';
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'reset-failed') {
      assert.deepEqual(argv, ['reset-failed', `${unitBase}.service`]);
      retryResetCalls += 1;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'start') {
      assert.deepEqual(argv, ['start', '--no-block', `${unitBase}.service`]);
      assert.equal(hasFired, true);
      retryStartCalls += 1;
      serviceInvocationGeneration += 1;
      serviceMainPid += 1;
      serviceLifecycle = 'running';
      return { status: 0, stdout: '', stderr: '' };
    }
    assert.equal(argv[0], 'show');
    const unit = argv[1];
    if (!present) {
      return { status: 0, stdout: `Id=${unit}\nLoadState=not-found\n`, stderr: '' };
    }
    const base = unit.replace(/[.](?:service|timer)$/, '');
    if (unit.endsWith('.service')) {
      const effective = effectiveExecStart();
      const execFlags = effective.flags[0] || '';
      const legacyExecStart = fakeSystemdExecRecord({
        argv: effective.argv,
        commandPath: effective.path,
        ignoreErrors: mismatch === 'exec-ignore-errors' ? 'yes' : 'no',
      });
      const extendedExecStart = fakeSystemdExecRecord({
        argv: effective.argv,
        commandPath: effective.path,
        extended: true,
        flags: execFlags,
      });
      const appendedLegacyExecStart = mismatch === 'exec-appended'
        ? `${legacyExecStart} ${fakeSystemdExecRecord({
          argv: ['/bin/false'],
          commandPath: '/bin/false',
        })}`
        : legacyExecStart;
      const appendedExtendedExecStart = mismatch === 'exec-appended'
        ? `${extendedExecStart} ${fakeSystemdExecRecord({
          argv: ['/bin/false'],
          commandPath: '/bin/false',
          extended: true,
        })}`
        : (mismatch === 'exec-unparsed'
          ? extendedExecStart.replace(
            ' ; start_time=',
            ' ; hostile_option=yes ; start_time=',
          )
          : extendedExecStart);
      const prematureService = mismatch === 'premature-service';
      const serviceRunning = serviceLifecycle === 'running' || prematureService;
      return {
        status: 0,
        stdout: [
          `Id=${mismatch === 'service-unit' ? 'wrong.service' : `${base}.service`}`,
          `InvocationID=${serviceRunning ? invocationId('service') : ''}`,
          'LoadState=loaded',
          'Transient=no',
          `Description=Cortex Learning OS retention resume ${specDigest}`,
          'Type=oneshot',
          `MainPID=${serviceRunning ? serviceMainPid : 0}`,
          'ControlPID=0',
          `Restart=${mismatch === 'restart' ? 'no' : 'on-failure'}`,
          'RestartUSec=5s',
          `CollectMode=${mismatch === 'collect-mode' ? 'inactive-or-failed' : 'inactive'}`,
          `User=${contract.stateRootIdentity.serviceUid}`,
          `Group=${contract.stateRootIdentity.serviceGid}`,
          `SupplementaryGroups=${contract.stateRootIdentity.serviceGid}`,
          'UMask=0077',
          'NoNewPrivileges=yes',
          'PrivateTmp=yes',
          'ProtectSystem=strict',
          `RootDirectory=${mismatch === 'root-directory' ? '/host' : ''}`,
          `MountAPIVFS=${mismatch === 'mount-api-vfs' ? 'yes' : 'no'}`,
          `BindReadOnlyPaths=${mismatch === 'bind-read-only' ? '/host' : ''}`,
          `BindPaths=${mismatch === 'bind-read-write' ? '/host' : ''}`,
          `ReadWritePaths=${contract.stateRootIdentity.path}`,
          'CapabilityBoundingSet=',
          `FragmentPath=${path.join(unitDirectory, `${base}.service`)}`,
          'UnitFileState=static',
          `DropInPaths=${mismatch === 'service-drop-in' ? '/etc/systemd/system/hostile.conf' : ''}`,
          `NeedDaemonReload=${mismatch === 'service-daemon-reload-needed' ? 'yes' : 'no'}`,
          `ExecCondition=${mismatch === 'exec-condition' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `ExecStartPre=${mismatch === 'exec-start-pre' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `ExecStartPost=${mismatch === 'exec-start-post' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `ExecReload=${mismatch === 'exec-reload' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `ExecStop=${mismatch === 'exec-stop' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `ExecStopPost=${mismatch === 'exec-stop-post' ? '{ path=/bin/false ; argv[]=/bin/false ; ignore_errors=no ; }' : ''}`,
          `EnvironmentFiles=${mismatch === 'environment-files' ? '/etc/hostile.env (ignore_errors=no)' : ''}`,
          `PassEnvironment=${mismatch === 'pass-environment' ? 'HOSTILE' : ''}`,
          `UnsetEnvironment=${mismatch === 'unset-environment'
            ? 'CLOS_RETENTION_TIMER_SPEC_SHA256'
            : 'BASH_ENV ENV LD_AUDIT LD_LIBRARY_PATH LD_PRELOAD NODE_OPTIONS NODE_PATH PYTHONPATH'}`,
          `ExecStart=${appendedLegacyExecStart}`,
          `ExecStartEx=${appendedExtendedExecStart}`,
          `Environment=CLOS_RETENTION_TIMER_SPEC_SHA256=${
            mismatch === 'environment' ? '0'.repeat(64) : specDigest
          } LANG=C LC_ALL=C PATH=/usr/bin:/bin TZ=UTC`,
          `ActiveState=${serviceRunning ? 'active' : 'inactive'}`,
          `SubState=${serviceRunning ? 'running' : 'dead'}`,
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    return {
      status: 0,
      stdout: [
        `Id=${mismatch === 'timer-unit' ? 'wrong.timer' : `${base}.timer`}`,
        `InvocationID=${invocationId('timer')}`,
        'LoadState=loaded',
        'Transient=no',
        `Description=Cortex Learning OS retention timer ${specDigest}`,
        `Unit=${base}.service`,
        `ActiveState=${partialActivation === null ? 'active' : 'inactive'}`,
        `SubState=${partialActivation === null ? (hasFired ? 'elapsed' : 'waiting') : 'dead'}`,
        'AccuracyUSec=1s',
        `Persistent=${mismatch === 'persistent' ? 'no' : 'yes'}`,
        `CollectMode=${mismatch === 'collect-mode' ? 'inactive-or-failed' : 'inactive'}`,
        `FragmentPath=${path.join(unitDirectory, `${base}.timer`)}`,
        `DropInPaths=${mismatch === 'timer-drop-in' ? '/etc/systemd/system/hostile.conf' : ''}`,
        `NeedDaemonReload=${mismatch === 'timer-daemon-reload-needed' ? 'yes' : 'no'}`,
        `UnitFileState=${partialActivation === 'loaded-disabled' ? 'disabled' : 'enabled'}`,
        `TimersCalendar={ OnCalendar=${
          ['calendar', 'calendar-after-due'].includes(mismatch)
            ? '2026-07-28 10:30:00 UTC'
            : calendarExpression
        } ; next_elapse=${
          partialActivation !== null || hasFired ? 'n/a' : contract.resumeAt
        } }`,
        `TimersMonotonic=${
          mismatch === 'monotonic-trigger'
            ? '{ OnBootUSec=5min ; next_elapse=5min }'
            : ''
        }`,
        `NextElapseUSecMonotonic=${mismatch === 'monotonic-trigger' ? '5min' : '0'}`,
        `OnClockChange=${mismatch === 'clock-change' ? 'yes' : 'no'}`,
        `OnTimezoneChange=${mismatch === 'timezone-change' ? 'yes' : 'no'}`,
        `RandomizedDelayUSec=${mismatch === 'random-delay' ? '5min' : '0'}`,
        `FixedRandomDelay=${mismatch === 'fixed-random-delay' ? 'yes' : 'no'}`,
        `WakeSystem=${mismatch === 'wake-system' ? 'yes' : 'no'}`,
        `RemainAfterElapse=${mismatch === 'remain-after-elapse' ? 'no' : 'yes'}`,
        `NextElapseUSecRealtime=${
          mismatch === 'calendar'
            ? '2026-07-28T10:30:00.000Z'
            : (partialActivation !== null || hasFired ? 'n/a' : contract.resumeAt)
        }`,
        `LastTriggerUSec=${
          mismatch === 'last-trigger'
            ? contract.resumeAt
            : (partialActivation === null && hasFired ? firedAt : 'n/a')
        }`,
        '',
      ].join('\n'),
      stderr: '',
    };
  };
  return {
    commandRunner,
    activationState: () => {
      if (!present) return 'absent';
      if (partialActivation !== null) return partialActivation;
      return hasFired ? 'fired' : 'active-waiting';
    },
    daemonReloadCalls: () => daemonReloadCalls,
    installCalls: () => installCalls,
    retryResetCalls: () => retryResetCalls,
    retryStartCalls: () => retryStartCalls,
    fire: (value = contract.resumeAt) => {
      hasFired = true;
      firedAt = value;
      partialActivation = null;
      serviceLifecycle = 'running';
    },
    cleanExit: () => {
      assert.equal(hasFired, true);
      serviceLifecycle = 'inactive';
    },
    reboot: () => {
      assert.equal(hasFired, true);
      activationGeneration += 1;
      serviceInvocationGeneration += 1;
      serviceMainPid += 1;
      serviceLifecycle = 'inactive';
    },
    remove: () => {
      present = false;
      partialActivation = null;
    },
    rotateManagerGeneration: () => {
      activationGeneration += 1;
    },
    rotateServiceInvocation: () => {
      serviceInvocationGeneration += 1;
      serviceMainPid += 1;
    },
    serviceInvocationId: () => invocationId('service'),
    serviceMainPid: () => serviceMainPid,
    timerInvocationId: () => invocationId('timer'),
    managerGeneration: () => activationGeneration,
    restoreManagerGeneration: (value) => {
      assert.equal(Number.isSafeInteger(value) && value >= 0, true);
      activationGeneration = value;
    },
    setActivationState: (value) => {
      assert.ok(['absent', 'loaded-disabled', 'enabled-inactive'].includes(value));
      present = value !== 'absent';
      partialActivation = value === 'absent' ? null : value;
      hasFired = false;
      serviceLifecycle = 'inactive';
    },
    setFireOnEnable: (value) => {
      shouldFireOnEnable = value === true;
    },
    specDigest,
    unitBase,
  };
}

function fakeRetentionIdentityRuntime({
  uid = 991,
  gid = 991,
  group = 'cortex-retention',
  explicitMembers = [],
  otherPrimaryUser = false,
  unrelatedAccount = false,
  duplicateUidDifferentGid = false,
  duplicateGroupName = false,
  duplicateGroupGid = false,
  supplementaryGroup = false,
  passwdSources = 'files',
  groupSources = 'files',
  initgroupsSources = null,
  sourceFailure = null,
  unsafeSource = null,
} = {}) {
  const rootPasswdLine = 'root:x:0:0:root:/root:/bin/sh';
  const passwdLine = `cortex-retention:x:${uid}:${gid}:Retention Service:/nonexistent:/usr/sbin/nologin`;
  const otherLine = `retention-intruder:x:1991:${gid}:Intruder:/nonexistent:/usr/sbin/nologin`;
  const unrelatedLine = 'unrelated-local:x:2991:2991:Unrelated:/nonexistent:/usr/sbin/nologin';
  const duplicateUidLine = `retention-clone:x:${uid}:1991:Clone:/nonexistent:/usr/sbin/nologin`;
  const rootGroupLine = 'root:x:0:';
  const groupLine = `${group}:x:${gid}:${explicitMembers.join(',')}`;
  const contents = new Map([
    ['/etc/nsswitch.conf', [
      `passwd: ${passwdSources}`,
      `group: ${groupSources}`,
      ...(initgroupsSources === null ? [] : [`initgroups: ${initgroupsSources}`]),
      '',
    ].join('\n')],
    ['/etc/passwd', [
      rootPasswdLine,
      passwdLine,
      ...(otherPrimaryUser ? [otherLine] : []),
      ...(unrelatedAccount ? [unrelatedLine] : []),
      ...(duplicateUidDifferentGid ? [duplicateUidLine] : []),
      '',
    ].join('\n')],
    ['/etc/group', [
      rootGroupLine,
      groupLine,
      ...(unrelatedAccount ? ['unrelated-local:x:2991:'] : []),
      ...(duplicateGroupName ? [`${group}:x:1992:`] : []),
      ...(duplicateGroupGid ? [`retention-alias:x:${gid}:`] : []),
      ...(supplementaryGroup ? ['retention-extra:x:1993:cortex-retention'] : []),
      '',
    ].join('\n')],
  ]);
  const inodeByPath = new Map([
    ['/etc/nsswitch.conf', 101],
    ['/etc/passwd', 102],
    ['/etc/group', 103],
  ]);
  const sourceReader = (sourcePath) => {
    if (sourceFailure === sourcePath) throw new Error(`unreadable ${sourcePath}`);
    const bytes = Buffer.from(contents.get(sourcePath) || '', 'utf8');
    return {
      path: sourcePath,
      bytes,
      device: 1,
      inode: inodeByPath.get(sourcePath),
      uid: unsafeSource === sourcePath ? 1000 : 0,
      gid: 0,
      mode: 0o644,
      nlink: 1,
      size: bytes.length,
      type: 'regular',
    };
  };
  const commandRunner = (command, argv) => {
    if (command === '/usr/bin/id' && canonicalJson(argv) === canonicalJson([
      '-G',
      'cortex-retention',
    ])) {
      return { status: 0, signal: null, stdout: `${gid}\n`, stderr: '' };
    }
    assert.equal(command, '/usr/bin/getent');
    assert.ok(['passwd', 'group'].includes(argv[0]));
    if (argv[0] === 'passwd' && argv[1] === 'retention-clone'
        && duplicateUidDifferentGid) {
      return {
        status: 0,
        signal: null,
        stdout: `${duplicateUidLine}\n`,
        stderr: '',
      };
    }
    if (argv.length !== 1) {
      return { status: 2, signal: null, stdout: '', stderr: 'not found' };
    }
    if (argv[0] === 'passwd') {
      return {
        status: 0,
        signal: null,
        stdout: [
          rootPasswdLine,
          passwdLine,
          ...(otherPrimaryUser ? [otherLine] : []),
          ...(unrelatedAccount ? [unrelatedLine] : []),
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    return {
      status: 0,
      signal: null,
      stdout: [
        rootGroupLine,
        groupLine,
        ...(duplicateGroupName ? [`${group}:x:1992:`] : []),
        ...(duplicateGroupGid ? [`retention-alias:x:${gid}:`] : []),
        '',
      ].join('\n'),
      stderr: '',
    };
  };
  return {
    binding: {
      schemaVersion: 'cortex.learning_os.retention_identity_sources.v2',
      policy: 'files-only',
      passwdProvider: 'files',
      groupProvider: 'files',
      initgroupsProvider: 'files',
    },
    commandRunner,
    sourceReader,
  };
}

const exactProductionIdentityRuntime = fakeRetentionIdentityRuntime();
const productionRetentionIdentity = Object.freeze({
  production: true,
  serviceUser: 'cortex-retention',
  serviceUid: 991,
  serviceGroup: 'cortex-retention',
  serviceGid: 991,
  identitySources: exactProductionIdentityRuntime.binding,
});

test('dedicated retention identity rejects shared groups, remapping, and wrong due-time credentials', () => {
  const exactIdentity = exactProductionIdentityRuntime;
  assert.equal(assertRetentionServiceIdentity(
    productionRetentionIdentity,
    { identitySourceReader: exactIdentity.sourceReader },
  ), true);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        explicitMembers: ['retention-intruder'],
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups|identity source binding changed/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        duplicateUidDifferentGid: true,
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        duplicateGroupName: true,
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        duplicateGroupGid: true,
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        passwdSources: 'files systemd',
      }).sourceReader,
    },
  ), /passwd source must be exactly the local files provider/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        groupSources: 'files sss',
      }).sourceReader,
    },
  ), /group source must be exactly the local files provider/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        initgroupsSources: 'ldap',
      }).sourceReader,
    },
  ), /initgroups source must be exactly the local files provider/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        unsafeSource: '/etc/passwd',
      }).sourceReader,
    },
  ), /not a root-owned, non-writable regular file/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        sourceFailure: '/etc/group',
      }).sourceReader,
    },
  ), /unreadable/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        otherPrimaryUser: true,
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups/);
  assert.throws(() => assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        supplementaryGroup: true,
      }).sourceReader,
    },
  ), /remapped, shared, or has supplementary groups/);
  assert.equal(assertRetentionServiceIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({
        unrelatedAccount: true,
      }).sourceReader,
    },
  ), true);

  // A crash can span the due time, but an NSS remap must fail before recovery
  // can reopen protected state or the signing secret.
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({ uid: 992 }).sourceReader,
      processIdentity: {
        uid: 991, euid: 991, gid: 991, egid: 991, groups: [991],
      },
    },
  ), /UID[/]GID or normalized NSS policy changed/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: fakeRetentionIdentityRuntime({ gid: 992 }).sourceReader,
      processIdentity: {
        uid: 991, euid: 991, gid: 991, egid: 991, groups: [991],
      },
    },
  ), /UID[/]GID or normalized NSS policy changed/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: {
        uid: 992, euid: 992, gid: 991, egid: 991, groups: [991],
      },
    },
  ), /process credentials/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: { uid: 0, euid: 0, gid: 0, egid: 0, groups: [0] },
    },
  ), /process credentials/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: {
        uid: 0, euid: 991, gid: 0, egid: 991, groups: [991],
      },
    },
  ), /process credentials/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: {
        uid: 991, euid: 991, gid: 991, egid: 991, groups: [],
      },
    },
  ), /process credentials/);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: {
        uid: 991, euid: 991, gid: 991, egid: 991, groups: [991, 1991],
      },
    },
  ), /process credentials/);
  assert.equal(assertRetentionResumeProcessIdentity(
    productionRetentionIdentity,
    {
      identitySourceReader: exactIdentity.sourceReader,
      processIdentity: {
        uid: 991, euid: 991, gid: 991, egid: 991, groups: [991],
      },
    },
  ), true);
  assert.throws(() => assertRetentionResumeProcessIdentity(
    { ...productionRetentionIdentity, production: false },
    { requireProduction: true },
  ), /bootstrap identity is missing/);
});

test('production firing requires the active signed sealed runtime, not only an environment claim', () => {
  const variable = 'CLOS_RETENTION_RUNTIME_CLOSURE_SHA256';
  const previous = process.env[variable];
  const closureSha256 = 'a'.repeat(64);
  const contract = {
    fixtureOnly: false,
    stateRootIdentity: { production: true },
    resumeExecution: {
      runtimeClosure: { closureSha256 },
    },
  };
  try {
    delete process.env[variable];
    assert.throws(
      () => assertRetentionResumeRuntimeIdentity(contract),
      /requires the active signed sealed runtime/,
    );
    process.env[variable] = closureSha256;
    assert.throws(
      () => assertRetentionResumeRuntimeIdentity(contract),
      /invalid process runtime closure/,
    );
    assert.equal(assertRetentionResumeRuntimeIdentity({
      fixtureOnly: true,
    }), true);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test('production manager receipt binds systemd environment and manager main PID', () => {
  const source = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-retention.mjs'),
    'utf8',
  );
  const start = source.indexOf(
    'function assertCurrentRetentionServiceInvocation',
  );
  const end = source.indexOf(
    'function managerFiringReceiptValid',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const boundary = source.slice(start, end);
  assert.match(boundary, /process[.]env[.]INVOCATION_ID/);
  assert.match(boundary, /issued !== observed/);
  assert.match(boundary, /mainPid !== process[.]pid/);
  assert.match(boundary, /ControlPID !== '0'/);
  assert.ok(
    source.indexOf(
      'const managerFiringReceipt = buildManagerFiringReceipt',
      end,
    ) > end,
  );
});

test('production retention entrypoints reject injectable fixture authority', () => {
  const contract = {
    stateRootIdentity: {
      production: true,
    },
  };
  const commonOverrides = {
    busctl: '/fake/busctl',
    commandRunner: () => ({ status: 0, stdout: '', stderr: '' }),
    crashInjector: () => {},
    identitySourceReader: () => ({
      uid: 991,
      gid: 991,
      user: 'cortex-retention',
      group: 'cortex-retention',
    }),
    now: '2026-07-28T10:05:00.000Z',
    processIdentity: {
      uid: 991,
      euid: 991,
      gid: 991,
      egid: 991,
      groups: [991],
    },
    systemctl: '/fake/systemctl',
  };
  for (const [field, injected] of Object.entries(commonOverrides)) {
    assert.throws(() => installRetentionResumeTimer({
      contract,
      [field]: injected,
    }), new RegExp(`forbids injectable test authority: ${field}`), field);
    assert.throws(() => reconcileRetentionResumeTimer({
      contract,
      [field]: injected,
    }), new RegExp(`forbids injectable test authority: ${field}`), field);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract,
      [field]: injected,
    }), new RegExp(`forbids injectable test authority: ${field}`), field);
  }
  assert.throws(() => processRetentionResumeTimerFiring({
    contract,
    releaseBuilder: () => ({}),
  }), /forbids injectable test authority: releaseBuilder/);
  for (const [operation, entrypoint] of [
    ['installation', installRetentionResumeTimer],
    ['repair', reconcileRetentionResumeTimer],
    ['firing', processRetentionResumeTimerFiring],
  ]) {
    for (const hostileDryRun of [true, 1, 'true', {}, []]) {
      assert.throws(() => entrypoint({
        contract,
        dryRun: hostileDryRun,
      }), new RegExp(`production retention ${operation} forbids dryRun`));
    }
    for (const hostileDryRun of [1, 'true', {}, []]) {
      assert.throws(() => entrypoint({
        contract: {
          fixtureOnly: true,
          stateRootIdentity: { production: false },
        },
        dryRun: hostileDryRun,
      }), new RegExp(`retention ${operation} dryRun must be a boolean`));
    }
    assert.throws(() => entrypoint({
      contract: {
        fixtureOnly: false,
        stateRootIdentity: { production: false },
      },
      dryRun: true,
    }), new RegExp(
      `retention ${operation} dryRun requires an authenticated fixture-only contract`,
    ));
  }
});

test('successful partial getent enumeration hiding a shared retention UID fails build, install, resume, and secret access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-duplicate-uid-'));
  const hostileIdentity = fakeRetentionIdentityRuntime({
    duplicateUidDifferentGid: true,
  });
  const productionStatus = resign({
    ...signedWaitingStatus({
      evaluatedAt: '2026-07-28T10:00:00.000Z',
      nextEligibleAt: '2026-07-28T11:00:00.000Z',
    }),
    fixtureOnly: false,
    campaignBinding: {
      campaignId: 'duplicate-uid-campaign',
      campaignDigest: 'e'.repeat(64),
    },
    completedWindowCount: 0,
    windowEvidenceDigests: [],
    executionAttestationDigests: [],
    executionEvidenceRecords: [],
    authenticatedWindowIntervals: [],
  });
  const identityError = /remapped, shared, or has supplementary groups|identity source binding changed/;
  try {
    const partialEnumeration = hostileIdentity.commandRunner(
      '/usr/bin/getent',
      ['passwd'],
    );
    const keyedHiddenAlias = hostileIdentity.commandRunner(
      '/usr/bin/getent',
      ['passwd', 'retention-clone'],
    );
    assert.equal(partialEnumeration.status, 0);
    assert.doesNotMatch(partialEnumeration.stdout, /retention-clone/);
    assert.equal(keyedHiddenAlias.status, 0);
    assert.match(keyedHiddenAlias.stdout, /retention-clone:x:991:1991:/);

    assert.equal(verifyRetentionStatusRecord(productionStatus, secret), true);
    assert.throws(() => buildRetentionWaitContract({
      status: productionStatus,
      statePath: path.join(root, 'retention-wait.json'),
      notifierPath: path.join(root, 'notifier.py'),
      resumeBundlePath: path.join(root, 'resume-bundle.json'),
      releasePath: path.join(root, 'retention-release.json'),
      qualificationSecretPath: path.join(root, 'qualification.hmac'),
      identitySourceReader: hostileIdentity.sourceReader,
      createdAt: '2026-07-28T10:05:00.000Z',
      signingSecret: secret,
    }), identityError);

    const inaccessibleContract = {
      stateRootIdentity: productionRetentionIdentity,
    };
    assert.throws(() => installRetentionResumeTimer({
      contract: inaccessibleContract,
      waitPath: path.join(root, 'must-not-open-wait.json'),
      signingSecret: secret,
      identitySourceReader: hostileIdentity.sourceReader,
      dryRun: true,
      now: '2026-07-28T10:05:00.000Z',
    }), /forbids injectable test authority/);
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: inaccessibleContract,
      waitPath: path.join(root, 'must-not-open-wait.json'),
      signingSecret: secret,
      identitySourceReader: hostileIdentity.sourceReader,
      now: '2026-07-28T11:05:00.000Z',
    }), /forbids injectable test authority/);
    assert.throws(() => assertRetentionResumeProcessIdentity(
      productionRetentionIdentity,
      {
        identitySourceReader: hostileIdentity.sourceReader,
        processIdentity: {
          uid: 991, euid: 991, gid: 991, egid: 991, groups: [991],
        },
      },
    ), identityError);
    assert.throws(() => readRetentionProtectedSecret(
      path.join(root, 'must-not-open-secret.hmac'),
      productionRetentionIdentity,
      {
        identitySourceReader: hostileIdentity.sourceReader,
        processIdentity: {
          uid: 991, euid: 991, gid: 991, egid: 991, groups: [991],
        },
      },
    ), identityError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function qualificationPlan() {
  const sourceCommit = '1'.repeat(40);
  const sourceTree = '2'.repeat(40);
  const productTree = '3'.repeat(40);
  const executionClosure = buildWorkingTreeExecutionClosure({
    sourceCommit,
    sourceTree,
    productTree,
  });
  const deployment = buildDeploymentBinding({
    sourceCommit,
    sourceTree,
    productTree,
    executionClosure,
    artifacts: { graph: 'authenticated graph bytes' },
  });
  const campaignDigest = '4'.repeat(64);
  const notBefore = '2026-07-01T00:00:00.000Z';
  const expiresAt = '2026-08-01T00:00:00.000Z';
  const prompt = Buffer.from('authenticate before qualification spend', 'utf8');
  const limits = {
    timeoutSeconds: 600,
    maxOutputBytes: 4 * 1024 * 1024,
  };
  const descriptorSha256 = digest({
    jobId: 'campaign-verified.exam-1',
    role: 'exam',
    sessionId: 'candidate-session-1',
    executor: 'model_no_tools',
    dependencies: [],
    promptBase64: prompt.toString('base64'),
    outputSchema: 'model-answer-output.schema.json',
    task: null,
    timeoutSeconds: limits.timeoutSeconds,
    maxOutputBytes: limits.maxOutputBytes,
  });
  const job = sign({
    schemaVersion: PHD_DETACHED_JOB_SCHEMA,
    jobId: 'campaign-verified.exam-1',
    campaignId: 'campaign-verified',
    campaignDigest,
    role: 'exam',
    sessionId: 'candidate-session-1',
    executor: 'model_no_tools',
    dependencies: [],
    deployment,
    notBefore,
    expiresAt,
    promptBase64: prompt.toString('base64'),
    promptSha256: sha256Text(prompt),
    outputSchema: 'model-answer-output.schema.json',
    task: null,
    descriptorSha256,
    idempotencyKey: digest({
      campaignId: 'campaign-verified',
      jobId: 'campaign-verified.exam-1',
      descriptorSha256,
    }),
    modelRuntime: {
      provider: 'openai-codex',
      model: 'gpt-5.4',
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
    },
    limits,
    canonicalStateAuthority: false,
    truthBoundary: 'Detached worker may produce candidate evidence only; it cannot mutate canonical state.',
  });
  return sign({
    schemaVersion: PHD_DETACHED_JOB_PLAN_SCHEMA,
    campaignId: 'campaign-verified',
    subjectId: 'candidate-verified',
    campaignDigest,
    deployment,
    frozenAt: notBefore,
    expiresAt,
    jobs: [job],
    descriptorSetSha256: digest([{
      jobId: job.jobId,
      descriptorSha256: job.descriptorSha256,
      idempotencyKey: job.idempotencyKey,
    }]),
    protectedAuthorityTasks: [],
    resumePolicy: {
      idempotentByJobIdAndDescriptorDigest: true,
      idempotentByJobIdAndPromptDigest: true,
      terminalArtifactsImmutable: true,
      retryIdentityField: 'idempotencyKey',
      crashRecovery: 'rerun_missing_jobs_only_then_reharvest',
      partialApplyAllowed: false,
    },
    truthBoundary: 'A job plan is not qualification evidence.',
  });
}

test('retention waits reject forged or tampered source status and retain its exact authentication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-source-auth-'));
  try {
  const createdAt = '2026-07-28T10:00:00.000Z';
  const status = signedWaitingStatus({
    evaluatedAt: createdAt,
    nextEligibleAt: '2026-07-28T11:00:00.000Z',
  });
  const inputs = {
    statePath: path.join(root, 'retention.json'),
    notifierPath: path.join(root, 'notifier.py'),
    resumeBundlePath: path.join(root, 'resume.json'),
    releasePath: path.join(root, 'retention-release.json'),
    qualificationSecretPath: path.join(root, 'qualification.hmac'),
    createdAt,
    signingSecret: secret,
  };
  assert.throws(() => buildRetentionWaitContract({
    ...inputs,
    status: { ...status, controlPlaneSignature: undefined },
  }), /source status signature mismatch/);
  assert.throws(() => buildRetentionWaitContract({
    ...inputs,
    status: { ...status, nextEligibleAt: '2026-07-28T12:00:00.000Z' },
  }), /source status signature mismatch/);
  assert.throws(() => buildRetentionWaitContract({
    ...inputs,
    status,
    signingSecret: `${secret}-wrong`,
  }), /source status signature mismatch/);
  const wait = buildRetentionWaitContract({ ...inputs, status });
  assert.equal(wait.sourceStatusDigest, sha256Text(canonicalJson(status)));
  assert.deepEqual(wait.sourceStatusSignature, status.controlPlaneSignature);
  assert.equal(wait.campaignBinding, null);
  assert.equal(wait.nextWindowIndex, 2);
  assert.equal(wait.previousWindowDigest, status.windowEvidenceDigests[0]);
  assert.equal(wait.dueTaskDigest, null);
  assert.equal(verifyRetentionWaitContract(resign({
    ...wait,
    nextWindowIndex: 1,
  }), secret), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer retry adopts only an exact pre-existing timer and publishes once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-retry-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: true });
    const adopted = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.equal(adopted.reconciled, true);
    assert.equal(adopted.contract.timerInstalled, true);
    assert.equal(runtime.installCalls(), 0);
    assert.equal(runtime.daemonReloadCalls(), 1);
    assert.equal(verifyRetentionWaitContract(adopted.contract, secret), true);
    assert.equal(adopted.contract.sourceWaitDigest, sha256Text(canonicalJson(fixture.persisted)));
    const inspectedTransition = adopted.journal.transitions.find(
      (transition) => transition.phase === 'inspected',
    );
    assert.deepEqual(
      inspectedTransition.evidence.inspection.service.ExecStartExDbus[0].argv,
      fixture.persisted.resumeCommand,
    );
    assert.deepEqual(
      inspectedTransition.evidence.inspection.service.ExecStartExDbus[0].flags,
      [],
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')), adopted.contract);

    const retried = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.deepEqual(retried.contract, adopted.contract);
    assert.equal(runtime.installCalls(), 0);
    assert.equal(runtime.daemonReloadCalls(), 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer creation is inspected before authenticated installation publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-create-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.equal(runtime.installCalls(), 1);
    assert.equal(installed.reconciled, false);
    assert.equal(installed.contract.timerInstalled, true);
    assert.equal(verifyRetentionWaitContract(installed.contract, secret), true);
    const serviceUnit = fs.readFileSync(
      path.join(
        fixture.persisted.stateRootIdentity.path,
        '.retention-systemd-units',
        installed.contract.timerServiceUnit,
      ),
      'utf8',
    );
    assert.match(
      serviceUnit,
      new RegExp(`\\nUser=${fixture.persisted.stateRootIdentity.serviceUid}\\n`),
    );
    assert.match(
      serviceUnit,
      new RegExp(`\\nGroup=${fixture.persisted.stateRootIdentity.serviceGid}\\n`),
    );
    assert.match(
      serviceUnit,
      new RegExp(`\\nSupplementaryGroups=${fixture.persisted.stateRootIdentity.serviceGid}\\n`),
    );
    assert.match(serviceUnit, /\nUMask=0077\n/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('numeric non-root due-time processing releases without any privileged timer mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-nonroot-fire-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    let attemptedMutation = false;
    const deniedMutationRunner = (command, argv, options) => {
      if (['daemon-reload', 'enable'].includes(argv[0])) {
        attemptedMutation = true;
        return { status: 1, signal: null, stdout: '', stderr: 'access denied' };
      }
      return runtime.commandRunner(command, argv, options);
    };
    const released = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: deniedMutationRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      processIdentity: {
        uid: installed.contract.stateRootIdentity.serviceUid,
        euid: installed.contract.stateRootIdentity.serviceUid,
        gid: installed.contract.stateRootIdentity.serviceGid,
        egid: installed.contract.stateRootIdentity.serviceGid,
        groups: [installed.contract.stateRootIdentity.serviceGid],
      },
      now: '2026-07-28T11:05:00.000Z',
    });
    assert.equal(attemptedMutation, false);
    assert.equal(released.released, true);
    assert.equal(released.contract.timerReleased, true);
    assert.equal(released.journal.phase, 'released');
    assert.equal(verifyRetentionWaitContract(released.contract, secret), true);
    const firedTransition = released.journal.transitions.find(
      (transition) => transition.phase === 'fired',
    );
    assert.deepEqual(released.contract.timerReleaseReceipt, {
      schemaVersion: 'cortex.learning_os.retention_timer_release_receipt.v2',
      timerSpecDigest: runtime.specDigest,
      durableUnitObservationDigest:
        firedTransition.evidence.durableUnitObservationDigest,
      managerInspectionDigest: firedTransition.evidence.inspectionDigest,
      managerIdentityDigest: firedTransition.evidence.managerIdentityDigest,
      managerFiringReceiptDigest: sha256Text(canonicalJson(
        firedTransition.evidence.managerFiringReceipt,
      )),
      firedAt: fixture.persisted.resumeAt,
      releaseManagerInspectionDigest: firedTransition.evidence.inspectionDigest,
      releaseServiceInvocationId:
        firedTransition.evidence.managerFiringReceipt.serviceInvocationId,
      releaseServiceMainPid: process.pid,
      releaseTimerInvocationId:
        firedTransition.evidence.managerFiringReceipt.timerInvocationId,
      releasedJournalDigest: sha256Text(canonicalJson(released.journal)),
      releaseDigest: released.contract.releaseDigest,
      releaseFileSha256: released.contract.releaseFileSha256,
      confirmedAt: released.contract.timerReleasedAt,
    });
    const detachedRelease = structuredClone(released.contract);
    detachedRelease.timerReleaseReceipt.releasedJournalDigest = '0'.repeat(64);
    const signedDetachedRelease = resign(detachedRelease);
    assert.equal(verifyRetentionWaitContract(signedDetachedRelease, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: released.journal,
      contract: signedDetachedRelease,
      signingSecret: secret,
    }), false);
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(signedDetachedRelease, null, 2)}\n`,
    );
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: signedDetachedRelease,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    }), /timer journal is stale, tampered, or inconsistent/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timer service reentry during durable enablement cannot overwrite pending state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-reentrant-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    let reentrantError = null;
    const commandRunner = (command, argv, options) => {
      if (command === '/fake/systemctl' && argv[0] === 'enable') {
        try {
          installRetentionResumeTimer({
            contract: fixture.persisted,
            waitPath: fixture.waitPath,
            signingSecret: secret,
            systemdRun: '/fake/systemd-run',
            systemctl: '/fake/systemctl',
            commandRunner: runtime.commandRunner,
            now: '2026-07-28T10:05:00.000Z',
          });
        } catch (error) {
          reentrantError = error;
        }
      }
      return runtime.commandRunner(command, argv, options);
    };
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.match(reentrantError?.message || '', /locked by a live installer or reconciler/);
    assert.equal(installed.contract.timerInstalled, true);
    assert.equal(installed.journal.phase, 'installed');
    assert.equal(fs.existsSync(`${fixture.persisted.timerJournalPath}.lock`), true);
    assert.equal(
      fs.statSync(`${fixture.persisted.timerJournalPath}.lock`).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')),
      installed.contract,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('initial retention wait publication is no-replace under process contention and crash recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-initial-publish-'));
  let holder = null;
  try {
    const createdAt = '2026-07-28T10:00:00.000Z';
    const waitPath = path.join(root, 'retention-wait.json');
    const status = signedWaitingStatus({
      evaluatedAt: createdAt,
      nextEligibleAt: '2026-07-28T11:00:00.000Z',
    });
    const contract = buildRetentionWaitContract({
      status,
      statePath: waitPath,
      notifierPath: path.join(root, 'notifier.py'),
      resumeBundlePath: path.join(root, 'resume-bundle.json'),
      releasePath: path.join(root, 'retention-release.json'),
      qualificationSecretPath: path.join(root, 'qualification.hmac'),
      createdAt,
      signingSecret: secret,
    });
    const readyPath = path.join(root, 'publisher.ready');
    const inputPath = path.join(root, 'publisher-input.json');
    fs.writeFileSync(inputPath, `${JSON.stringify({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
      readyPath,
    }, null, 2)}\n`, { mode: 0o600 });
    let holderStderr = '';
    holder = spawn(process.execPath, [
      concurrencyChild,
      'retention-persist-hold',
      inputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    holder.stderr.setEncoding('utf8');
    holder.stderr.on('data', (chunk) => { holderStderr += chunk; });
    await waitForFixtureReady(holder, readyPath, () => holderStderr);
    assert.equal(fs.existsSync(waitPath), false);

    const contender = spawnSync(process.execPath, [
      concurrencyChild,
      'retention-persist-contend',
      inputPath,
    ], { encoding: 'utf8' });
    assert.equal(contender.status, 4, contender.stderr);
    assert.match(contender.stderr, /locked by a live installer or reconciler/);
    assert.equal(fs.existsSync(waitPath), false);

    await stopFixtureChild(holder);
    holder = null;
    const interrupted = spawnSync(process.execPath, [
      concurrencyChild,
      'retention-persist-crash',
      inputPath,
    ], { encoding: 'utf8' });
    assert.equal(
      interrupted.signal,
      'SIGKILL',
      interrupted.stderr || interrupted.error?.message,
    );
    assert.equal(fs.existsSync(waitPath), true);
    assert.equal(fs.statSync(waitPath).nlink, 2);
    const recovered = persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(waitPath, 'utf8')), recovered);
    const adopted = persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    });
    assert.deepEqual(adopted, recovered);
    const crashTemporary = path.join(
      root,
      `.retention-wait.json.${process.pid}.${'a'.repeat(24)}.tmp`,
    );
    fs.linkSync(waitPath, crashTemporary);
    assert.equal(fs.statSync(waitPath).nlink, 2);
    const crashRecovered = persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    });
    assert.deepEqual(crashRecovered, recovered);
    assert.equal(fs.existsSync(crashTemporary), false);
    assert.equal(fs.statSync(waitPath).nlink, 1);
    const unknownAlias = path.join(root, 'unknown-wait-hard-link');
    fs.linkSync(waitPath, unknownAlias);
    assert.throws(() => persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    }), /unknown hard-link alias/);
    fs.unlinkSync(unknownAlias);
    assert.throws(() => persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: '2026-07-28T10:00:01.000Z',
    }), /predecessor changed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(waitPath, 'utf8')), recovered);
  } finally {
    if (holder) await stopFixtureChild(holder);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention state publication pins and bounds an existing predecessor before adoption', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-publication-predecessor-'));
  const originalReadFileSync = fs.readFileSync;
  const originalReadSync = fs.readSync;
  try {
    const createdAt = '2026-07-28T10:00:00.000Z';
    const waitPath = path.join(root, 'retention-wait.json');
    const status = signedWaitingStatus({
      evaluatedAt: createdAt,
      nextEligibleAt: '2026-07-28T11:00:00.000Z',
    });
    const contract = buildRetentionWaitContract({
      status,
      statePath: waitPath,
      notifierPath: path.join(root, 'notifier.py'),
      resumeBundlePath: path.join(root, 'resume-bundle.json'),
      releasePath: path.join(root, 'retention-release.json'),
      qualificationSecretPath: path.join(root, 'qualification.hmac'),
      createdAt,
      signingSecret: secret,
    });
    persistRetentionWaitContract({
      contract,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
    });
    const selected = fs.statSync(waitPath, { bigint: true });
    const rewrittenBytes = Buffer.from('{"rewritten":true}\n', 'utf8');
    let rewritten = false;
    const selectedDescriptor = (descriptor) => {
      if (!Number.isInteger(descriptor)) return false;
      try {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        return stat.dev === selected.dev && stat.ino === selected.ino;
      } catch {
        return false;
      }
    };
    const rewriteSelectedPredecessor = () => {
      if (rewritten) return;
      rewritten = true;
      fs.writeFileSync(waitPath, rewrittenBytes);
    };
    fs.readFileSync = function rewriteAfterCopiedPredecessor(target, ...args) {
      const bytes = originalReadFileSync.call(this, target, ...args);
      if (selectedDescriptor(target)) rewriteSelectedPredecessor();
      return bytes;
    };
    fs.readSync = function rewriteDuringPinnedPredecessor(
      descriptor,
      buffer,
      offset,
      length,
      position,
    ) {
      const count = originalReadSync.call(
        this,
        descriptor,
        buffer,
        offset,
        length,
        position,
      );
      if (count > 0 && selectedDescriptor(descriptor)) {
        rewriteSelectedPredecessor();
      }
      return count;
    };
    assert.throws(
      () => persistRetentionWaitContract({
        contract,
        waitPath,
        signingSecret: secret,
        persistedAt: createdAt,
      }),
      /publication predecessor changed during its descriptor-pinned publication read/,
    );
    assert.equal(rewritten, true);
    assert.deepEqual(fs.readFileSync(waitPath), rewrittenBytes);

    fs.readFileSync = originalReadFileSync;
    fs.readSync = originalReadSync;
    fs.writeFileSync(waitPath, Buffer.alloc((1024 * 1024) + 1, 0x78));
    assert.throws(
      () => persistRetentionWaitContract({
        contract,
        waitPath,
        signingSecret: secret,
        persistedAt: createdAt,
      }),
      /publication predecessor ownership, mode, link count, type, mount, or size is unsafe/,
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.readSync = originalReadSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention kernel exclusion survives two-process contention and releases on process death', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-kernel-lock-'));
  let holder = null;
  try {
    const fixture = persistedWait(root);
    const lockPath = `${fixture.persisted.timerJournalPath}.lock`;
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion: 'cortex.learning_os.retention_timer_lock.v1',
      pid: 2147483647,
      bootId: '00000000-0000-0000-0000-000000000000',
      processStartTime: '1',
      sourceStatusDigest: fixture.persisted.sourceStatusDigest,
      lockId: 'stale-pre-kernel-lock-record',
    })}\n`, { mode: 0o600 });
    const before = fs.statSync(lockPath, { bigint: true });
    const readyPath = path.join(root, 'holder.ready');
    const inputPath = path.join(root, 'concurrency-input.json');
    fs.writeFileSync(inputPath, `${JSON.stringify({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      now: '2026-07-28T10:05:00.000Z',
      readyPath,
      holdPhase: 'before_pending_publication',
    }, null, 2)}\n`, { mode: 0o600 });
    let holderStderr = '';
    holder = spawn(process.execPath, [
      concurrencyChild,
      'retention-hold',
      inputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    holder.stderr.setEncoding('utf8');
    holder.stderr.on('data', (chunk) => { holderStderr += chunk; });
    await waitForFixtureReady(holder, readyPath, () => holderStderr);

    assert.equal(fs.existsSync(fixture.persisted.timerJournalPath), false);
    for (let contender = 0; contender < 2; contender += 1) {
      const collision = spawnSync(process.execPath, [
        concurrencyChild,
        'retention-contend',
        inputPath,
      ], { encoding: 'utf8' });
      assert.equal(collision.status, 4, `contender ${contender}`);
      assert.match(collision.stderr, /locked by a live installer or reconciler/);
      assert.equal(fs.existsSync(fixture.persisted.timerJournalPath), false);
    }

    await stopFixtureChild(holder);
    holder = null;
    const afterDeath = fs.statSync(lockPath, { bigint: true });
    assert.equal(afterDeath.dev, before.dev);
    assert.equal(afterDeath.ino, before.ino);

    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.journal.phase, 'installed');
    assert.equal(runtime.installCalls(), 1);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.persisted.timerJournalPath, 'utf8')).phase,
      'installed',
    );
    const retry = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:07:00.000Z',
    });
    assert.equal(retry.journal.phase, 'installed');
    assert.deepEqual(retry.contract, recovered.contract);
  } finally {
    if (holder) await stopFixtureChild(holder);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer rejects an exact-identity content mismatch without publishing installed state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-mismatch-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: true, mismatch: 'exec' });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    }), /identity or content mismatch.*ExecStart/);
    const unchanged = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    assert.equal(unchanged.timerInstalled, false);
    assert.equal(verifyRetentionWaitContract(unchanged, secret), true);
    assert.equal(runtime.installCalls(), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer dry-run never manufactures installed evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-dry-run-'));
  try {
    const fixture = persistedWait(root);
    const result = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      dryRun: true,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.contract.timerInstalled, false);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    assert.equal(fs.existsSync(fixture.persisted.timerJournalPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention state and delayed entrypoint reject owner, mode, symlink, and byte-identity drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-state-root-'));
  try {
    const fixture = persistedWait(root);
    fs.chmodSync(root, 0o755);
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      dryRun: true,
      now: '2026-07-28T10:05:00.000Z',
    }), /state root ownership, mode, or type changed/);
    fs.chmodSync(root, 0o700);

    const symlinkPath = path.join(root, 'wait-link.json');
    fs.symlinkSync(fixture.waitPath, symlinkPath);
    assert.throws(() => persistRetentionWaitContract({
      contract: {
        ...fixture.persisted,
        statePath: symlinkPath,
      },
      waitPath: symlinkPath,
      signingSecret: secret,
      persistedAt: '2026-07-28T10:06:00.000Z',
    }), /signature or state is invalid|symlink|unsafe/);

    const changedExecution = structuredClone(fixture.persisted);
    changedExecution.resumeExecution.entrypointSha256 = '0'.repeat(64);
    const changed = resign(changedExecution);
    fs.writeFileSync(fixture.waitPath, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });
    assert.throws(() => installRetentionResumeTimer({
      contract: changed,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      dryRun: true,
      now: '2026-07-28T10:05:00.000Z',
    }), /entrypoint bytes changed/);

    const protectedBundle = path.join(root, 'protected-bundle.json');
    const protectedSecret = path.join(root, 'qualification.hmac');
    fs.writeFileSync(protectedBundle, '{"protected":true}\n', { mode: 0o600 });
    fs.writeFileSync(protectedSecret, `${secret}\n`, { mode: 0o600 });
    assert.deepEqual(
      readRetentionProtectedJson(
        protectedBundle,
        fixture.persisted.stateRootIdentity,
      ),
      { protected: true },
    );
    assert.equal(
      readRetentionProtectedJson(
        protectedBundle,
        fixture.persisted.stateRootIdentity,
        {
          consume(record) {
            assert.deepEqual(record, { protected: true });
            return record.protected;
          },
        },
      ),
      true,
    );
    assert.throws(
      () => readRetentionProtectedJson(
        protectedBundle,
        fixture.persisted.stateRootIdentity,
        { consume: async (record) => record },
      ),
      /protected consumer must complete synchronously/,
    );
    const replacementBundle = '{"protected":null}\n';
    assert.equal(
      Buffer.byteLength(replacementBundle),
      fs.statSync(protectedBundle).size,
    );
    assert.throws(
      () => readRetentionProtectedJson(
        protectedBundle,
        fixture.persisted.stateRootIdentity,
        {
          consume(record) {
            assert.deepEqual(record, { protected: true });
            fs.writeFileSync(protectedBundle, replacementBundle);
            return true;
          },
        },
      ),
      /changed across its protected consumer handoff/,
    );
    fs.writeFileSync(protectedBundle, '{"protected":true}\n', { mode: 0o600 });
    const protectedParent = path.join(root, 'protected-parent');
    const protectedInner = path.join(protectedParent, 'inner');
    const displacedProtectedParent = path.join(
      root,
      'protected-parent.displaced',
    );
    const nestedProtectedBundle = path.join(
      protectedInner,
      'protected-bundle.json',
    );
    fs.mkdirSync(protectedInner, { mode: 0o700, recursive: true });
    fs.writeFileSync(nestedProtectedBundle, '{"protected":true}\n', {
      mode: 0o600,
    });
    let swappedProtectedParent = false;
    assert.throws(
      () => readRetentionProtectedJson(
        nestedProtectedBundle,
        fixture.persisted.stateRootIdentity,
        {
          consume(record) {
            assert.deepEqual(record, { protected: true });
            fs.renameSync(protectedParent, displacedProtectedParent);
            fs.mkdirSync(protectedInner, { mode: 0o700, recursive: true });
            fs.writeFileSync(
              nestedProtectedBundle,
              '{"protected":null}\n',
              { mode: 0o600 },
            );
            swappedProtectedParent = true;
            return true;
          },
        },
      ),
      /protected state ancestor identity changed/,
    );
    assert.equal(swappedProtectedParent, true);
    assert.equal(
      readRetentionProtectedSecret(
        protectedSecret,
        fixture.persisted.stateRootIdentity,
        { expectedKeyId: sha256Text(secret).slice(0, 16) },
      ),
      secret,
    );
    assert.throws(
      () => readRetentionProtectedSecret(
        protectedSecret,
        fixture.persisted.stateRootIdentity,
        { expectedKeyId: '0'.repeat(16) },
      ),
      /control-plane secret is invalid/,
    );
    fs.chmodSync(protectedSecret, 0o644);
    assert.throws(() => readRetentionProtectedSecret(
      protectedSecret,
      fixture.persisted.stateRootIdentity,
    ), /ownership, mode, or type is unsafe/);
    fs.chmodSync(protectedSecret, 0o600);
    const secretHardlink = path.join(root, 'qualification-hardlink.hmac');
    fs.linkSync(protectedSecret, secretHardlink);
    assert.throws(() => readRetentionProtectedSecret(
      protectedSecret,
      fixture.persisted.stateRootIdentity,
    ), /ownership, mode, or type is unsafe/);
    fs.unlinkSync(secretHardlink);
    assert.equal(
      readRetentionProtectedSecret(
        protectedSecret,
        fixture.persisted.stateRootIdentity,
      ),
      secret,
    );
    const unsafeParent = path.join(root, 'unsafe-parent');
    fs.mkdirSync(unsafeParent, { mode: 0o755 });
    const nestedBundle = path.join(unsafeParent, 'bundle.json');
    fs.writeFileSync(nestedBundle, '{}\n', { mode: 0o600 });
    assert.throws(() => readRetentionProtectedJson(
      nestedBundle,
      fixture.persisted.stateRootIdentity,
    ), /ancestor ownership, mode, or type is unsafe/);

    const retentionSource = fs.readFileSync(
      path.join(closRoot, 'src', 'phd-retention.mjs'),
      'utf8',
    );
    assert.match(retentionSource, /assertExecutionClosureAtRoot\(\s*expectedDeployment[.]executionClosure/);
    assert.match(retentionSource, /assertExecutionClosureAtRoot\(\s*contract[.]resumeExecution[.]executionClosure/);
    assert.match(retentionSource, /buildProcessRuntimeClosure\(\{\s*executablePath:\s*process[.]execPath/);
    assert.match(retentionSource, /assertRetentionRuntimeClosure\(contract\)/);
    assert.match(retentionSource, /additionalExecutablePaths:\s*Object[.]values\(helperPaths\)/);
    assert.match(retentionSource, /mountFilePaths:[\s\S]+RETENTION_IDENTITY_SOURCE_PATHS/);
    assert.match(retentionSource, /contract[.]resumeExecution[.]runtimeClosure[.]rootDirectory/);
    assert.match(retentionSource, /RootDirectory=/);
    assert.match(retentionSource, /MountAPIVFS=/);
    assert.match(retentionSource, /BindReadOnlyPaths=/);
    assert.match(retentionSource, /BindPaths=/);
    assert.match(retentionSource, /linuxDescriptorMountAccess\(directoryDescriptor\)/);
    assert.match(retentionSource, /mountAccess[.]readOnly !== true/);
    assert.match(retentionSource, /mountAccess[.]mountPoint !== spec[.]unitDirectory/);
    assert.match(retentionSource, /CLOS_RETENTION_RUNTIME_CLOSURE_SHA256=/);
    assert.match(retentionSource, /descriptorBoundRetentionCommandRunner/);
    assert.match(retentionSource, /commandRunner\('[/]proc[/]self[/]fd[/]3'/);
    const controlSource = fs.readFileSync(
      path.join(closRoot, 'src', 'phd-qualification-control.mjs'),
      'utf8',
    );
    assert.match(controlSource, /loadCanonicalPhdProgramFromCheckout/);
    assert.match(
      controlSource,
      /waitBootstrap === null[\s\S]+loadCanonicalPhdProgramFromCheckout/,
    );
    const programSource = fs.readFileSync(
      path.join(closRoot, 'src', 'phd-program-runtime.mjs'),
      'utf8',
    );
    assert.match(programSource, /readExecutionClosureFileAtRoot/);
    assert.match(programSource, /sourceMode:\s*'signed_immutable_checkout'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention protected-state reads are nonblocking and reject in-place or named substitution', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-state-snapshot-',
  ));
  const originalReadSync = fs.readSync;
  const originalOpenSync = fs.openSync;
  const originalFstatSync = fs.fstatSync;
  try {
    const fixture = persistedWait(root);
    const protectedBundle = path.join(root, 'protected-bundle.json');
    const originalBytes = '{"protected":true}\n';
    const replacementBytes = '{"protected":null}\n';
    assert.equal(
      Buffer.byteLength(originalBytes),
      Buffer.byteLength(replacementBytes),
    );
    fs.writeFileSync(protectedBundle, originalBytes, { mode: 0o600 });
    const protectedInode = fs.statSync(protectedBundle).ino;

    let rewrotePinnedInode = false;
    fs.readSync = function rewriteAfterPinnedRead(...args) {
      const count = originalReadSync.apply(this, args);
      if (!rewrotePinnedInode) {
        let inode = null;
        try {
          inode = fs.fstatSync(args[0]).ino;
        } catch {}
        if (inode === protectedInode) {
          rewrotePinnedInode = true;
          fs.writeFileSync(protectedBundle, replacementBytes, { mode: 0o600 });
        }
      }
      return count;
    };
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /changed during its descriptor-pinned authenticated read/);
    assert.equal(rewrotePinnedInode, true);
    fs.readSync = originalReadSync;

    fs.writeFileSync(protectedBundle, originalBytes, { mode: 0o600 });
    const displaced = path.join(root, 'protected-bundle.displaced.json');
    let targetOpenCount = 0;
    let replacedNamedTarget = false;
    fs.openSync = function replaceBeforeNamedReopen(target, ...args) {
      if (String(target).endsWith('/protected-bundle.json')) {
        targetOpenCount += 1;
        if (targetOpenCount === 2) {
          replacedNamedTarget = true;
          fs.renameSync(protectedBundle, displaced);
          fs.writeFileSync(protectedBundle, replacementBytes, { mode: 0o600 });
        }
      }
      return originalOpenSync.call(this, target, ...args);
    };
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /changed during its descriptor-pinned authenticated read/);
    assert.equal(replacedNamedTarget, true);
    fs.openSync = originalOpenSync;

    fs.writeFileSync(protectedBundle, originalBytes, { mode: 0o600 });
    const mutateAfterSafeTargetOpen = (mutation) => {
      let mutated = false;
      fs.fstatSync = function mutateAfterInitialSafeStat(descriptor, ...args) {
        const stat = originalFstatSync.call(this, descriptor, ...args);
        if (!mutated
            && stat.isFile()
            && Number(stat.ino) === fs.statSync(protectedBundle).ino) {
          mutated = true;
          mutation();
        }
        return stat;
      };
      return () => mutated;
    };

    let mutationObserved = mutateAfterSafeTargetOpen(() => {
      fs.chmodSync(protectedBundle, 0o644);
    });
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /unsafe snapshot baseline|changed during its descriptor-pinned authenticated read/);
    assert.equal(mutationObserved(), true);
    fs.fstatSync = originalFstatSync;
    fs.chmodSync(protectedBundle, 0o600);

    const hostileHardlink = path.join(root, 'protected-bundle.hardlink.json');
    mutationObserved = mutateAfterSafeTargetOpen(() => {
      fs.linkSync(protectedBundle, hostileHardlink);
    });
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /unsafe snapshot baseline|changed during its descriptor-pinned authenticated read/);
    assert.equal(mutationObserved(), true);
    fs.fstatSync = originalFstatSync;
    fs.unlinkSync(hostileHardlink);

    mutationObserved = mutateAfterSafeTargetOpen(() => {
      fs.chmodSync(root, 0o755);
    });
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /unsafe snapshot baseline|changed during its descriptor-pinned authenticated read/);
    assert.equal(mutationObserved(), true);
    fs.fstatSync = originalFstatSync;
    fs.chmodSync(root, 0o700);

    fs.writeFileSync(protectedBundle, '{"protected": true}\n', { mode: 0o600 });
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /not an exact deterministic JSON encoding/);
    fs.writeFileSync(
      protectedBundle,
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d, 0x0a]),
      { mode: 0o600 },
    );
    assert.throws(() => readRetentionProtectedJson(
      protectedBundle,
      fixture.persisted.stateRootIdentity,
    ), /not strict UTF-8/);

    const fifoPath = path.join(root, 'protected-state.fifo');
    makeFifo(fifoPath, '0600');
    const startedAt = Date.now();
    assert.throws(() => readRetentionProtectedJson(
      fifoPath,
      fixture.persisted.stateRootIdentity,
    ), /ownership, mode, or type is unsafe|not a no-follow regular file/);
    assert.ok(
      Date.now() - startedAt < 1_000,
      'special-file rejection must not wait for a FIFO writer',
    );
  } finally {
    fs.fstatSync = originalFstatSync;
    fs.readSync = originalReadSync;
    fs.openSync = originalOpenSync;
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention protected-state CAS publication rejects a detached descendant parent', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-state-publication-parent-',
  ));
  const protectedParent = path.join(root, 'protected-parent');
  const displacedParent = path.join(root, 'protected-parent.displaced');
  const originalLinkSync = fs.linkSync;
  try {
    fs.mkdirSync(protectedParent, { mode: 0o700 });
    const createdAt = '2026-07-28T10:00:00.000Z';
    const waitPath = path.join(protectedParent, 'retention-wait.json');
    const status = signedWaitingStatus({
      evaluatedAt: createdAt,
      nextEligibleAt: '2026-07-28T11:00:00.000Z',
    });
    const wait = buildRetentionWaitContract({
      status,
      statePath: waitPath,
      notifierPath: path.join(root, 'notifier.py'),
      resumeBundlePath: path.join(root, 'resume-bundle.json'),
      releasePath: path.join(root, 'retention-release.json'),
      qualificationSecretPath: path.join(root, 'qualification.hmac'),
      createdAt,
      signingSecret: secret,
    });
    let parentSwapped = false;
    fs.linkSync = function swapParentAfterWaitCommit(source, target) {
      const result = originalLinkSync.call(this, source, target);
      if (!parentSwapped
          && String(target).endsWith('/retention-wait.json')) {
        fs.renameSync(protectedParent, displacedParent);
        fs.mkdirSync(protectedParent, { mode: 0o700 });
        parentSwapped = true;
      }
      return result;
    };
    assert.throws(
      () => persistRetentionWaitContract({
        contract: wait,
        waitPath,
        signingSecret: secret,
        persistedAt: createdAt,
      }),
      /protected state ancestor identity changed/,
    );
    assert.equal(parentSwapped, true);
    assert.equal(fs.existsSync(waitPath), false);
    assert.equal(
      fs.existsSync(path.join(displacedParent, 'retention-wait.json')),
      true,
    );
  } finally {
    fs.linkSync = originalLinkSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention execution identities avoid unpinned executable and entrypoint pathname rereads', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-closure-consumer-',
  ));
  const originalReadFileSync = fs.readFileSync;
  const entrypointPath = path.join(
    closRoot,
    'src',
    'phd-qualification-control.mjs',
  );
  const forbidden = new Set([
    path.resolve(process.execPath),
    path.resolve(entrypointPath),
  ]);
  let pathnameReadAttempts = 0;
  try {
    fs.readFileSync = function rejectRetentionClosurePathnameRead(target, ...args) {
      if (typeof target === 'string' && forbidden.has(path.resolve(target))) {
        pathnameReadAttempts += 1;
        throw new Error(`forbidden retention closure pathname read: ${target}`);
      }
      return originalReadFileSync.call(this, target, ...args);
    };
    const fixture = persistedWait(root);
    const dryRun = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      dryRun: true,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(pathnameReadAttempts, 0);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer journal recovers from crashes at every installation publication phase', () => {
  for (const crashPhase of [
    'after_pending',
    'after_unit_publication',
    'after_daemon_reload',
    'after_enable_now',
    'after_external_create',
    'after_created',
    'after_inspected',
    'after_installed',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-${crashPhase}-`));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector: (phase) => {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));
      const recovered = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:06:00.000Z',
      });
      assert.equal(recovered.contract.timerInstalled, true, crashPhase);
      assert.equal(recovered.journal.phase, 'installed', crashPhase);
      assert.equal(verifyRetentionTimerJournal({
        journal: recovered.journal,
        contract: recovered.contract,
        signingSecret: secret,
      }), true, crashPhase);
      assert.equal(runtime.installCalls(), 1, crashPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('authenticated pending and created journals repair partial durable activation before and after due', () => {
  for (const journalPhase of ['pending', 'created']) {
    for (const activationState of ['loaded-disabled', 'enabled-inactive']) {
      for (const afterDue of [false, true]) {
        const label = `${journalPhase}-${activationState}-${afterDue ? 'after' : 'before'}-due`;
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-partial-${label}-`));
        try {
          const fixture = persistedWait(root);
          const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
          if (journalPhase === 'created') {
            assert.throws(() => installRetentionResumeTimer({
              contract: fixture.persisted,
              waitPath: fixture.waitPath,
              signingSecret: secret,
              systemctl: '/fake/systemctl',
              commandRunner: runtime.commandRunner,
              now: '2026-07-28T10:05:00.000Z',
              crashInjector: (phase) => {
                if (phase === 'after_created') throw new Error('crash:after_created');
              },
            }), /crash:after_created/, label);
          }
          runtime.setActivationState(activationState);
          runtime.setFireOnEnable(afterDue);
          const recovered = installRetentionResumeTimer({
            contract: fixture.persisted,
            waitPath: fixture.waitPath,
            signingSecret: secret,
            systemctl: '/fake/systemctl',
            commandRunner: runtime.commandRunner,
            now: afterDue
              ? '2026-07-28T11:05:00.000Z'
              : '2026-07-28T10:06:00.000Z',
          });
          assert.equal(recovered.contract.timerInstalled, true, label);
          assert.equal(recovered.contract.timerReleased, false, label);
          assert.equal(recovered.journal.phase, 'installed', label);
          assert.equal(
            runtime.activationState(),
            afterDue ? 'fired' : 'active-waiting',
            label,
          );
          assert.equal(
            runtime.installCalls(),
            journalPhase === 'created' ? 2 : 1,
            label,
          );
          assert.equal(verifyRetentionTimerJournal({
            journal: recovered.journal,
            contract: recovered.contract,
            signingSecret: secret,
          }), true, label);

          if (afterDue) {
            const released = reconcileRetentionResumeTimer({
              contract: recovered.contract,
              waitPath: fixture.waitPath,
              signingSecret: secret,
              systemctl: '/fake/systemctl',
              commandRunner: runtime.commandRunner,
              firingSpecDigest: runtime.specDigest,
              releaseBuilder: exactRelease,
              now: '2026-07-28T11:05:00.000Z',
            });
            assert.equal(released.contract.timerReleased, true, label);
            assert.equal(released.contract.timerFiredAt, fixture.persisted.resumeAt, label);
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
});

test('enable interruption leaves an authenticated partial activation that retries idempotently', () => {
  for (const afterDue of [false, true]) {
    const label = afterDue ? 'after-due' : 'before-due';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-enable-cut-${label}-`));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, {
        installed: false,
        failEnableAfterEffectOnce: true,
        fireOnEnable: afterDue,
      });
      const now = afterDue
        ? '2026-07-28T11:05:00.000Z'
        : '2026-07-28T10:05:00.000Z';
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now,
      }), /durable retention timer activation failed: injected enable interruption/, label);
      assert.equal(runtime.activationState(), 'enabled-inactive', label);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
        false,
        label,
      );

      const recovered = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now,
      });
      assert.equal(recovered.contract.timerInstalled, true, label);
      assert.equal(recovered.contract.timerReleased, false, label);
      assert.equal(runtime.installCalls(), 2, label);
      assert.equal(
        runtime.activationState(),
        afterDue ? 'fired' : 'active-waiting',
        label,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('pending timer publication reconciles idempotently after downtime spans the due time', () => {
  for (const crashPhase of [
    'after_pending',
    'after_unit_publication',
    'after_external_create',
    'after_created',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-downtime-${crashPhase}-`));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector: (phase) => {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));
      runtime.fire('2026-07-28T11:00:00.000Z');
      const reconciled = reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
      });
      assert.equal(reconciled.released, true, crashPhase);
      assert.equal(reconciled.contract.timerReleased, true, crashPhase);
      assert.equal(reconciled.contract.timerFiredAt, fixture.persisted.resumeAt, crashPhase);
      assert.equal(runtime.installCalls(), 1, crashPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('persisted wait crash before initial journal recovers after due only from an actual timer firing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-pre-journal-crash-'));
  try {
    const createdAt = '2026-07-28T10:00:00.000Z';
    const resumeAt = '2026-07-28T11:00:00.000Z';
    const waitPath = path.join(root, 'retention-wait.json');
    const status = signedWaitingStatus({ evaluatedAt: createdAt, nextEligibleAt: resumeAt });
    const wait = buildRetentionWaitContract({
      status,
      statePath: waitPath,
      notifierPath: path.join(root, 'notifier.py'),
      resumeBundlePath: path.join(root, 'resume-bundle.json'),
      releasePath: path.join(root, 'retention-release.json'),
      qualificationSecretPath: path.join(root, 'qualification.hmac'),
      createdAt,
      signingSecret: secret,
    });
    assert.throws(() => persistRetentionWaitContract({
      contract: wait,
      waitPath,
      signingSecret: secret,
      persistedAt: createdAt,
      crashInjector: (phase) => {
        if (phase === 'after_wait_persisted_before_initial_journal') {
          throw new Error(`crash:${phase}`);
        }
      },
    }), /crash:after_wait_persisted_before_initial_journal/);
    const persisted = JSON.parse(fs.readFileSync(waitPath, 'utf8'));
    assert.equal(verifyRetentionWaitContract(persisted, secret), true);
    assert.equal(fs.existsSync(persisted.timerJournalPath), false);

    const runtime = fakeTimerRuntime(persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: persisted,
      waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T11:05:00.000Z',
    });
    assert.equal(installed.contract.timerInstalled, true);
    assert.equal(installed.contract.timerReleased, false);
    assert.equal(installed.journal.phase, 'installed');
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    }), /no exact fired evidence/);

    runtime.fire(resumeAt);
    const recovered = reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerFiredAt, resumeAt);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pending-before-create survives runtime replacement and unrelated accounts without premature due release', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-maintenance-recovery-',
  ));
  try {
    const fixture = persistedWait(root);
    const beforeMaintenance = fakeTimerRuntime(
      fixture.persisted,
      { installed: false },
    );
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: beforeMaintenance.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_pending') throw new Error('crash:after_pending');
      },
    }), /crash:after_pending/);
    assert.equal(beforeMaintenance.installCalls(), 0);

    // A fresh helper/runtime process and an unrelated local account are both
    // legitimate maintenance. The complete databases are still reparsed, so
    // aliases, remaps, shared primary groups, and supplementary membership
    // remain independently rejected by the dedicated-identity test.
    assert.equal(assertRetentionServiceIdentity(
      productionRetentionIdentity,
      {
        identitySourceReader: fakeRetentionIdentityRuntime({
          unrelatedAccount: true,
        }).sourceReader,
      },
    ), true);
    const afterRuntimeReplacement = fakeTimerRuntime(
      fixture.persisted,
      { installed: false, fireOnEnable: true },
    );
    const installedAfterDue = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: afterRuntimeReplacement.commandRunner,
      now: '2026-07-28T11:05:00.000Z',
    });
    assert.equal(installedAfterDue.contract.timerInstalled, true);
    assert.equal(installedAfterDue.contract.timerReleased, false);
    assert.equal(installedAfterDue.journal.phase, 'installed');
    assert.equal(afterRuntimeReplacement.installCalls(), 1);
    assert.equal(fs.existsSync(fixture.releasePath), false);

    assert.throws(() => reconcileRetentionResumeTimer({
      contract: installedAfterDue.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: afterRuntimeReplacement.commandRunner,
      firingSpecDigest: afterRuntimeReplacement.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_fired') throw new Error('crash:after_fired');
      },
    }), /crash:after_fired/);
    assert.equal(fs.existsSync(fixture.releasePath), false);

    const afterPostDueRestart = fakeTimerRuntime(
      installedAfterDue.contract,
      { installed: true, fired: true },
    );
    const recovered = reconcileRetentionResumeTimer({
      contract: installedAfterDue.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: afterPostDueRestart.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:07:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerFiredAt, fixture.persisted.resumeAt);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer reconstructs durable activation after reboot following inspection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-disappeared-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_inspected') throw new Error('crash:after_inspected');
      },
    }), /crash:after_inspected/);
    runtime.remove();
    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.journal.phase, 'installed');
    assert.equal(runtime.installCalls(), 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timer installation persists explicit pending and confirmed phases across every promotion crash cut', () => {
  for (const crashPhase of [
    'after_install_pending',
    'after_install_pending_readback',
    'after_install_pending_manager_reinspection',
    'after_install_confirmed',
    'before_installed_wait_promotion',
    'after_installed',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-install-successor-${crashPhase}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector(phase) {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));
      const interruptedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
      const interruptedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      const confirmed = [
        'after_install_confirmed',
        'before_installed_wait_promotion',
        'after_installed',
      ].includes(crashPhase);
      assert.equal(
        interruptedJournal.phase,
        confirmed ? 'installed' : 'install_pending',
        crashPhase,
      );
      assert.equal(
        interruptedWait.timerInstalled,
        crashPhase === 'after_installed',
        crashPhase,
      );
      assert.equal(verifyRetentionTimerJournal({
        journal: interruptedJournal,
        contract: interruptedWait,
        signingSecret: secret,
      }), true, crashPhase);

      const recovered = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:06:00.000Z',
      });
      assert.equal(recovered.contract.timerInstalled, true, crashPhase);
      assert.equal(recovered.contract.timerReleased, false, crashPhase);
      assert.equal(recovered.journal.phase, 'installed', crashPhase);
      const receipt = recovered.contract.timerInstallationReceipt;
      const installedTransition = recovered.journal.transitions.find(
        (transition) => transition.phase === 'installed',
      );
      assert.deepEqual(
        Object.keys(receipt).sort(),
        [
          'confirmedAt',
          'durableUnitObservationDigest',
          'managerIdentityDigest',
          'managerInspectionDigest',
          'schemaVersion',
          'timerInvocationId',
          'timerSpecDigest',
        ].sort(),
        crashPhase,
      );
      assert.equal(
        receipt.schemaVersion,
        'cortex.learning_os.retention_timer_installation_receipt.v3',
        crashPhase,
      );
      assert.equal(
        receipt.timerInvocationId,
        installedTransition.evidence.inspection.timer.InvocationID,
        crashPhase,
      );
      assert.deepEqual(
        installedTransition.evidence.installationReceipt,
        receipt,
        crashPhase,
      );
      assert.equal(
        installedTransition.evidence.installedWaitDigest,
        sha256Text(canonicalJson(recovered.contract)),
        crashPhase,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('installed-wait CAS keeps the exact predecessor pinned through successor commit', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-installed-cas-predecessor-'));
  const originalReadFileSync = fs.readFileSync;
  const originalReadSync = fs.readSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const selected = fs.statSync(fixture.waitPath, { bigint: true });
    const competingBytes = Buffer.from('{"competingSuccessor":true}\n', 'utf8');
    let armed = false;
    let attacked = false;
    const selectedDescriptor = (descriptor) => {
      if (!Number.isInteger(descriptor)) return false;
      try {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        return stat.dev === selected.dev && stat.ino === selected.ino;
      } catch {
        return false;
      }
    };
    const replacePinnedPredecessor = () => {
      if (!armed || attacked) return;
      attacked = true;
      fs.writeFileSync(fixture.waitPath, competingBytes);
    };
    fs.readFileSync = function replaceAfterCopiedPredecessor(target, ...args) {
      const bytes = originalReadFileSync.call(this, target, ...args);
      if (selectedDescriptor(target)) replacePinnedPredecessor();
      return bytes;
    };
    fs.readSync = function replaceDuringPinnedPredecessor(
      descriptor,
      buffer,
      offset,
      length,
      position,
    ) {
      const count = originalReadSync.call(
        this,
        descriptor,
        buffer,
        offset,
        length,
        position,
      );
      if (count > 0 && selectedDescriptor(descriptor)) {
        replacePinnedPredecessor();
      }
      return count;
    };
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'before_installed_wait_promotion') armed = true;
      },
    }), /publication predecessor changed during its descriptor-pinned publication read/);
    assert.equal(armed, true);
    assert.equal(attacked, true);
    assert.deepEqual(fs.readFileSync(fixture.waitPath), competingBytes);
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(
      invalidatedJournal.transitions.at(-1).evidence.reason,
      'promotion_outcome_unobservable',
    );
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: fixture.persisted,
      signingSecret: secret,
    }), true);

    fs.readFileSync = originalReadFileSync;
    fs.readSync = originalReadSync;
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(fixture.persisted, null, 2)}\n`,
    );
    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const recovered = recover();
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.readSync = originalReadSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed-wait CAS classifies a committed successor whose first readback fails', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-installed-cas-readback-',
  ));
  const originalOpenSync = fs.openSync;
  const originalRenameSync = fs.renameSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const waitName = path.basename(fixture.waitPath);
    let promotionCommitted = false;
    let readbackRejected = false;
    fs.renameSync = function observeInstalledPromotion(source, target) {
      const result = originalRenameSync.call(this, source, target);
      if (path.basename(String(target)) === waitName
          && path.basename(String(source)).startsWith(`.${waitName}.`)) {
        promotionCommitted = true;
      }
      return result;
    };
    fs.openSync = function rejectFirstInstalledReadback(target, ...args) {
      if (promotionCommitted
          && !readbackRejected
          && path.basename(String(target)) === waitName) {
        readbackRejected = true;
        throw Object.assign(
          new Error('injected installed successor readback failure'),
          { code: 'EIO' },
        );
      }
      return originalOpenSync.call(this, target, ...args);
    };
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    }), /injected installed successor readback failure/);
    assert.equal(promotionCommitted, true);
    assert.equal(readbackRejected, true);

    fs.openSync = originalOpenSync;
    fs.renameSync = originalRenameSync;
    const installedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(installedWait.timerInstalled, true);
    assert.equal(installedWait.timerReleased, false);
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(
      invalidatedJournal.transitions.at(-1).evidence.reason,
      'post_promotion_authority_revalidation_failed',
    );
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: installedWait,
      signingSecret: secret,
    }), true);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installedWait,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    }), /timer is not durably installed/);

    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const recovered = recover();
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.contract.timerInstallationRevision, 1);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.openSync = originalOpenSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repair-wait CAS preserves an explicit invalidation when promotion is unobservable', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-repair-cas-unobservable-',
  ));
  const originalReadSync = fs.readSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const installedGeneration = runtime.managerGeneration();
    let invalidated = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:30.000Z',
      crashInjector(phase) {
        if (!invalidated
            && phase === 'after_installed_successor_authority_consumption') {
          invalidated = true;
          runtime.rotateManagerGeneration();
        }
      },
    }), /manager changed across the protected installed authority handoff/);
    assert.equal(invalidated, true);
    runtime.restoreManagerGeneration(installedGeneration);

    const beginRepair = () => installRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(beginRepair, /repair successor recorded and retry is required/);
    assert.equal(JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    )).phase, 'install_repair');

    const selected = fs.statSync(fixture.waitPath, { bigint: true });
    const foreignBytes = Buffer.from('{"foreignRepairSuccessor":true}\n', 'utf8');
    let armed = false;
    let attacked = false;
    fs.readSync = function replaceRepairPredecessor(
      descriptor,
      buffer,
      offset,
      length,
      position,
    ) {
      const count = originalReadSync.call(
        this,
        descriptor,
        buffer,
        offset,
        length,
        position,
      );
      if (armed && !attacked && count > 0) {
        try {
          const stat = fs.fstatSync(descriptor, { bigint: true });
          if (stat.dev === selected.dev && stat.ino === selected.ino) {
            attacked = true;
            fs.writeFileSync(fixture.waitPath, foreignBytes);
          }
        } catch {}
      }
      return count;
    };
    assert.throws(() => installRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:30.000Z',
      crashInjector(phase) {
        if (phase === 'before_installed_wait_promotion') armed = true;
      },
    }), /publication predecessor changed during its descriptor-pinned publication read/);
    assert.equal(armed, true);
    assert.equal(attacked, true);
    const unknownJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(unknownJournal.phase, 'install_invalidated');
    assert.equal(
      unknownJournal.transitions.at(-1).evidence.reason,
      'promotion_outcome_unobservable',
    );

    fs.readSync = originalReadSync;
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(installed.contract, null, 2)}\n`,
    );
    const recover = () => installRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:07:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const recovered = recover();
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.contract.timerInstallationRevision, 1);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.readSync = originalReadSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timer installation rejects a hybrid manager inspection and retries from its signed phase', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-manager-snapshot-drift-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    let armed = false;
    let rotated = false;
    const commandRunner = (command, argv, options) => {
      const result = runtime.commandRunner(command, argv, options);
      if (armed && command === '/fake/busctl') {
        armed = false;
        rotated = true;
        runtime.rotateManagerGeneration();
      }
      return result;
    };
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'before_install_pending_manager_inspection') {
          armed = true;
        }
      },
    }), /manager changed during one coherent inspection/);
    assert.equal(rotated, true);
    assert.equal(
      JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      )).phase,
      'inspected',
    );
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );

    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.journal.phase, 'installed');
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed waits consume the exact manager and pinned-unit receipt from the journal', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-installed-receipt-binding-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.equal(verifyRetentionWaitContract(installed.contract, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: installed.journal,
      contract: installed.contract,
      signingSecret: secret,
    }), true);

    const detachedWait = structuredClone(installed.contract);
    detachedWait.timerInstallationReceipt.managerIdentityDigest = '0'.repeat(64);
    const signedDetachedWait = resign(detachedWait);
    assert.equal(verifyRetentionWaitContract(signedDetachedWait, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: installed.journal,
      contract: signedDetachedWait,
      signingSecret: secret,
    }), false);
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(signedDetachedWait, null, 2)}\n`,
    );
    assert.throws(() => installRetentionResumeTimer({
      contract: signedDetachedWait,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    }), /timer journal is stale, tampered, or inconsistent/);

    const detachedJournal = structuredClone(installed.journal);
    detachedJournal.transitions.find(
      (transition) => transition.phase === 'installed',
    ).evidence.installationReceipt.managerInspectionDigest = 'f'.repeat(64);
    const signedDetachedJournal = resignTimerJournal(detachedJournal);
    assert.equal(verifyRetentionTimerJournal({
      journal: signedDetachedJournal,
      contract: installed.contract,
      signingSecret: secret,
    }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timer installation fails closed on manager removal or activation drift across installed promotion', () => {
  for (const attack of [
    'manager-removal',
    'activation-drift',
    'confirmed-manager-removal',
    'confirmed-unit-removal',
    'post-promotion-manager-removal',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-install-manager-${attack}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      let attacked = false;
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector(phase) {
          const boundary = {
            'manager-removal': 'after_install_pending_readback',
            'activation-drift': 'after_install_pending_manager_reinspection',
            'confirmed-manager-removal': 'after_install_confirmed',
            'confirmed-unit-removal': 'after_install_confirmed',
            'post-promotion-manager-removal':
              'after_installed_wait_promotion_before_manager_reinspection',
          }[attack];
          if (phase !== boundary || attacked) return;
          attacked = true;
          if (attack === 'confirmed-unit-removal') {
            fs.unlinkSync(path.join(
              root,
              '.retention-systemd-units',
              `${runtime.unitBase}.service`,
            ));
          } else if (attack.includes('manager-removal')) runtime.remove();
          else runtime.setActivationState('enabled-inactive');
        },
      }), /durable retention timer unit|manager changed across installed successor boundary|manager identity or activation changed (?:before|across) installed promotion/);
      assert.equal(attacked, true, attack);
      const interruptedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
      const interruptedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(
        interruptedWait.timerInstalled,
        attack === 'post-promotion-manager-removal',
        attack,
      );
      assert.equal(
        interruptedJournal.phase,
        attack === 'manager-removal'
          ? 'install_pending'
          : 'install_invalidated',
        attack,
      );
      if (attack !== 'manager-removal') {
        assert.equal(verifyRetentionTimerJournal({
          journal: interruptedJournal,
          contract: interruptedWait,
          signingSecret: secret,
        }), true, attack);
        assert.equal(
          interruptedJournal.transitions.at(-1).evidence.reason,
          attack === 'post-promotion-manager-removal'
            ? 'post_promotion_authority_revalidation_failed'
            : 'pre_promotion_authority_revalidation_failed',
          attack,
        );
        const wrongBoundary = structuredClone(interruptedJournal);
        wrongBoundary.transitions.at(-1).evidence.reason =
          attack === 'post-promotion-manager-removal'
            ? 'pre_promotion_authority_revalidation_failed'
            : 'post_promotion_authority_revalidation_failed';
        assert.equal(verifyRetentionTimerJournal({
          journal: resignTimerJournal(wrongBoundary),
          contract: interruptedWait,
          signingSecret: secret,
        }), false, `${attack}:invalidation boundary`);
      }
      if (attack === 'post-promotion-manager-removal') {
        let releaseBuilt = false;
        assert.throws(() => processRetentionResumeTimerFiring({
          contract: interruptedWait,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: runtime.commandRunner,
          firingSpecDigest: runtime.specDigest,
          releaseBuilder(firedAt) {
            releaseBuilt = true;
            return exactRelease(firedAt);
          },
          now: '2026-07-28T11:05:00.000Z',
        }), /timer is not durably installed/);
        assert.equal(releaseBuilt, false);
        assert.equal(fs.existsSync(fixture.releasePath), false);
      }

      const recover = () => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:06:00.000Z',
      });
      let recovered;
      try {
        recovered = recover();
      } catch (error) {
        if (!/repair successor recorded and retry is required/.test(
          String(error.message),
        )) throw error;
        recovered = recover();
      }
      assert.equal(recovered.contract.timerInstalled, true, attack);
      if (attack === 'post-promotion-manager-removal') {
        assert.equal(recovered.journal.phase, 'install_repair', attack);
        assert.equal(recovered.contract.timerInstallationRevision, 1, attack);
        assert.equal(
          recovered.contract.supersededInstalledWaitDigest,
          sha256Text(canonicalJson(interruptedWait)),
          attack,
        );
        assert.equal(verifyRetentionTimerJournal({
          journal: recovered.journal,
          contract: recovered.contract,
          signingSecret: secret,
        }), true, attack);
      } else {
        assert.ok(
          ['installed', 'install_repair'].includes(recovered.journal.phase),
          attack,
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('confirmed timer installation cannot promote a different manager generation on retry', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-generation-retry-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_install_confirmed') {
          throw new Error('crash:after_install_confirmed');
        }
      },
    }), /crash:after_install_confirmed/);
    const confirmedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(confirmedJournal.phase, 'installed');
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );

    runtime.rotateManagerGeneration();
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    }), /repair successor recorded and retry is required/);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    const repairJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(repairJournal.phase, 'install_repair');
    assert.equal(
      repairJournal.transitions.at(-1).evidence
        .supersededInstallationReceiptDigest,
      sha256Text(canonicalJson(
        confirmedJournal.transitions.at(-1).evidence.installationReceipt,
      )),
    );

    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:07:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(verifyRetentionWaitContract(recovered.contract, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);

    runtime.fire(fixture.persisted.resumeAt);
    const released = processRetentionResumeTimerFiring({
      contract: recovered.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    });
    assert.equal(released.contract.timerReleased, true);
    assert.equal(released.journal.phase, 'released');
    assert.equal(verifyRetentionTimerJournal({
      journal: released.journal,
      contract: released.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy timer installation receipts require a generation-bound repair before retry success', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-legacy-generation-upgrade-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const legacyJournal = structuredClone(installed.journal);
    const installedTransition = legacyJournal.transitions.find(
      (transition) => transition.phase === 'installed',
    );
    const legacyReceipt = structuredClone(
      installedTransition.evidence.installationReceipt,
    );
    legacyReceipt.schemaVersion
      = 'cortex.learning_os.retention_timer_installation_receipt.v1';
    delete legacyReceipt.timerInvocationId;
    legacyReceipt.managerIdentityDigest = legacyTimerManagerIdentityDigest(
      installedTransition.evidence.inspection,
    );
    installedTransition.evidence.installationReceipt = legacyReceipt;

    const legacyWait = structuredClone(installed.contract);
    legacyWait.timerInstallationReceipt = structuredClone(legacyReceipt);
    const signedLegacyWait = resign(legacyWait);
    installedTransition.evidence.installedWaitDigest = digest(signedLegacyWait);
    const signedLegacyJournal = resignTimerJournal(legacyJournal);
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(signedLegacyWait, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      fixture.persisted.timerJournalPath,
      `${JSON.stringify(signedLegacyJournal, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.equal(verifyRetentionWaitContract(signedLegacyWait, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: signedLegacyJournal,
      contract: signedLegacyWait,
      signingSecret: secret,
    }), true);

    runtime.rotateManagerGeneration();
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    }), /repair successor recorded and retry is required/);
    const repairJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(repairJournal.phase, 'install_repair');
    assert.equal(
      repairJournal.transitions.at(-1).evidence.installationReceipt.schemaVersion,
      'cortex.learning_os.retention_timer_installation_receipt.v3',
    );
    assert.equal(
      repairJournal.transitions.at(-1).evidence
        .supersededInstallationReceiptDigest,
      digest(legacyReceipt),
    );

    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:07:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(
      recovered.contract.timerInstallationReceipt.schemaVersion,
      'cortex.learning_os.retention_timer_installation_receipt.v3',
    );
    assert.equal(recovered.contract.timerInstallationRevision, 1);
    assert.equal(
      recovered.contract.supersededInstalledWaitDigest,
      digest(signedLegacyWait),
    );
    assert.equal(verifyRetentionWaitContract(recovered.contract, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('opaque generation-bound installation receipts upgrade to an explicit manager token', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-explicit-generation-upgrade-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const opaqueJournal = structuredClone(installed.journal);
    const installedTransition = opaqueJournal.transitions.find(
      (transition) => transition.phase === 'installed',
    );
    const opaqueReceipt = structuredClone(
      installedTransition.evidence.installationReceipt,
    );
    opaqueReceipt.schemaVersion
      = 'cortex.learning_os.retention_timer_installation_receipt.v2';
    delete opaqueReceipt.timerInvocationId;
    installedTransition.evidence.installationReceipt = opaqueReceipt;

    const opaqueWait = structuredClone(installed.contract);
    opaqueWait.timerInstallationReceipt = structuredClone(opaqueReceipt);
    const signedOpaqueWait = resign(opaqueWait);
    installedTransition.evidence.installedWaitDigest = digest(signedOpaqueWait);
    const signedOpaqueJournal = resignTimerJournal(opaqueJournal);
    assert.equal(verifyRetentionWaitContract(signedOpaqueWait, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: signedOpaqueJournal,
      contract: signedOpaqueWait,
      signingSecret: secret,
    }), true);
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(signedOpaqueWait, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      fixture.persisted.timerJournalPath,
      `${JSON.stringify(signedOpaqueJournal, null, 2)}\n`,
      { mode: 0o600 },
    );

    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    }), /repair successor recorded and retry is required/);
    const repairJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    const repair = repairJournal.transitions.at(-1);
    assert.equal(repair.phase, 'install_repair');
    assert.equal(
      repair.evidence.installationReceipt.schemaVersion,
      'cortex.learning_os.retention_timer_installation_receipt.v3',
    );
    assert.equal(
      repair.evidence.installationReceipt.timerInvocationId,
      repair.evidence.inspection.timer.InvocationID,
    );
    assert.equal(
      repair.evidence.supersededInstallationReceiptDigest,
      digest(opaqueReceipt),
    );
    const substitutedGeneration = structuredClone(repairJournal);
    substitutedGeneration.transitions.at(-1)
      .evidence.installationReceipt.timerInvocationId = '0'.repeat(32);
    assert.equal(verifyRetentionTimerJournal({
      journal: resignTimerJournal(substitutedGeneration),
      contract: signedOpaqueWait,
      signingSecret: secret,
    }), false);

    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:07:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.contract.timerReleased, false);
    assert.equal(recovered.journal.phase, 'install_repair');
    assert.equal(
      recovered.contract.timerInstallationReceipt.timerInvocationId,
      runtime.timerInvocationId(),
    );
    assert.equal(verifyRetentionWaitContract(recovered.contract, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('final unit-close drift invalidates the promoted wait and requires a CAS-linked repair', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-final-unit-close-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const servicePath = path.join(
      root,
      '.retention-systemd-units',
      `${runtime.unitBase}.service`,
    );
    let removed = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (removed
            || phase
              !== 'after_durable_unit_return_witness_descriptor_release_before_confirmation') {
          return;
        }
        removed = true;
        fs.unlinkSync(servicePath);
      },
    }), /durable retention timer unit/);
    assert.equal(removed, true);
    const interruptedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(interruptedWait.timerInstalled, true);
    assert.equal(interruptedWait.timerReleased, false);
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: interruptedWait,
      signingSecret: secret,
    }), true);

    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const repaired = recover();
    assert.equal(repaired.contract.timerInstalled, true);
    assert.equal(repaired.contract.timerReleased, false);
    assert.equal(repaired.contract.timerInstallationRevision, 1);
    assert.equal(
      repaired.contract.supersededInstalledWaitDigest,
      sha256Text(canonicalJson(interruptedWait)),
    );
    assert.equal(repaired.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: repaired.contract,
      signingSecret: secret,
    }), true);
    const detachedRevision = resign({
      ...repaired.contract,
      timerInstallationRevision: 2,
    });
    assert.equal(verifyRetentionWaitContract(detachedRevision, secret), true);
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: detachedRevision,
      signingSecret: secret,
    }), false);
    const detachedJournal = structuredClone(repaired.journal);
    detachedJournal.transitions.at(-1).evidence.supersededInstalledWaitDigest
      = '0'.repeat(64);
    assert.equal(verifyRetentionTimerJournal({
      journal: resignTimerJournal(detachedJournal),
      contract: repaired.contract,
      signingSecret: secret,
    }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unit drift after installed authority consumption invalidates promotion before the final pin is released', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-post-handoff-unit-drift-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const timerPath = path.join(
      root,
      '.retention-systemd-units',
      `${runtime.unitBase}.timer`,
    );
    let removed = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (removed
            || phase !== 'after_durable_unit_pinned_authority_handoff') {
          return;
        }
        removed = true;
        fs.unlinkSync(timerPath);
      },
    }), /durable retention timer unit/);
    assert.equal(removed, true);
    const interruptedWait = JSON.parse(fs.readFileSync(
      fixture.waitPath,
      'utf8',
    ));
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(interruptedWait.timerInstalled, true);
    assert.equal(interruptedWait.timerReleased, false);
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: interruptedWait,
      signingSecret: secret,
    }), true);

    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const repaired = recover();
    assert.equal(repaired.contract.timerInstalled, true);
    assert.equal(repaired.contract.timerReleased, false);
    assert.equal(repaired.contract.timerInstallationRevision, 1);
    assert.equal(repaired.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: repaired.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manager removal at the final pinned-unit handoff invalidates the promoted wait', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-final-manager-handoff-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    let removed = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (removed
            || phase
              !== 'after_durable_unit_return_witness_descriptor_release_before_confirmation') {
          return;
        }
        removed = true;
        runtime.remove();
      },
    }), /manager changed across installed successor boundary/);
    assert.equal(removed, true);
    const interruptedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(interruptedWait.timerInstalled, true);
    assert.equal(interruptedWait.timerReleased, false);
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: interruptedWait,
      signingSecret: secret,
    }), true);

    runtime.setActivationState('enabled-inactive');
    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const repaired = recover();
    assert.equal(repaired.contract.timerInstalled, true);
    assert.equal(repaired.contract.timerReleased, false);
    assert.equal(repaired.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: repaired.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manager generation drift after the installed handoff inspection invalidates promotion', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-post-handoff-manager-drift-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    let attacked = false;
    let authenticatedGeneration = null;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (attacked
            || phase
              !== 'after_installed_authority_handoff_manager_inspection') {
          return;
        }
        attacked = true;
        authenticatedGeneration = runtime.managerGeneration();
        runtime.rotateManagerGeneration();
      },
    }), /manager changed across the protected installed authority handoff/);
    assert.equal(attacked, true);
    const interruptedWait = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(interruptedWait.timerInstalled, true);
    assert.equal(interruptedWait.timerReleased, false);
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: interruptedWait,
      signingSecret: secret,
    }), true);

    runtime.restoreManagerGeneration(authenticatedGeneration);
    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const repaired = recover();
    assert.equal(repaired.contract.timerInstalled, true);
    assert.equal(repaired.contract.timerReleased, false);
    assert.equal(repaired.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: repaired.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed successor rollback during the final pinned handoff is invalidated and repairable', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-install-successor-rollback-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    let installedWaitBytes = null;
    let rolledBack = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (rolledBack
            || phase !== 'after_installed_authority_handoff_manager_inspection') {
          return;
        }
        installedWaitBytes = fs.readFileSync(fixture.waitPath);
        assert.equal(
          JSON.parse(installedWaitBytes.toString('utf8')).timerInstalled,
          true,
        );
        rolledBack = true;
        fs.writeFileSync(
          fixture.waitPath,
          `${JSON.stringify(fixture.persisted, null, 2)}\n`,
        );
      },
    }), /installed wait successor changed before protected authority consumption/);
    assert.equal(rolledBack, true);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    const invalidatedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    const interruptedInstalledWait = JSON.parse(
      installedWaitBytes.toString('utf8'),
    );
    assert.equal(invalidatedJournal.phase, 'install_invalidated');
    assert.equal(verifyRetentionTimerJournal({
      journal: invalidatedJournal,
      contract: interruptedInstalledWait,
      signingSecret: secret,
    }), true);

    fs.writeFileSync(fixture.waitPath, installedWaitBytes);
    const recover = () => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.throws(recover, /repair successor recorded and retry is required/);
    const repaired = recover();
    assert.equal(repaired.contract.timerInstalled, true);
    assert.equal(repaired.contract.timerReleased, false);
    assert.equal(repaired.contract.timerInstallationRevision, 1);
    assert.equal(repaired.journal.phase, 'install_repair');
    assert.equal(verifyRetentionTimerJournal({
      journal: repaired.journal,
      contract: repaired.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable retention units recover across reboot cut points without time-based release', () => {
  for (const crashPhase of ['after_pending', 'after_created', 'after_inspected']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-reboot-${crashPhase}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector: (phase) => {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));
      runtime.remove();
      const recovered = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:10:00.000Z',
      });
      assert.equal(recovered.contract.timerInstalled, true, crashPhase);
      assert.equal(recovered.contract.timerReleased, false, crashPhase);
      assert.equal(recovered.journal.phase, 'installed', crashPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-reboot-due-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.remove();
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    }), /repair successor recorded and retry is required/);
    const rebootRepair = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(rebootRepair.phase, 'install_repair');
    assert.equal(
      rebootRepair.transitions.at(-1).evidence.supersededInstalledWaitDigest,
      sha256Text(canonicalJson(installed.contract)),
    );
    runtime.setActivationState('enabled-inactive');
    runtime.fire('2026-07-28T11:00:30.000Z');
    const released = reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    });
    assert.equal(released.contract.timerFiredAt, '2026-07-28T11:00:30.000Z');
    assert.equal(released.contract.timerReleased, true);

    const beforeReleaseRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'clos-retention-reboot-before-release-'),
    );
    try {
      const beforeRelease = persistedWait(beforeReleaseRoot);
      const beforeReleaseRuntime = fakeTimerRuntime(
        beforeRelease.persisted,
        { installed: false },
      );
      const beforeReleaseInstalled = installRetentionResumeTimer({
        contract: beforeRelease.persisted,
        waitPath: beforeRelease.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: beforeReleaseRuntime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      beforeReleaseRuntime.fire();
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: beforeReleaseInstalled.contract,
        waitPath: beforeRelease.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: beforeReleaseRuntime.commandRunner,
        firingSpecDigest: beforeReleaseRuntime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:00:00.000Z',
        crashInjector: (phase) => {
          if (phase === 'after_fired') throw new Error('crash:after_fired');
        },
      }), /crash:after_fired/);
      beforeReleaseRuntime.remove();
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: beforeReleaseInstalled.contract,
        waitPath: beforeRelease.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: beforeReleaseRuntime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:00:30.000Z',
      }), /manager firing changed.*absent from the current manager/);
      beforeReleaseRuntime.setActivationState('enabled-inactive');
      beforeReleaseRuntime.fire();
      const resumedRelease = reconcileRetentionResumeTimer({
        contract: beforeReleaseInstalled.contract,
        waitPath: beforeRelease.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: beforeReleaseRuntime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:01:00.000Z',
      });
      assert.equal(resumedRelease.contract.timerReleased, true);
      assert.equal(resumedRelease.contract.timerFiredAt, beforeRelease.persisted.resumeAt);
    } finally {
      fs.rmSync(beforeReleaseRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable retention unit bytes, modes, and no-follow publication fail closed', () => {
  for (const mutation of ['bytes', 'mode', 'symlink']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-unit-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector: (phase) => {
          if (phase === 'after_unit_publication') {
            throw new Error('crash:after_unit_publication');
          }
        },
      }), /crash:after_unit_publication/);
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const servicePath = path.join(unitDirectory, `${runtime.unitBase}.service`);
      const timerPath = path.join(unitDirectory, `${runtime.unitBase}.timer`);
      const serviceBytes = fs.readFileSync(servicePath, 'utf8');
      const timerBytes = fs.readFileSync(timerPath, 'utf8');
      assert.match(serviceBytes, /^CollectMode=inactive$/m);
      assert.match(serviceBytes, /^NoNewPrivileges=true$/m);
      assert.match(serviceBytes, /^ProtectSystem=strict$/m);
      assert.match(timerBytes, /^Persistent=true$/m);
      assert.match(timerBytes, /^OnCalendar=2026-07-28 11:00:00 UTC$/m);
      assert.match(timerBytes, /^WantedBy=timers[.]target$/m);
      assert.doesNotMatch(`${serviceBytes}\n${timerBytes}`, /Transient=/);
      if (mutation === 'bytes') {
        fs.appendFileSync(servicePath, '# substituted\n');
      } else if (mutation === 'mode') {
        fs.chmodSync(servicePath, 0o4644);
      } else {
        fs.unlinkSync(timerPath);
        fs.symlinkSync(servicePath, timerPath);
      }
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:06:00.000Z',
      }), /durable retention timer unit|ELOOP/);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('retention installation rejects every applicable dormant durable drop-in path', () => {
  for (const dropInKind of [
    'exact-service',
    'exact-timer',
    'prefix-service',
    'prefix-timer',
    'type-service',
    'type-timer',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-dormant-${dropInKind}-drop-in-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const unitKind = dropInKind.endsWith('service') ? 'service' : 'timer';
      const dropInName = dropInKind.startsWith('exact')
        ? `${runtime.unitBase}.${unitKind}.d`
        : dropInKind.startsWith('prefix')
          ? `clos-.${unitKind}.d`
          : `${unitKind}.d`;
      let inserted = false;
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector(phase) {
          if (phase !== 'after_unit_publication' || inserted) return;
          inserted = true;
          fs.mkdirSync(path.join(
            root,
            '.retention-systemd-units',
            dropInName,
          ), { mode: 0o700 });
        },
      }), /durable retention timer unit drop-in path must be absent/, dropInKind);
      assert.equal(inserted, true, dropInKind);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
        false,
        dropInKind,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, dropInKind);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due recovery upgrades exact legacy v3 through v8 durable-unit observations', () => {
  for (const legacyVersion of [3, 4, 5, 6, 7, 8]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-legacy-v${legacyVersion}-unit-observation-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      const legacyJournal = structuredClone(installed.journal);
      const inspected = legacyJournal.transitions.find(
        (transition) => transition.phase === 'inspected',
      );
      const observation = downgradeDurableUnitObservation(
        inspected.evidence.durableUnitObservation,
        legacyVersion,
      );
      inspected.evidence.durableUnitObservationDigest
        = observation.observationDigest;
      const installPending = legacyJournal.transitions.find(
        (transition) => transition.phase === 'install_pending',
      );
      installPending.evidence.durableUnitObservation = structuredClone(observation);
      installPending.evidence.durableUnitObservationDigest
        = observation.observationDigest;
      const installedTransition = legacyJournal.transitions.find(
        (transition) => transition.phase === 'installed',
      );
      const legacyContract = bindInstalledContractToDurableObservation(
        installed,
        legacyJournal,
        observation,
      );
      const signedLegacyJournal = resignTimerJournal(legacyJournal);
      assert.equal(installedTransition.evidence.installedWaitDigest,
        sha256Text(canonicalJson(legacyContract)));
      assert.equal(verifyRetentionTimerJournal({
        journal: signedLegacyJournal,
        contract: legacyContract,
        signingSecret: secret,
      }), true, `legacy v${legacyVersion}`);
      fs.writeFileSync(
        fixture.persisted.timerJournalPath,
        `${JSON.stringify(signedLegacyJournal, null, 2)}\n`,
      );
      fs.writeFileSync(
        fixture.waitPath,
        `${JSON.stringify(legacyContract, null, 2)}\n`,
      );
      runtime.fire(fixture.persisted.resumeAt);
      const released = processRetentionResumeTimerFiring({
        contract: legacyContract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
      });
      assert.equal(released.released, true, `legacy v${legacyVersion}`);
      assert.equal(
        released.journal.transitions.find(
          (transition) => transition.phase === 'inspected',
        ).evidence.durableUnitObservation.schemaVersion,
        `cortex.learning_os.retention_durable_unit_observation.v${legacyVersion}`,
      );
      assert.equal(
        released.journal.transitions.find(
          (transition) => transition.phase === 'fired',
        ).evidence.durableUnitObservation.schemaVersion,
        'cortex.learning_os.retention_durable_unit_observation.v9',
      );
      assert.equal(verifyRetentionTimerJournal({
        journal: released.journal,
        contract: released.contract,
        signingSecret: secret,
      }), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('legacy v4 recovery rejects a newly populated prefix drop-in with cached manager state', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-legacy-prefix-drop-in-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const unitDirectory = path.join(root, '.retention-systemd-units');
    const prefixDropIn = path.join(unitDirectory, 'clos-.service.d');
    fs.mkdirSync(prefixDropIn, { mode: 0o700 });
    const legacyJournal = structuredClone(installed.journal);
    const inspected = legacyJournal.transitions.find(
      (transition) => transition.phase === 'inspected',
    );
    const observation = downgradeDurableUnitObservation(
      inspected.evidence.durableUnitObservation,
      4,
    );
    observation.directory.nlink = fs.statSync(
      unitDirectory,
      { bigint: true },
    ).nlink.toString();
    observation.dropIns = {
      servicePath: `${observation.service.path}.d`,
      serviceAbsent: true,
      timerPath: `${observation.timer.path}.d`,
      timerAbsent: true,
    };
    const {
      observationDigest: _observationDigest,
      ...observationPayload
    } = observation;
    observation.observationDigest = sha256Text(canonicalJson(observationPayload));
    inspected.evidence.durableUnitObservationDigest
      = observation.observationDigest;
    const installPending = legacyJournal.transitions.find(
      (transition) => transition.phase === 'install_pending',
    );
    installPending.evidence.durableUnitObservation = structuredClone(observation);
    installPending.evidence.durableUnitObservationDigest
      = observation.observationDigest;
    const legacyContract = bindInstalledContractToDurableObservation(
      installed,
      legacyJournal,
      observation,
    );
    const signedLegacyJournal = resignTimerJournal(legacyJournal);
    assert.equal(verifyRetentionTimerJournal({
      journal: signedLegacyJournal,
      contract: legacyContract,
      signingSecret: secret,
    }), true);
    fs.writeFileSync(
      fixture.persisted.timerJournalPath,
      `${JSON.stringify(signedLegacyJournal, null, 2)}\n`,
    );
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(legacyContract, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(prefixDropIn, '10-hostile.conf'),
      '[Service]\nExecStart=\nExecStart=/bin/false\n',
      { mode: 0o600 },
    );
    runtime.fire(fixture.persisted.resumeAt);
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: legacyContract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
    }), /durable retention timer unit drop-in path must be absent/);
    assert.equal(releaseBuilt, false);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      Buffer.from(`${JSON.stringify(signedLegacyJournal, null, 2)}\n`),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated fired journals require directory-metadata-bound v9 observations', () => {
  for (const legacyVersion of [3, 4, 5, 6, 7, 8]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-legacy-v${legacyVersion}-fired-observation-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase === 'after_fired') throw new Error('crash:after-fired');
        },
      }), /crash:after-fired/);
      const legacyFiredJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(legacyFiredJournal.phase, 'fired');
      const fired = legacyFiredJournal.transitions.find(
        (transition) => transition.phase === 'fired',
      );
      const observation = downgradeDurableUnitObservation(
        fired.evidence.durableUnitObservation,
        legacyVersion,
      );
      fired.evidence.durableUnitObservationDigest
        = observation.observationDigest;
      const signedLegacyFiredJournal = resign(legacyFiredJournal);
      assert.equal(verifyRetentionTimerJournal({
        journal: signedLegacyFiredJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), false, `legacy v${legacyVersion}`);
      fs.writeFileSync(
        fixture.persisted.timerJournalPath,
        `${JSON.stringify(signedLegacyFiredJournal, null, 2)}\n`,
      );
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      }), /journal is stale, tampered, or inconsistent/);
      assert.equal(fs.existsSync(fixture.releasePath), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due firing binds descriptor mount access instead of trusting a unit mount ID alone', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-mount-access-',
  ));
  const originalReadFileSync = fs.readFileSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const inspectedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    const inspected = installed.journal.transitions.find(
      (transition) => transition.phase === 'inspected',
    );
    const mountId = inspected.evidence.durableUnitObservation.directory.mountId;
    let mountAccessSubstituted = false;
    fs.readFileSync = function substituteUnitMountAccess(target, ...rest) {
      const bytes = originalReadFileSync.call(fs, target, ...rest);
      if (String(target) !== '/proc/self/mountinfo') return bytes;
      assert.equal(Buffer.isBuffer(bytes), true);
      const lines = bytes.toString('utf8').split('\n');
      const index = lines.findIndex((line) => line.startsWith(`${mountId} `));
      assert.notEqual(index, -1);
      const separator = lines[index].indexOf(' - ');
      const fields = lines[index].slice(0, separator).split(' ');
      fields[4] = 'relative/hostile-unit-mount';
      lines[index] = `${fields.join(' ')}${lines[index].slice(separator)}`;
      mountAccessSubstituted = true;
      return Buffer.from(lines.join('\n'));
    };
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
    }), /descriptor mount point is not absolute/);
    assert.equal(mountAccessSubstituted, true);
    assert.equal(releaseBuilt, false);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      inspectedJournalBytes,
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('due firing revalidates descriptor mount access across its pinned commit', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-mount-access-commit-',
  ));
  const originalReadFileSync = fs.readFileSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const inspectedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    const inspected = installed.journal.transitions.find(
      (transition) => transition.phase === 'inspected',
    );
    const mountId = inspected.evidence.durableUnitObservation.directory.mountId;
    let mountAccessReads = 0;
    let mountAccessChanged = false;
    fs.readFileSync = function changeUnitMountAccessAfterObservation(target, ...rest) {
      const bytes = originalReadFileSync.call(fs, target, ...rest);
      if (String(target) !== '/proc/self/mountinfo') return bytes;
      mountAccessReads += 1;
      if (mountAccessReads === 1) return bytes;
      assert.equal(Buffer.isBuffer(bytes), true);
      const lines = bytes.toString('utf8').split('\n');
      const index = lines.findIndex((line) => line.startsWith(`${mountId} `));
      assert.notEqual(index, -1);
      const separator = lines[index].indexOf(' - ');
      const fields = lines[index].slice(0, separator).split(' ');
      const options = fields[5].split(',');
      const readOnly = options.indexOf('ro');
      const readWrite = options.indexOf('rw');
      assert.notEqual(readOnly === -1, readWrite === -1);
      if (readOnly >= 0) {
        options[readOnly] = 'rw';
      } else {
        options[readWrite] = 'ro';
      }
      fields[5] = options.join(',');
      lines[index] = `${fields.join(' ')}${lines[index].slice(separator)}`;
      mountAccessChanged = true;
      return Buffer.from(lines.join('\n'));
    };
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
    }), /durable retention timer unit publication changed across the pinned critical section/);
    assert.equal(mountAccessReads >= 2, true);
    assert.equal(mountAccessChanged, true);
    assert.equal(releaseBuilt, false);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      inspectedJournalBytes,
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('due firing rejects same-device unit files detached from the durable directory mount', () => {
  for (const unitKind of ['service', 'timer']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-detached-${unitKind}-mount-`,
    ));
    const originalOpenSync = fs.openSync;
    const originalReadFileSync = fs.readFileSync;
    const unitDescriptors = new Set();
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      const unitName = `${runtime.unitBase}.${unitKind}`;
      fs.openSync = function captureUnitDescriptor(target, flags, ...rest) {
        const descriptor = originalOpenSync.call(fs, target, flags, ...rest);
        if (String(target).endsWith(`/${unitName}`)
            && (flags & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
          unitDescriptors.add(descriptor);
        }
        return descriptor;
      };
      fs.readFileSync = function detachUnitMount(target, ...rest) {
        const bytes = originalReadFileSync.call(fs, target, ...rest);
        const match = /^\/proc\/self\/fdinfo\/([0-9]+)$/.exec(String(target));
        if (match === null || !unitDescriptors.has(Number(match[1]))) {
          return bytes;
        }
        assert.equal(Buffer.isBuffer(bytes), true);
        const changed = bytes.toString('utf8').replace(
          /^mnt_id:\s*([1-9][0-9]*)\s*$/m,
          (_line, mountId) => `mnt_id:\t${BigInt(mountId) + 1n}`,
        );
        assert.notDeepEqual(Buffer.from(changed), bytes);
        return Buffer.from(changed);
      };
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
      }), /durable retention timer unit/, unitKind);
      assert.equal(releaseBuilt, false, unitKind);
      assert.equal(fs.existsSync(fixture.releasePath), false, unitKind);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        unitKind,
      );
    } finally {
      fs.openSync = originalOpenSync;
      fs.readFileSync = originalReadFileSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due firing reopens both durable unit files instead of trusting cached systemd state', () => {
  for (const mutation of [
    'delete-service',
    'delete-timer',
    'replace-service',
    'replace-timer',
    'recreate-exact-service',
    'recreate-exact-timer',
    'mode-service',
    'hardlink-timer',
    'hardlink-recycle-service',
    'hardlink-recycle-timer',
    'symlink-timer',
    'fifo-service',
    'fifo-timer',
    'mode-directory',
    'nlink-directory',
    'symlink-directory',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-unit-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const unitKind = mutation.includes('service') ? 'service' : 'timer';
      const unitPath = path.join(
        unitDirectory,
        `${runtime.unitBase}.${unitKind}`,
      );
      const installedUnitBytes = fs.readFileSync(unitPath);
      if (mutation.startsWith('delete') || mutation.startsWith('replace')) {
        fs.unlinkSync(unitPath);
      }
      if (mutation.startsWith('replace')) {
        fs.writeFileSync(
          unitPath,
          `[Unit]\nDescription=hostile cached ${unitKind}\n`,
          { mode: 0o644 },
        );
      } else if (mutation.startsWith('recreate-exact')) {
        fs.unlinkSync(unitPath);
        fs.writeFileSync(unitPath, installedUnitBytes, { mode: 0o644 });
      } else if (mutation === 'mode-service') {
        fs.chmodSync(unitPath, 0o600);
      } else if (mutation === 'hardlink-timer') {
        fs.linkSync(unitPath, `${unitPath}.hostile-alias`);
      } else if (mutation.startsWith('hardlink-recycle')) {
        const aliasPath = `${unitPath}.hostile-recycle`;
        const inspectedObservation = installed.journal.transitions.find(
          (row) => row.phase === 'inspected',
        ).evidence.durableUnitObservation[unitKind];
        fs.linkSync(unitPath, aliasPath);
        fs.unlinkSync(unitPath);
        fs.renameSync(aliasPath, unitPath);
        const recycled = fs.statSync(unitPath, { bigint: true });
        assert.equal(recycled.ino.toString(), inspectedObservation.inode);
        assert.equal(recycled.dev.toString(), inspectedObservation.device);
        assert.equal(Number(recycled.nlink), 1);
        assert.notEqual(
          recycled.ctimeNs.toString(),
          inspectedObservation.ctimeNs,
        );
      } else if (mutation === 'symlink-timer') {
        fs.unlinkSync(unitPath);
        fs.symlinkSync(
          path.join(unitDirectory, `${runtime.unitBase}.service`),
          unitPath,
        );
      } else if (mutation.startsWith('fifo')) {
        fs.unlinkSync(unitPath);
        makeFifo(unitPath);
      } else if (mutation === 'mode-directory') {
        fs.chmodSync(unitDirectory, 0o755);
      } else if (mutation === 'nlink-directory') {
        fs.mkdirSync(path.join(unitDirectory, 'hostile-drop-in'), {
          mode: 0o700,
        });
      } else if (mutation === 'symlink-directory') {
        const displacedDirectory = `${unitDirectory}.hostile-displaced`;
        fs.renameSync(unitDirectory, displacedDirectory);
        fs.symlinkSync(displacedDirectory, unitDirectory);
      }
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      const originalOpenSync = fs.openSync;
      let nonblockingObservationCount = 0;
      if (mutation.startsWith('fifo')) {
        fs.openSync = function assertNonblockingUnitOpen(
          target,
          flags,
          ...rest
        ) {
          if (String(target).endsWith(`/${path.basename(unitPath)}`)) {
            if ((flags & fs.constants.O_NONBLOCK) === 0) {
              throw new Error(
                'durable retention timer unit read omitted O_NONBLOCK',
              );
            }
            nonblockingObservationCount += 1;
          }
          return originalOpenSync.call(fs, target, flags, ...rest);
        };
      }
      try {
        assert.throws(() => processRetentionResumeTimerFiring({
          contract: installed.contract,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: runtime.commandRunner,
          firingSpecDigest: runtime.specDigest,
          releaseBuilder: exactRelease,
          now: '2026-07-28T11:05:00.000Z',
        }), /durable retention timer unit|ELOOP|ENOTDIR/, mutation);
      } finally {
        fs.openSync = originalOpenSync;
      }
      if (mutation.startsWith('fifo')) {
        assert.equal(nonblockingObservationCount > 0, true, mutation);
      }
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        mutation,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-unit-evidence-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const released = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
    });
    const fired = released.journal.transitions.find((row) => (
      row.phase === 'fired'
    ));
    const inspected = released.journal.transitions.find((row) => (
      row.phase === 'inspected'
    ));
    assert.equal(
      fired.evidence.inspectedDurableUnitObservationDigest,
      inspected.evidence.durableUnitObservationDigest,
    );
    assert.match(
      fired.evidence.durableUnitObservation.observationDigest,
      /^[0-9a-f]{64}$/,
    );
    assert.equal(
      fired.evidence.durableUnitObservation.schemaVersion,
      'cortex.learning_os.retention_durable_unit_observation.v9',
    );
    assert.deepEqual(fired.evidence.durableUnitObservation.accessBinding, {
      schemaVersion: 'cortex.learning_os.retention_durable_unit_access.v2',
      accessMode: 'descriptor_relative_fixture',
      bindPath: null,
      rootDirectory: null,
      runtimeClosureSha256: null,
      serviceUid: process.geteuid(),
      observedMountId:
        fired.evidence.durableUnitObservation.directory.mountId,
      observedMountPoint:
        fired.evidence.durableUnitObservation.accessBinding.observedMountPoint,
      mountReadOnly:
        fired.evidence.durableUnitObservation.accessBinding.mountReadOnly,
    });
    assert.match(
      fired.evidence.durableUnitObservation.accessBinding.observedMountPoint,
      /^\//,
    );
    assert.equal(
      typeof fired.evidence.durableUnitObservation.accessBinding.mountReadOnly,
      'boolean',
    );
    assert.deepEqual(fired.evidence.durableUnitObservation.dropIns, {
      allAbsent: true,
      applicablePaths:
        fired.evidence.durableUnitObservation.dropIns.applicablePaths,
      searchRoot: fired.evidence.durableUnitObservation.directory.path,
    });
    for (const field of ['mtimeNs', 'ctimeNs', 'birthtimeNs']) {
      assert.match(
        fired.evidence.durableUnitObservation.directory[field],
        /^[0-9]+$/,
        `directory ${field}`,
      );
      assert.equal(
        fired.evidence.durableUnitObservation.directory[field],
        inspected.evidence.durableUnitObservation.directory[field],
        `directory ${field}`,
      );
    }
    const applicableDropIns
      = fired.evidence.durableUnitObservation.dropIns.applicablePaths;
    for (const expectedPath of [
      `${fired.evidence.durableUnitObservation.service.path}.d`,
      `${fired.evidence.durableUnitObservation.timer.path}.d`,
      path.join(
        fired.evidence.durableUnitObservation.directory.path,
        'clos-.service.d',
      ),
      path.join(
        fired.evidence.durableUnitObservation.directory.path,
        'clos-.timer.d',
      ),
      path.join(
        fired.evidence.durableUnitObservation.directory.path,
        'service.d',
      ),
      path.join(
        fired.evidence.durableUnitObservation.directory.path,
        'timer.d',
      ),
    ]) {
      assert.equal(applicableDropIns.includes(expectedPath), true, expectedPath);
    }
    assert.deepEqual(applicableDropIns, [...applicableDropIns].sort());
    for (const unit of ['service', 'timer']) {
      assert.equal(fired.evidence.durableUnitObservation[unit].mode, '0644');
      assert.equal(fired.evidence.durableUnitObservation[unit].nlink, '1');
      assert.equal(
        fired.evidence.durableUnitObservation[unit].device,
        fired.evidence.durableUnitObservation.directory.device,
      );
      assert.equal(
        fired.evidence.durableUnitObservation[unit].mountId,
        fired.evidence.durableUnitObservation.directory.mountId,
      );
      assert.equal(fired.evidence.durableUnitObservation[unit].uid, process.geteuid());
      assert.equal(fired.evidence.durableUnitObservation[unit].gid, process.getegid());
      assert.match(
        fired.evidence.durableUnitObservation[unit].sha256,
        /^[0-9a-f]{64}$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].device,
        /^(0|[1-9][0-9]*)$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].inode,
        /^[1-9][0-9]*$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].mountId,
        /^[1-9][0-9]*$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].mtimeNs,
        /^[0-9]+$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].ctimeNs,
        /^[0-9]+$/,
      );
      assert.match(
        fired.evidence.durableUnitObservation[unit].birthtimeNs,
        /^[0-9]+$/,
      );
      assert.equal(
        fired.evidence.durableUnitObservation[unit].inode,
        inspected.evidence.durableUnitObservation[unit].inode,
      );
    }
    assert.equal(verifyRetentionTimerJournal({
      journal: released.journal,
      contract: released.contract,
      signingSecret: secret,
    }), true);
    for (const mutation of [
      'gid', 'device', 'inode', 'mountId', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
    ]) {
      const forged = structuredClone(released.journal);
      forged.phase = 'fired';
      forged.transitions = forged.transitions.filter((row) => row.phase !== 'released');
      const forgedFired = forged.transitions.find((row) => row.phase === 'fired');
      const observation = forgedFired.evidence.durableUnitObservation;
      if (mutation === 'gid') {
        observation.service.gid += 1;
      } else {
        observation.service[mutation] = (
          BigInt(observation.service[mutation]) + 1n
        ).toString();
      }
      const { observationDigest: _digest, ...observationPayload } = observation;
      observation.observationDigest = sha256Text(canonicalJson(observationPayload));
      forgedFired.evidence.durableUnitObservationDigest = observation.observationDigest;
      assert.equal(verifyRetentionTimerJournal({
        journal: resign(forged),
        contract: released.contract,
        signingSecret: secret,
      }), false, mutation);
    }
    for (const [field, value] of [
      ['accessMode', 'unsealed_host_path'],
      ['observedMountId', '999999999999'],
      ['observedMountPoint', 'relative/unit/path'],
      ['mountReadOnly', 'unknown'],
    ]) {
      const forgedAccess = structuredClone(released.journal);
      forgedAccess.phase = 'fired';
      forgedAccess.transitions = forgedAccess.transitions.filter(
        (row) => row.phase !== 'released',
      );
      const forgedFired = forgedAccess.transitions.find(
        (row) => row.phase === 'fired',
      );
      const forgedObservation = forgedFired.evidence.durableUnitObservation;
      forgedObservation.accessBinding[field] = value;
      const {
        observationDigest: _observationDigest,
        ...forgedObservationPayload
      } = forgedObservation;
      forgedObservation.observationDigest = sha256Text(
        canonicalJson(forgedObservationPayload),
      );
      forgedFired.evidence.durableUnitObservationDigest
        = forgedObservation.observationDigest;
      assert.equal(verifyRetentionTimerJournal({
        journal: resign(forgedAccess),
        contract: released.contract,
        signingSecret: secret,
      }), false, field);
    }
    for (const attack of [
      {
        phase: 'inspected',
        journal: installed.journal,
        contract: installed.contract,
        unit: 'service',
        property: 'BindReadOnlyPaths',
        value: '/host/attacker-controlled-units',
      },
      {
        phase: 'inspected',
        journal: installed.journal,
        contract: installed.contract,
        unit: 'timer',
        property: 'FragmentPath',
        value: '/host/attacker.timer',
      },
      {
        phase: 'fired',
        journal: released.journal,
        contract: released.contract,
        unit: 'service',
        property: 'ExecStart',
        value: '{ path=/host/attacker ; argv[]=/host/attacker ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }',
      },
      {
        phase: 'fired',
        journal: released.journal,
        contract: released.contract,
        unit: 'timer',
        property: 'TimersCalendar',
        value: '{ OnCalendar=*-*-* 00:00:00 UTC ; next_elapse=never }',
      },
      {
        phase: 'fired',
        journal: released.journal,
        contract: released.contract,
        unit: 'timer',
        property: 'DropInPaths',
        value: '/etc/systemd/system/attacker.conf',
      },
    ]) {
      const forgedInspection = structuredClone(attack.journal);
      if (attack.phase === 'fired') {
        forgedInspection.phase = 'fired';
        forgedInspection.transitions = forgedInspection.transitions.filter(
          (row) => row.phase !== 'released',
        );
      }
      const transition = forgedInspection.transitions.find(
        (row) => row.phase === attack.phase,
      );
      transition.evidence.inspection[attack.unit][attack.property] = attack.value;
      transition.evidence.inspectionDigest = sha256Text(canonicalJson(
        transition.evidence.inspection,
      ));
      assert.equal(verifyRetentionTimerJournal({
        journal: resign(forgedInspection),
        contract: attack.contract,
        signingSecret: secret,
      }), false, `${attack.phase}:${attack.unit}:${attack.property}`);
    }
    const futureFired = structuredClone(released.journal);
    futureFired.phase = 'fired';
    futureFired.transitions = futureFired.transitions.filter(
      (row) => row.phase !== 'released',
    );
    const futureFiredTransition = futureFired.transitions.find(
      (row) => row.phase === 'fired',
    );
    futureFiredTransition.evidence.firedAt = new Date(
      Date.parse(futureFiredTransition.recordedAt) + 1,
    ).toISOString();
    futureFiredTransition.evidence.inspection.timer.LastTriggerUSec
      = futureFiredTransition.evidence.firedAt;
    futureFiredTransition.evidence.inspectionDigest = sha256Text(canonicalJson(
      futureFiredTransition.evidence.inspection,
    ));
    assert.equal(verifyRetentionTimerJournal({
      journal: resign(futureFired),
      contract: released.contract,
      signingSecret: secret,
    }), false, 'future fired evidence');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cached fired properties cannot hide durable directory detach and restore', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-directory-detach-restore-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const inspectedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    const unitDirectory = path.join(root, '.retention-systemd-units');
    const displacedDirectory = `${unitDirectory}.detached`;
    const before = fs.statSync(unitDirectory, { bigint: true });
    let restored = false;
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase !== 'before_fired_manager_inspection' || restored) return;
        fs.renameSync(unitDirectory, displacedDirectory);
        fs.mkdirSync(unitDirectory, { mode: 0o700 });
        fs.rmdirSync(unitDirectory);
        fs.renameSync(displacedDirectory, unitDirectory);
        const after = fs.statSync(unitDirectory, { bigint: true });
        assert.equal(after.dev, before.dev);
        assert.equal(after.ino, before.ino);
        assert.equal(after.nlink, before.nlink);
        assert.notEqual(after.ctimeNs, before.ctimeNs);
        restored = true;
      },
    }), /durable retention timer unit (?:directory identity|publication) changed/);
    assert.equal(restored, true);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      inspectedJournalBytes,
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('due firing rejects systemd manager evidence that reports durable unit reload drift', () => {
  for (const unitKind of ['service', 'timer']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-manager-reload-${unitKind}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      const staleManagerRunner = (command, argv, options) => {
        const result = runtime.commandRunner(command, argv, options);
        if (command === '/fake/systemctl'
            && argv[0] === 'show'
            && argv[1].endsWith(`.${unitKind}`)) {
          return {
            ...result,
            stdout: result.stdout.replace(
              'NeedDaemonReload=no',
              'NeedDaemonReload=yes',
            ),
          };
        }
        return result;
      };
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: staleManagerRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
      }), new RegExp(`${unitKind} NeedDaemonReload mismatch`));
      assert.equal(releaseBuilt, false, unitKind);
      assert.equal(fs.existsSync(fixture.releasePath), false, unitKind);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        unitKind,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('cached fired properties are inspected only while both durable unit names stay pinned', () => {
  for (const mutation of [
    'delete-service',
    'delete-timer',
    'replace-service',
    'replace-timer',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-manager-pin-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const unitPaths = {
        service: path.join(unitDirectory, `${runtime.unitBase}.service`),
        timer: path.join(unitDirectory, `${runtime.unitBase}.timer`),
      };
      const unitIdentities = Object.fromEntries(
        Object.entries(unitPaths).map(([kind, unitPath]) => {
          const stat = fs.statSync(unitPath, { bigint: true });
          return [kind, `${stat.dev}:${stat.ino}`];
        }),
      );
      const unitKind = mutation.endsWith('service') ? 'service' : 'timer';
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      let releaseBuilt = false;
      let mutatedDuringManagerInspection = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase !== 'before_fired_manager_inspection'
              || mutatedDuringManagerInspection) {
            return;
          }
          const openIdentities = new Set(
            fs.readdirSync('/proc/self/fd').flatMap((entry) => {
              try {
                const stat = fs.fstatSync(Number(entry), { bigint: true });
                return [`${stat.dev}:${stat.ino}`];
              } catch {
                return [];
              }
            }),
          );
          assert.equal(openIdentities.has(unitIdentities.service), true);
          assert.equal(openIdentities.has(unitIdentities.timer), true);
          mutatedDuringManagerInspection = true;
          fs.unlinkSync(unitPaths[unitKind]);
          if (mutation.startsWith('replace')) {
            fs.writeFileSync(
              unitPaths[unitKind],
              `[Unit]\nDescription=hostile cached ${unitKind}\n`,
              { mode: 0o644 },
            );
          }
        },
      }), /durable retention timer unit/, mutation);
      assert.equal(mutatedDuringManagerInspection, true, mutation);
      assert.equal(releaseBuilt, false, mutation);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        mutation,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due firing pins the unit pair across intra-observation replacements', () => {
  for (const [mutationPhase, unitKind, replacementKind] of [
    ['after_durable_service_unit_open', 'service', 'exact'],
    ['after_durable_timer_unit_open', 'timer', 'exact'],
    ['after_durable_service_unit_observation', 'service', 'hostile'],
    ['after_durable_timer_unit_observation', 'timer', 'hostile'],
    ['before_durable_unit_observation_commit', 'service', 'hostile'],
    ['before_durable_unit_observation_commit', 'timer', 'hostile'],
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-unit-pair-${mutationPhase}-${unitKind}-${replacementKind}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const exactUnitBytes = fs.readFileSync(unitPath);
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      let mutated = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (!mutated && phase === mutationPhase) {
            mutated = true;
            fs.unlinkSync(unitPath);
            fs.writeFileSync(
              unitPath,
              replacementKind === 'exact'
                ? exactUnitBytes
                : `[Unit]\nDescription=hostile intra-observation ${unitKind}\n`,
              { mode: 0o644 },
            );
          }
        },
      }), /changed during exact observation|bytes are missing or mismatched/, mutationPhase);
      assert.equal(mutated, true, mutationPhase);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        mutationPhase,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, mutationPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due firing bounds named unit reads across in-place growth', () => {
  for (const unitKind of ['service', 'timer']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-unit-bounded-growth-${unitKind}-`,
    ));
    const originalReadSync = fs.readSync;
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const unitBytes = fs.readFileSync(unitPath);
      const unitIdentity = fs.statSync(unitPath, { bigint: true });
      const inspectedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      let pinnedDescriptor = null;
      let grewDuringNamedRead = false;
      let maximumRequestedBytes = 0;
      let releaseBuilt = false;
      fs.readSync = function growNamedUnitAfterMetadataCheck(
        descriptor,
        buffer,
        offset,
        length,
        position,
      ) {
        const observed = fs.fstatSync(descriptor, { bigint: true });
        if (observed.dev === unitIdentity.dev
            && observed.ino === unitIdentity.ino) {
          maximumRequestedBytes = Math.max(maximumRequestedBytes, length);
          if (pinnedDescriptor === null) {
            pinnedDescriptor = descriptor;
          } else if (descriptor !== pinnedDescriptor && !grewDuringNamedRead) {
            fs.appendFileSync(unitPath, Buffer.from('#'));
            grewDuringNamedRead = true;
          }
        }
        return originalReadSync.call(
          fs,
          descriptor,
          buffer,
          offset,
          length,
          position,
        );
      };
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
      }), /changed during exact observation/, unitKind);
      assert.notEqual(pinnedDescriptor, null, unitKind);
      assert.equal(grewDuringNamedRead, true, unitKind);
      assert.equal(maximumRequestedBytes <= unitBytes.length, true, unitKind);
      assert.equal(releaseBuilt, false, unitKind);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        inspectedJournalBytes,
        unitKind,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, unitKind);
    } finally {
      fs.readSync = originalReadSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired transition re-reads a pinned unit after its final named descriptor closes', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-final-named-close-rewrite-',
  ));
  const originalCloseSync = fs.closeSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const unitPath = path.join(
      root,
      '.retention-systemd-units',
      `${runtime.unitBase}.service`,
    );
    const unitIdentity = fs.statSync(unitPath, { bigint: true });
    const inspectedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    let armed = false;
    let rewritten = false;
    fs.closeSync = function rewriteUnitAfterNamedDescriptor(descriptor) {
      let closesUnit = false;
      if (armed && !rewritten) {
        try {
          const observed = fs.fstatSync(descriptor, { bigint: true });
          closesUnit = observed.isFile()
            && observed.dev === unitIdentity.dev
            && observed.ino === unitIdentity.ino;
        } catch {}
      }
      const result = originalCloseSync.call(fs, descriptor);
      if (closesUnit) {
        rewritten = true;
        fs.writeFileSync(
          unitPath,
          '[Unit]\nDescription=hostile same-inode post-named-close service\n',
        );
        const changed = fs.statSync(unitPath, { bigint: true });
        assert.equal(changed.dev, unitIdentity.dev);
        assert.equal(changed.ino, unitIdentity.ino);
      }
      return result;
    };
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'before_fired_manager_inspection') armed = true;
      },
    }), /changed during exact observation with pinned descriptors/);
    fs.closeSync = originalCloseSync;
    assert.equal(armed, true);
    assert.equal(rewritten, true);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      inspectedJournalBytes,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      )).phase,
      'installed',
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);
  } finally {
    fs.closeSync = originalCloseSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired journal rollback at the final pinned handoff exposes no release and retries safely', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-successor-rollback-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const installedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    assert.equal(
      JSON.parse(installedJournalBytes.toString('utf8')).phase,
      'installed',
    );
    runtime.fire(fixture.persisted.resumeAt);
    let rolledBack = false;
    let releaseBuilt = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (rolledBack
            || phase !== 'after_fired_authority_handoff_manager_inspection') {
          return;
        }
        const committed = JSON.parse(fs.readFileSync(
          fixture.persisted.timerJournalPath,
          'utf8',
        ));
        assert.equal(committed.phase, 'fired');
        rolledBack = true;
        fs.writeFileSync(
          fixture.persisted.timerJournalPath,
          installedJournalBytes,
        );
      },
    }), /fired timer journal changed before protected authority consumption/);
    assert.equal(rolledBack, true);
    assert.equal(releaseBuilt, false);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.equal(
      JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      )).phase,
      'installed',
    );

    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerReleased, true);
    assert.equal(recovered.journal.phase, 'released');
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired commit witness rejects unit changes after the post-critical assertion', () => {
  for (const mutation of [
    'delete-service',
    'delete-timer',
    'replace-service',
    'replace-timer',
    'rewrite-service',
    'rewrite-timer',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-commit-witness-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.endsWith('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const installedIdentity = fs.statSync(unitPath, { bigint: true });
      let mutated = false;
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase !== 'before_durable_unit_commit_witness' || mutated) return;
          mutated = true;
          if (mutation.startsWith('delete')
              || mutation.startsWith('replace')) {
            fs.unlinkSync(unitPath);
          }
          if (mutation.startsWith('replace')
              || mutation.startsWith('rewrite')) {
            fs.writeFileSync(
              unitPath,
              `[Unit]\nDescription=hostile commit-witness ${unitKind}\n`,
              { mode: 0o644 },
            );
          }
          if (mutation.startsWith('rewrite')) {
            const changed = fs.statSync(unitPath, { bigint: true });
            assert.equal(changed.dev, installedIdentity.dev);
            assert.equal(changed.ino, installedIdentity.ino);
          }
        },
      }), /durable retention timer unit/, mutation);
      assert.equal(mutated, true, mutation);
      assert.equal(releaseBuilt, false, mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
      const firedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(firedJournal.phase, 'fired', mutation);
      assert.equal(verifyRetentionTimerJournal({
        journal: firedJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), true, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired return witness reopens durable units after every earlier pin closes', () => {
  for (const mutation of [
    'delete-service',
    'replace-timer',
    'recreate-exact-service',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-post-pin-release-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.includes('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const unitBytes = fs.readFileSync(unitPath);
      const unitIdentity = fs.statSync(unitPath, { bigint: true });
      const unitIdentityKey = `${unitIdentity.dev}:${unitIdentity.ino}`;
      let mutated = false;
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase
              !== 'after_durable_unit_pinned_descriptor_release_before_return_witness'
              || mutated) {
            return;
          }
          const openIdentities = new Set(
            fs.readdirSync('/proc/self/fd').flatMap((entry) => {
              try {
                const stat = fs.fstatSync(Number(entry), { bigint: true });
                return [`${stat.dev}:${stat.ino}`];
              } catch {
                return [];
              }
            }),
          );
          assert.equal(openIdentities.has(unitIdentityKey), false, mutation);
          mutated = true;
          if (mutation === 'delete-service') {
            fs.unlinkSync(unitPath);
            return;
          }
          const replacementPath = path.join(
            path.dirname(unitPath),
            `.${path.basename(unitPath)}.hostile-replacement`,
          );
          fs.writeFileSync(
            replacementPath,
            mutation === 'recreate-exact-service'
              ? unitBytes
              : Buffer.from('[Unit]\nDescription=hostile post-pin timer\n'),
            { mode: 0o644 },
          );
          const replacementIdentity = fs.statSync(
            replacementPath,
            { bigint: true },
          );
          assert.notEqual(
            `${replacementIdentity.dev}:${replacementIdentity.ino}`,
            unitIdentityKey,
            mutation,
          );
          fs.renameSync(replacementPath, unitPath);
        },
      }), /durable retention timer unit/, mutation);
      assert.equal(mutated, true, mutation);
      assert.equal(releaseBuilt, false, mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
      const firedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(firedJournal.phase, 'fired', mutation);
      assert.equal(verifyRetentionTimerJournal({
        journal: firedJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), true, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired observation confirms durable units after its first descriptor-free witness', () => {
  for (const mutation of [
    'delete-service',
    'replace-timer',
    'recreate-exact-service',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-descriptor-free-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.includes('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const unitBytes = fs.readFileSync(unitPath);
      const unitIdentity = fs.statSync(unitPath, { bigint: true });
      const unitIdentityKey = `${unitIdentity.dev}:${unitIdentity.ino}`;
      let mutated = false;
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase
              !== 'after_durable_unit_return_witness_descriptor_release_before_confirmation'
              || mutated) {
            return;
          }
          const openIdentities = new Set(
            fs.readdirSync('/proc/self/fd').flatMap((entry) => {
              try {
                const stat = fs.fstatSync(Number(entry), { bigint: true });
                return [`${stat.dev}:${stat.ino}`];
              } catch {
                return [];
              }
            }),
          );
          assert.equal(openIdentities.has(unitIdentityKey), false, mutation);
          mutated = true;
          if (mutation === 'delete-service') {
            fs.unlinkSync(unitPath);
            return;
          }
          const replacementPath = path.join(
            path.dirname(unitPath),
            `.${path.basename(unitPath)}.descriptor-free-replacement`,
          );
          fs.writeFileSync(
            replacementPath,
            mutation === 'recreate-exact-service'
              ? unitBytes
              : Buffer.from('[Unit]\nDescription=hostile descriptor-free timer\n'),
            { mode: 0o644 },
          );
          fs.renameSync(replacementPath, unitPath);
        },
      }), /durable retention timer unit/, mutation);
      assert.equal(mutated, true, mutation);
      assert.equal(releaseBuilt, false, mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
      const firedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(firedJournal.phase, 'fired', mutation);
      assert.equal(verifyRetentionTimerJournal({
        journal: firedJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), true, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired journal named readback stays inside the pinned unit commit', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-journal-readback-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const unitDirectory = path.join(root, '.retention-systemd-units');
    const unitIdentities = ['service', 'timer'].map((kind) => {
      const stat = fs.statSync(
        path.join(unitDirectory, `${runtime.unitBase}.${kind}`),
        { bigint: true },
      );
      return `${stat.dev}:${stat.ino}`;
    });
    const inspectedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    let releaseBuilt = false;
    let predecessorRestored = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase !== 'after_fired_journal_write_before_readback'
            || predecessorRestored) {
          return;
        }
        const openIdentities = new Set(
          fs.readdirSync('/proc/self/fd').flatMap((entry) => {
            try {
              const stat = fs.fstatSync(Number(entry), { bigint: true });
              return [`${stat.dev}:${stat.ino}`];
            } catch {
              return [];
            }
          }),
        );
        assert.equal(
          unitIdentities.every((identity) => openIdentities.has(identity)),
          true,
        );
        predecessorRestored = true;
        fs.unlinkSync(fixture.persisted.timerJournalPath);
        fs.writeFileSync(
          fixture.persisted.timerJournalPath,
          inspectedJournalBytes,
          { mode: 0o600 },
        );
      },
    }), /fired journal changed before its pinned unit commit completed/);
    assert.equal(predecessorRestored, true);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      inspectedJournalBytes,
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);

    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired journal commit rechecks manager firing while both durable units stay pinned', () => {
  for (const managerAttack of ['absent', 'changed-trigger']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-manager-commit-${managerAttack}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const unitIdentities = ['service', 'timer'].map((kind) => {
        const stat = fs.statSync(
          path.join(unitDirectory, `${runtime.unitBase}.${kind}`),
          { bigint: true },
        );
        return `${stat.dev}:${stat.ino}`;
      });
      let attacked = false;
      let releaseBuilt = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase !== 'before_fired_manager_commit_witness' || attacked) {
            return;
          }
          const openIdentities = new Set(
            fs.readdirSync('/proc/self/fd').flatMap((entry) => {
              try {
                const stat = fs.fstatSync(Number(entry), { bigint: true });
                return [`${stat.dev}:${stat.ino}`];
              } catch {
                return [];
              }
            }),
          );
          assert.equal(
            unitIdentities.every((identity) => openIdentities.has(identity)),
            true,
          );
          attacked = true;
          if (managerAttack === 'absent') runtime.remove();
          else runtime.fire('2026-07-28T11:00:30.000Z');
        },
      }), /manager firing changed across fired journal commit/, managerAttack);
      assert.equal(attacked, true, managerAttack);
      assert.equal(releaseBuilt, false, managerAttack);
      assert.equal(fs.existsSync(fixture.releasePath), false, managerAttack);
      const firedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(firedJournal.phase, 'fired', managerAttack);
      assert.equal(verifyRetentionTimerJournal({
        journal: firedJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), true, managerAttack);

      if (managerAttack === 'absent') {
        runtime.setActivationState('enabled-inactive');
      }
      runtime.fire(fixture.persisted.resumeAt);
      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      });
      assert.equal(recovered.released, true, managerAttack);
      assert.equal(recovered.journal.phase, 'released', managerAttack);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('due release rejects a hybrid manager inspection before construction and retries', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-release-manager-snapshot-drift-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    const firingGeneration = runtime.managerGeneration();
    let armed = false;
    let rotated = false;
    let releaseBuilt = false;
    const commandRunner = (command, argv, options) => {
      const result = runtime.commandRunner(command, argv, options);
      if (armed && command === '/fake/busctl') {
        armed = false;
        rotated = true;
        runtime.rotateManagerGeneration();
      }
      return result;
    };
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'before_release_construction_manager_inspection') {
          armed = true;
        }
      },
    }), /manager changed during one coherent inspection/);
    assert.equal(rotated, true);
    assert.equal(releaseBuilt, false);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.equal(
      JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      )).phase,
      'fired',
    );

    runtime.restoreManagerGeneration(firingGeneration);
    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release construction and every irreversible successor reject manager drift and stay repairable', () => {
  for (const boundary of [
    'release_builder',
    'release_builder_trigger',
    'release_file',
    'released_journal',
    'released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-manager-${boundary}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const unitIdentities = ['service', 'timer'].map((kind) => {
        const stat = fs.statSync(
          path.join(unitDirectory, `${runtime.unitBase}.${kind}`),
          { bigint: true },
        );
        return `${stat.dev}:${stat.ino}`;
      });
      let attacked = false;
      let releaseBuilderObservedPinnedUnits = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          if (boundary.startsWith('release_builder') && !attacked) {
            const openIdentities = new Set(
              fs.readdirSync('/proc/self/fd').flatMap((entry) => {
                try {
                  const stat = fs.fstatSync(Number(entry), { bigint: true });
                  return [`${stat.dev}:${stat.ino}`];
                } catch {
                  return [];
                }
              }),
            );
            assert.equal(
              unitIdentities.every((identity) => openIdentities.has(identity)),
              true,
            );
            releaseBuilderObservedPinnedUnits = true;
            attacked = true;
            if (boundary === 'release_builder') runtime.remove();
            else runtime.fire('2026-07-28T11:00:30.000Z');
          }
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (boundary.startsWith('release_builder')
              || attacked
              || phase !== `after_${boundary}_successor_commit_before_manager_reinspection`) {
            return;
          }
          attacked = true;
          runtime.fire('2026-07-28T11:00:30.000Z');
        },
      }), /manager firing changed|manager identity or firing changed/, boundary);
      assert.equal(attacked, true, boundary);
      assert.equal(
        releaseBuilderObservedPinnedUnits,
        boundary.startsWith('release_builder'),
        boundary,
      );
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:30.000Z',
      }), /manager firing changed/, `${boundary}:drift persists`);

      if (runtime.activationState() === 'absent') {
        runtime.setActivationState('enabled-inactive');
      }
      runtime.fire(fixture.persisted.resumeAt);
      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      });
      assert.equal(recovered.released, true, boundary);
      assert.equal(recovered.contract.timerReleased, true, boundary);
      assert.equal(recovered.journal.phase, 'released', boundary);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired journal reconsumes manager firing at the final pinned-unit handoff', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-final-manager-handoff-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    let removed = false;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (removed
            || phase !== 'before_fired_authority_handoff_manager_inspection') {
          return;
        }
        removed = true;
        runtime.remove();
      },
    }), /manager firing changed before the protected fired-journal handoff/);
    assert.equal(removed, true);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    const firedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(firedJournal.phase, 'fired');
    assert.equal(verifyRetentionTimerJournal({
      journal: firedJournal,
      contract: installed.contract,
      signingSecret: secret,
    }), true);

    runtime.setActivationState('enabled-inactive');
    runtime.fire(fixture.persisted.resumeAt);
    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerReleased, true);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired journal rejects manager drift after its final handoff inspection', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-post-handoff-manager-drift-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    let attacked = false;
    let authenticatedGeneration = null;
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (attacked
            || phase !== 'after_fired_authority_handoff_manager_inspection') {
          return;
        }
        attacked = true;
        authenticatedGeneration = runtime.managerGeneration();
        runtime.rotateManagerGeneration();
      },
    }), /manager firing changed across the protected fired-journal handoff/);
    assert.equal(attacked, true);
    assert.equal(fs.existsSync(fixture.releasePath), false);
    const firedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(firedJournal.phase, 'fired');
    assert.equal(verifyRetentionTimerJournal({
      journal: firedJournal,
      contract: installed.contract,
      signingSecret: secret,
    }), true);

    runtime.restoreManagerGeneration(authenticatedGeneration);
    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerReleased, true);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every release successor reconsumes manager firing at the final pinned-unit handoff', () => {
  for (const boundary of [
    'release_construction',
    'release_file',
    'released_journal',
    'released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-final-handoff-${boundary}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      let attacked = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (attacked
              || phase
                !== `before_${boundary}_authority_handoff_manager_inspection`) {
            return;
          }
          attacked = true;
          runtime.fire('2026-07-28T11:00:30.000Z');
        },
      }), /manager firing changed after authenticated commit/, boundary);
      assert.equal(attacked, true, boundary);

      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:30.000Z',
      }), /manager firing changed/, `${boundary}:drift persists`);

      runtime.fire(fixture.persisted.resumeAt);
      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      });
      assert.equal(recovered.released, true, boundary);
      assert.equal(recovered.contract.timerReleased, true, boundary);
      assert.equal(recovered.journal.phase, 'released', boundary);
      assert.equal(verifyRetentionTimerJournal({
        journal: recovered.journal,
        contract: recovered.contract,
        signingSecret: secret,
      }), true, boundary);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('every release successor rejects drift after its final manager handoff inspection', () => {
  for (const boundary of [
    'release_construction',
    'release_file',
    'released_journal',
    'released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-post-handoff-${boundary}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      let attacked = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (attacked
              || phase
                !== `after_${boundary}_authority_handoff_manager_inspection`) {
            return;
          }
          attacked = true;
          runtime.fire('2026-07-28T11:00:30.000Z');
        },
      }), /manager firing changed after authenticated commit/, boundary);
      assert.equal(attacked, true, boundary);

      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:30.000Z',
      }), /manager firing changed/, `${boundary}:drift persists`);

      runtime.fire(fixture.persisted.resumeAt);
      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      });
      assert.equal(recovered.released, true, boundary);
      assert.equal(recovered.contract.timerReleased, true, boundary);
      assert.equal(recovered.journal.phase, 'released', boundary);
      assert.equal(verifyRetentionTimerJournal({
        journal: recovered.journal,
        contract: recovered.contract,
        signingSecret: secret,
      }), true, boundary);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('every durable release successor is reconsumed during the final pinned handoff', () => {
  for (const boundary of [
    'release_file',
    'released_journal',
    'released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-successor-consumption-${boundary}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      const installedWaitBytes = fs.readFileSync(fixture.waitPath);
      runtime.fire(fixture.persisted.resumeAt);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase === 'after_fired') throw new Error('crash:after_fired');
        },
      }), /crash:after_fired/, boundary);
      const firedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      assert.equal(
        JSON.parse(firedJournalBytes.toString('utf8')).phase,
        'fired',
        boundary,
      );

      let attacked = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:30.000Z',
        crashInjector(phase) {
          if (attacked
              || phase
                !== `after_${boundary}_authority_handoff_manager_inspection`) {
            return;
          }
          attacked = true;
          if (boundary === 'release_file') {
            fs.unlinkSync(fixture.releasePath);
          } else if (boundary === 'released_journal') {
            fs.writeFileSync(
              fixture.persisted.timerJournalPath,
              firedJournalBytes,
            );
          } else {
            fs.writeFileSync(fixture.waitPath, installedWaitBytes);
          }
        },
      }), /missing|changed before protected authority consumption/, boundary);
      assert.equal(attacked, true, boundary);

      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      });
      assert.equal(recovered.released, true, boundary);
      assert.equal(recovered.contract.timerReleased, true, boundary);
      assert.equal(recovered.journal.phase, 'released', boundary);
      assert.equal(verifyRetentionTimerJournal({
        journal: recovered.journal,
        contract: recovered.contract,
        signingSecret: secret,
      }), true, boundary);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('release construction and successors consume one exact manager invocation generation', () => {
  for (const boundary of [
    'release_construction',
    'release_file',
    'released_journal',
    'released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-generation-${boundary}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase === 'after_fired') throw new Error('crash:after_fired');
        },
      }), /crash:after_fired/, boundary);
      const authenticatedGeneration = runtime.managerGeneration();
      let attacked = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
        crashInjector(phase) {
          if (attacked
              || phase !== `after_${boundary}_manager_inspection_before_commit`) {
            return;
          }
          attacked = true;
          runtime.rotateManagerGeneration();
        },
      }), /manager firing changed.*identity or generation mismatch/, boundary);
      assert.equal(attacked, true, boundary);

      runtime.restoreManagerGeneration(authenticatedGeneration);
      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:07:00.000Z',
      });
      assert.equal(recovered.released, true, boundary);
      assert.equal(recovered.contract.timerReleased, true, boundary);
      assert.equal(verifyRetentionWaitContract(recovered.contract, secret), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('release retry accepts a restarted oneshot process under the same timer firing', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-release-service-restart-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_fired') throw new Error('crash:after_fired');
      },
    }), /crash:after_fired/);
    runtime.rotateServiceInvocation();
    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.contract.timerReleased, true);
    const firedTransition = recovered.journal.transitions.find(
      (transition) => transition.phase === 'fired',
    );
    assert.notEqual(
      recovered.contract.timerReleaseReceipt.releaseServiceInvocationId,
      firedTransition.evidence.managerFiringReceipt.serviceInvocationId,
    );
    assert.notEqual(
      recovered.contract.timerReleaseReceipt.releaseServiceMainPid,
      firedTransition.evidence.managerFiringReceipt.serviceMainPid,
    );
    assert.equal(
      recovered.contract.timerReleaseReceipt.releaseServiceMainPid,
      runtime.serviceMainPid(),
    );
    assert.equal(
      recovered.contract.timerReleaseReceipt.releaseTimerInvocationId,
      firedTransition.evidence.managerFiringReceipt.timerInvocationId,
    );
    assert.equal(
      recovered.contract.timerReleaseReceipt.managerFiringReceiptDigest,
      sha256Text(canonicalJson(
        firedTransition.evidence.managerFiringReceipt,
      )),
    );
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired journal persists and consumes the exact manager-issued invocation receipt', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-manager-firing-receipt-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_fired') throw new Error('crash:after_fired');
      },
    }), /crash:after_fired/);
    const firedJournal = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    const fired = firedJournal.transitions.find(
      (transition) => transition.phase === 'fired',
    );
    assert.deepEqual(
      Object.keys(fired.evidence.managerFiringReceipt).sort(),
      [
        'firedAt',
        'manager',
        'managerIdentityDigest',
        'managerInspectionDigest',
        'production',
        'schemaVersion',
        'serviceInvocationId',
        'serviceMainPid',
        'serviceUnit',
        'timerInvocationId',
        'timerSpecDigest',
        'timerUnit',
        'truthBoundary',
      ],
    );
    assert.equal(fired.evidence.managerFiringReceipt.manager, 'systemd');
    assert.equal(fired.evidence.managerFiringReceipt.production, false);
    assert.equal(
      fired.evidence.managerFiringReceipt.serviceInvocationId,
      fired.evidence.inspection.service.InvocationID,
    );
    assert.equal(
      fired.evidence.managerFiringReceipt.serviceMainPid,
      process.pid,
    );
    assert.equal(
      fired.evidence.managerFiringReceipt.timerInvocationId,
      fired.evidence.inspection.timer.InvocationID,
    );
    assert.equal(verifyRetentionTimerJournal({
      journal: firedJournal,
      contract: installed.contract,
      signingSecret: secret,
    }), true);

    for (const mutate of [
      (receipt) => { receipt.serviceInvocationId = '0'.repeat(32); },
      (receipt) => { receipt.serviceMainPid += 1; },
      (receipt) => { receipt.timerInvocationId = '0'.repeat(32); },
      (receipt) => { receipt.firedAt = '2026-07-28T11:01:00.000Z'; },
      (receipt) => { receipt.managerInspectionDigest = '0'.repeat(64); },
      (receipt) => { receipt.managerIdentityDigest = '0'.repeat(64); },
      (receipt) => { receipt.manager = 'caller'; },
    ]) {
      const tampered = structuredClone(firedJournal);
      mutate(tampered.transitions.find(
        (transition) => transition.phase === 'fired',
      ).evidence.managerFiringReceipt);
      const resigned = resignTimerJournal(tampered);
      assert.equal(verifyRetentionTimerJournal({
        journal: resigned,
        contract: installed.contract,
        signingSecret: secret,
      }), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed legacy journal migrates crash-safely before manager firing receipt', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-manager-receipt-migration-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const legacy = structuredClone(installed.journal);
    legacy.schemaVersion = 'cortex.learning_os.retention_timer_journal.v2';
    for (const transition of legacy.transitions) {
      if (!transition.evidence?.inspection) continue;
      delete transition.evidence.inspection.service.MainPID;
      delete transition.evidence.inspection.service.ControlPID;
      transition.evidence.inspectionDigest = sha256Text(canonicalJson(
        transition.evidence.inspection,
      ));
      if (transition.phase === 'installed') {
        transition.evidence.pendingInspectionDigest = legacy.transitions.find(
          (candidate) => candidate.phase === 'install_pending',
        ).evidence.inspectionDigest;
        transition.evidence.installationReceipt.managerInspectionDigest =
          transition.evidence.inspectionDigest;
        transition.evidence.installationReceipt.managerIdentityDigest =
          prePidTimerManagerIdentityDigest(transition.evidence.inspection);
      }
    }
    const installedEvidence = legacy.transitions.find(
      (transition) => transition.phase === 'installed',
    ).evidence;
    const legacyContract = resign({
      ...installed.contract,
      timerInstallationReceipt: structuredClone(
        installedEvidence.installationReceipt,
      ),
    });
    installedEvidence.installedWaitDigest = sha256Text(canonicalJson(
      legacyContract,
    ));
    const resignedLegacy = resignTimerJournal(legacy);
    assert.equal(verifyRetentionTimerJournal({
      journal: resignedLegacy,
      contract: legacyContract,
      signingSecret: secret,
    }), true);
    fs.writeFileSync(
      fixture.waitPath,
      `${JSON.stringify(legacyContract, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      fixture.persisted.timerJournalPath,
      `${JSON.stringify(resignedLegacy, null, 2)}\n`,
      { mode: 0o600 },
    );
    runtime.fire(fixture.persisted.resumeAt);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: legacyContract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_timer_journal_schema_migration') {
          throw new Error('crash:after_timer_journal_schema_migration');
        }
      },
    }), /crash:after_timer_journal_schema_migration/);
    const migrated = JSON.parse(fs.readFileSync(
      fixture.persisted.timerJournalPath,
      'utf8',
    ));
    assert.equal(
      migrated.schemaVersion,
      'cortex.learning_os.retention_timer_journal.v3',
    );
    assert.equal(migrated.phase, 'installed');
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.equal(verifyRetentionTimerJournal({
      journal: migrated,
      contract: legacyContract,
      signingSecret: secret,
    }), true);

    const recovered = processRetentionResumeTimerFiring({
      contract: legacyContract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(
      recovered.journal.transitions.find(
        (transition) => transition.phase === 'fired',
      ).evidence.managerFiringReceipt.schemaVersion,
      'cortex.learning_os.retention_timer_manager_firing_receipt.v1',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('released-wait retry consumes the committed invocation receipt after service restart', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-release-receipt-retry-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_released_wait') {
          throw new Error('crash:after_released_wait');
        }
      },
    }), /crash:after_released_wait/);
    const committed = JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8'));
    assert.equal(committed.timerReleased, true);
    const committedReceipt = structuredClone(committed.timerReleaseReceipt);

    runtime.rotateServiceInvocation();
    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:06:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.deepEqual(
      recovered.contract.timerReleaseReceipt,
      committedReceipt,
    );
    assert.notEqual(
      recovered.contract.timerReleaseReceipt.releaseServiceInvocationId,
      runtime.serviceInvocationId(),
    );
    assert.notEqual(
      recovered.contract.timerReleaseReceipt.releaseServiceMainPid,
      runtime.serviceMainPid(),
    );
    assert.equal(
      recovered.contract.timerReleaseReceipt.releaseTimerInvocationId,
      runtime.timerInvocationId(),
    );
    assert.equal(verifyRetentionTimerJournal({
      journal: recovered.journal,
      contract: recovered.contract,
      signingSecret: secret,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fired journal commit keeps both durable unit descriptors pinned', () => {
  for (const mutation of [
    'delete-service',
    'delete-timer',
    'replace-service',
    'replace-timer',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-journal-pin-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.endsWith('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      let releaseBuilt = false;
      let mutated = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (mutated
              || phase
                !== 'after_fired_journal_write_before_unit_revalidation') {
            return;
          }
          mutated = true;
          fs.unlinkSync(unitPath);
          if (mutation.startsWith('replace')) {
            fs.writeFileSync(
              unitPath,
              `[Unit]\nDescription=hostile post-journal ${unitKind}\n`,
              { mode: 0o644 },
            );
          }
        },
      }), /durable retention timer unit changed/, mutation);
      assert.equal(mutated, true, mutation);
      assert.equal(releaseBuilt, false, mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
      const firedJournal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(firedJournal.phase, 'fired', mutation);
      assert.equal(verifyRetentionTimerJournal({
        journal: firedJournal,
        contract: installed.contract,
        signingSecret: secret,
      }), true, mutation);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
      }), /durable retention timer unit/, mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired journal retries revalidate current manager state under pinned units', () => {
  for (const managerAttack of ['exec', 'timer-drop-in', 'changed-trigger']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-fired-manager-retry-${managerAttack}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase === 'after_fired') throw new Error('crash:after-fired');
        },
      }), /crash:after-fired/);
      const firedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      const unitDirectory = path.join(root, '.retention-systemd-units');
      const unitIdentities = ['service', 'timer'].map((kind) => {
        const stat = fs.statSync(
          path.join(unitDirectory, `${runtime.unitBase}.${kind}`),
          { bigint: true },
        );
        return `${stat.dev}:${stat.ino}`;
      });
      const attackedRuntime = fakeTimerRuntime(fixture.persisted, {
        installed: true,
        fired: true,
        ...(managerAttack === 'changed-trigger'
          ? {}
          : { mismatch: managerAttack }),
      });
      if (managerAttack === 'changed-trigger') {
        attackedRuntime.fire('2026-07-28T11:01:00.000Z');
      }
      let releaseBuilt = false;
      let observedPinnedRevalidation = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: attackedRuntime.commandRunner,
        releaseBuilder(firedAt) {
          releaseBuilt = true;
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:06:00.000Z',
        crashInjector(phase) {
          if (phase !== 'before_release_construction_manager_inspection') return;
          const openIdentities = new Set(
            fs.readdirSync('/proc/self/fd').flatMap((entry) => {
              try {
                const stat = fs.fstatSync(Number(entry), { bigint: true });
                return [`${stat.dev}:${stat.ino}`];
              } catch {
                return [];
              }
            }),
          );
          assert.equal(
            unitIdentities.every((identity) => openIdentities.has(identity)),
            true,
          );
          observedPinnedRevalidation = true;
        },
      }), /retention timer manager firing changed after authenticated commit/);
      assert.equal(observedPinnedRevalidation, true, managerAttack);
      assert.equal(releaseBuilt, false, managerAttack);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        firedJournalBytes,
        managerAttack,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, managerAttack);

      const recovered = processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:07:00.000Z',
      });
      assert.equal(recovered.released, true, managerAttack);
      assert.equal(recovered.journal.phase, 'released', managerAttack);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('fired journal retry does not mistake failed manager queries for clean absence', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-manager-query-failure-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire(fixture.persisted.resumeAt);
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_fired') throw new Error('crash:after-fired');
      },
    }), /crash:after-fired/);
    const firedJournalBytes = fs.readFileSync(
      fixture.persisted.timerJournalPath,
    );
    let releaseBuilt = false;
    const failedManagerRunner = (command, argv, options) => {
      if (command === '/fake/systemctl' && argv[0] === 'show') {
        return {
          status: 1,
          stdout: `Id=${argv[1]}\nLoadState=not-found\n`,
          stderr: 'failed to connect to the system manager',
        };
      }
      return runtime.commandRunner(command, argv, options);
    };
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: failedManagerRunner,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:06:00.000Z',
    }), /retention timer inspection failed: failed to connect to the system manager/);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      firedJournalBytes,
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);

    const absentManagerRunner = (command, argv, options) => {
      if (command === '/fake/systemctl' && argv[0] === 'show') {
        return {
          status: 0,
          stdout: `Id=${argv[1]}\nLoadState=not-found\n`,
          stderr: '',
        };
      }
      return runtime.commandRunner(command, argv, options);
    };
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: absentManagerRunner,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:06:15.000Z',
    }), /manager firing changed.*absent from the current manager/);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      firedJournalBytes,
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);

    const wrongAbsentIdentityRunner = (command, argv, options) => {
      if (command === '/fake/systemctl' && argv[0] === 'show') {
        return {
          status: 0,
          stdout: `Id=attacker-${argv[1]}\nLoadState=not-found\n`,
          stderr: '',
        };
      }
      return runtime.commandRunner(command, argv, options);
    };
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: wrongAbsentIdentityRunner,
      releaseBuilder(firedAt) {
        releaseBuilt = true;
        return exactRelease(firedAt);
      },
      now: '2026-07-28T11:06:30.000Z',
    }), /retention timer absent-unit inspection identity mismatch/);
    assert.equal(releaseBuilt, false);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      firedJournalBytes,
    );
    assert.equal(fs.existsSync(fixture.releasePath), false);

    const recovered = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:07:00.000Z',
    });
    assert.equal(recovered.released, true);
    assert.equal(recovered.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release recovery reopens durable unit files after a fired-journal crash', () => {
  for (const mutation of ['delete-service', 'replace-timer', 'recreate-exact-service']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-unit-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (phase === 'after_fired') throw new Error('crash:after_fired');
        },
      }), /crash:after_fired/);
      const firedJournalBytes = fs.readFileSync(
        fixture.persisted.timerJournalPath,
      );
      const unitKind = mutation.includes('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const exactUnitBytes = fs.readFileSync(unitPath);
      fs.unlinkSync(unitPath);
      if (mutation === 'replace-timer') {
        fs.writeFileSync(
          unitPath,
          '[Unit]\nDescription=hostile post-fired cached timer\n',
          { mode: 0o644 },
        );
      } else if (mutation === 'recreate-exact-service') {
        fs.writeFileSync(unitPath, exactUnitBytes, { mode: 0o644 });
      }

      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:06:00.000Z',
      }), /durable retention timer unit|ELOOP|ENOTDIR/, mutation);
      assert.deepEqual(
        fs.readFileSync(fixture.persisted.timerJournalPath),
        firedJournalBytes,
        mutation,
      );
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('release assembly cannot outlive its authenticated durable unit observation', () => {
  for (const mutation of ['delete-service', 'replace-timer', 'recreate-exact-service']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-assembly-unit-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.includes('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      const exactUnitBytes = fs.readFileSync(unitPath);
      let releaseAssembled = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder(firedAt) {
          releaseAssembled = true;
          fs.unlinkSync(unitPath);
          if (mutation === 'replace-timer') {
            fs.writeFileSync(
              unitPath,
              '[Unit]\nDescription=hostile during release assembly\n',
              { mode: 0o644 },
            );
          } else if (mutation === 'recreate-exact-service') {
            fs.writeFileSync(unitPath, exactUnitBytes, { mode: 0o644 });
          }
          return exactRelease(firedAt);
        },
        now: '2026-07-28T11:05:00.000Z',
      }), /durable retention timer unit|ELOOP|ENOTDIR/, mutation);
      assert.equal(releaseAssembled, true, mutation);
      const journal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(journal.phase, 'fired', mutation);
      assert.equal(journal.transitions.at(-1).phase, 'fired', mutation);
      assert.equal(fs.existsSync(fixture.releasePath), false, mutation);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        mutation,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('release file and journal commits keep the durable unit pair pinned', () => {
  for (const [mutationPhase, mutation] of [
    ['after_release_write', 'delete-service'],
    ['after_release_write', 'replace-timer'],
    ['after_released', 'delete-timer'],
    ['after_released', 'replace-service'],
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-commit-pin-${mutationPhase}-${mutation}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      const installed = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire(fixture.persisted.resumeAt);
      const unitKind = mutation.endsWith('service') ? 'service' : 'timer';
      const unitPath = path.join(
        root,
        '.retention-systemd-units',
        `${runtime.unitBase}.${unitKind}`,
      );
      let mutated = false;
      assert.throws(() => processRetentionResumeTimerFiring({
        contract: installed.contract,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:05:00.000Z',
        crashInjector(phase) {
          if (mutated || phase !== mutationPhase) return;
          mutated = true;
          fs.unlinkSync(unitPath);
          if (mutation.startsWith('replace')) {
            fs.writeFileSync(
              unitPath,
              `[Unit]\nDescription=hostile ${mutationPhase} ${unitKind}\n`,
              { mode: 0o644 },
            );
          }
        },
      }), /durable retention timer unit/, `${mutationPhase}:${mutation}`);
      assert.equal(mutated, true, `${mutationPhase}:${mutation}`);
      assert.equal(fs.existsSync(fixture.releasePath), true);
      const journal = JSON.parse(fs.readFileSync(
        fixture.persisted.timerJournalPath,
        'utf8',
      ));
      assert.equal(
        journal.phase,
        mutationPhase === 'after_release_write' ? 'fired' : 'released',
        `${mutationPhase}:${mutation}`,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        `${mutationPhase}:${mutation}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('durable retention unit links fsync the unit inode before the parent directory', () => {
  for (const unitKind of ['service', 'timer']) {
    for (const boundary of ['link', 'finalize']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-retention-${unitKind}-${boundary}-fsync-order-`,
      ));
      const originalFsyncSync = fs.fsyncSync;
      const fsyncs = [];
      try {
        const fixture = persistedWait(root);
        const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
        const unitDirectory = path.join(root, '.retention-systemd-units');
        const unitPath = path.join(
          unitDirectory,
          `${runtime.unitBase}.${unitKind}`,
        );
        fs.fsyncSync = function recordRetentionUnitFsync(descriptor) {
          const stat = fs.fstatSync(descriptor, { bigint: true });
          fsyncs.push({
            dev: stat.dev,
            ino: stat.ino,
            isDirectory: stat.isDirectory(),
            nlink: stat.nlink,
          });
          return originalFsyncSync.call(fs, descriptor);
        };
        const crashPhase = `after_${unitKind}_unit_${boundary}_fsync`;
        assert.throws(() => installRetentionResumeTimer({
          contract: fixture.persisted,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: runtime.commandRunner,
          now: '2026-07-28T10:05:00.000Z',
          crashInjector(phase) {
            if (phase !== crashPhase) return;
            const unit = fs.statSync(unitPath, { bigint: true });
            const parent = fs.statSync(unitDirectory, { bigint: true });
            assert.deepEqual(fsyncs.slice(-2), [
              {
                dev: unit.dev,
                ino: unit.ino,
                isDirectory: false,
                nlink: boundary === 'link' ? 2n : 1n,
              },
              {
                dev: parent.dev,
                ino: parent.ino,
                isDirectory: true,
                nlink: parent.nlink,
              },
            ]);
            throw new Error(`crash:${crashPhase}`);
          },
        }), new RegExp(`crash:${crashPhase}`));
        assert.equal(
          JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
          false,
        );
        fs.fsyncSync = originalFsyncSync;
        const recovered = installRetentionResumeTimer({
          contract: fixture.persisted,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: runtime.commandRunner,
          now: '2026-07-28T10:06:00.000Z',
        });
        assert.equal(recovered.contract.timerInstalled, true);
        assert.equal(recovered.journal.phase, 'installed');
        assert.equal(fs.statSync(unitPath).nlink, 1);
      } finally {
        fs.fsyncSync = originalFsyncSync;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('durable retention unit publication recovers pre-write and hard-link power-crash windows', () => {
  for (const crashPhase of [
    'after_service_unit_stage_create',
    'after_service_unit_stage_fsync',
    'after_service_unit_link',
    'after_service_unit_link_fsync',
    'after_service_unit_finalize_fsync',
    'after_timer_unit_stage_create',
    'after_timer_unit_stage_fsync',
    'after_timer_unit_link',
    'after_timer_unit_link_fsync',
    'after_timer_unit_finalize_fsync',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-unit-link-cut-${crashPhase}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
        crashInjector: (phase) => {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));

      const unitDirectory = path.join(root, '.retention-systemd-units');
      const affectedUnit = crashPhase.includes('service')
        ? `${runtime.unitBase}.service`
        : `${runtime.unitBase}.timer`;
      const affectedPath = path.join(unitDirectory, affectedUnit);
      const stages = fs.readdirSync(unitDirectory)
        .filter((name) => name.startsWith(`.${affectedUnit}.staging-`));
      if (crashPhase.includes('finalize')) {
        assert.equal(stages.length, 0, crashPhase);
        assert.equal(fs.statSync(affectedPath).nlink, 1, crashPhase);
      } else {
        assert.equal(stages.length, 1, crashPhase);
      }
      const stagePath = stages.length === 1
        ? path.join(unitDirectory, stages[0])
        : null;
      if (crashPhase.includes('stage_')) {
        assert.equal(fs.existsSync(affectedPath), false, crashPhase);
        assert.equal(fs.statSync(stagePath).nlink, 1, crashPhase);
        if (crashPhase.endsWith('stage_create')) {
          assert.equal(fs.statSync(stagePath).size, 0, crashPhase);
        } else {
          assert.equal(fs.statSync(stagePath).size > 0, true, crashPhase);
        }
      } else if (!crashPhase.includes('finalize')) {
        assert.equal(fs.statSync(affectedPath).nlink, 2, crashPhase);
        assert.equal(fs.statSync(stagePath).nlink, 2, crashPhase);
      }

      const recovered = installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:06:00.000Z',
      });
      assert.equal(recovered.contract.timerInstalled, true, crashPhase);
      assert.equal(recovered.contract.timerReleased, false, crashPhase);
      assert.equal(recovered.journal.phase, 'installed', crashPhase);
      assert.equal(fs.statSync(affectedPath).nlink, 1, crashPhase);
      assert.equal(
        fs.readdirSync(unitDirectory).some((name) => name.includes('.staging-')),
        false,
        crashPhase,
      );
      assert.equal(runtime.installCalls(), 1, crashPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('durable retention unit recovery rejects corruption after its sealed-stage marker', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-unit-sealed-stage-corruption-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector(phase) {
        if (phase === 'after_service_unit_stage_fsync') {
          throw new Error(`crash:${phase}`);
        }
      },
    }), /crash:after_service_unit_stage_fsync/);

    const unitDirectory = path.join(root, '.retention-systemd-units');
    const serviceName = `${runtime.unitBase}.service`;
    const stages = fs.readdirSync(unitDirectory).filter(
      (name) => name.startsWith(`.${serviceName}.staging-`),
    );
    assert.equal(stages.length, 1);
    const stagePath = path.join(unitDirectory, stages[0]);
    const sealedBytes = fs.readFileSync(stagePath);
    const corruptedBytes = Buffer.from(sealedBytes);
    corruptedBytes[0] = corruptedBytes[0] === 0x23 ? 0x3b : 0x23;
    fs.writeFileSync(stagePath, corruptedBytes);
    assert.equal(fs.statSync(stagePath).mode & 0o7777, 0o644);

    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    }), /corrupted sealed staging entry/);
    assert.equal(fs.existsSync(stagePath), true);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    assert.equal(runtime.installCalls(), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable retention unit publication reports an undurable failed-link cleanup and retries', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-unit-failed-link-cleanup-',
  ));
  const originalLinkSync = fs.linkSync;
  const originalFsyncSync = fs.fsyncSync;
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const serviceName = `${runtime.unitBase}.service`;
    const unitDirectory = path.join(root, '.retention-systemd-units');
    let rejectedLink = false;
    let rejectedCleanupFsync = false;
    fs.linkSync = function rejectServiceUnitLink(source, target) {
      if (!rejectedLink
          && String(source).includes(`.${serviceName}.staging-`)
          && String(target).endsWith(`/${serviceName}`)) {
        rejectedLink = true;
        throw new Error('simulated durable unit link failure');
      }
      return originalLinkSync.call(fs, source, target);
    };
    fs.fsyncSync = function rejectFailedLinkCleanupFsync(descriptor) {
      if (rejectedLink && !rejectedCleanupFsync) {
        const observation = fs.fstatSync(descriptor);
        if (observation.isDirectory()) {
          rejectedCleanupFsync = true;
          throw new Error('simulated cleanup directory fsync failure');
        }
      }
      return originalFsyncSync.call(fs, descriptor);
    };
    let failure;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    }), (error) => {
      failure = error;
      return true;
    });
    assert.equal(rejectedLink, true);
    assert.equal(rejectedCleanupFsync, true);
    assert.equal(failure instanceof AggregateError, true);
    assert.match(
      failure.message,
      /could not durably discard uncommitted durable retention unit stage/,
    );
    assert.deepEqual(
      failure.errors.map((error) => error.message),
      [
        'simulated durable unit link failure',
        'simulated cleanup directory fsync failure',
      ],
    );
    assert.equal(
      fs.readdirSync(unitDirectory).some((name) => name.includes('.staging-')),
      false,
    );
    assert.equal(fs.existsSync(path.join(unitDirectory, serviceName)), false);
    fs.linkSync = originalLinkSync;
    fs.fsyncSync = originalFsyncSync;
    const recovered = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:06:00.000Z',
    });
    assert.equal(recovered.contract.timerInstalled, true);
    assert.equal(recovered.journal.phase, 'installed');
  } finally {
    fs.linkSync = originalLinkSync;
    fs.fsyncSync = originalFsyncSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable retention unit publication stays on one authenticated directory descriptor', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-unit-directory-swap-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const unitDirectory = path.join(root, '.retention-systemd-units');
    const displaced = `${unitDirectory}.displaced`;
    let swapped = false;
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector: (phase) => {
        if (phase !== 'after_service_unit_stage_fsync' || swapped) return;
        fs.renameSync(unitDirectory, displaced);
        fs.mkdirSync(unitDirectory, { mode: 0o700 });
        swapped = true;
      },
    }), /durable retention timer unit directory identity changed/);
    assert.equal(swapped, true);
    assert.deepEqual(fs.readdirSync(unitDirectory), []);
    assert.equal(
      fs.readdirSync(displaced).includes(`${runtime.unitBase}.service`),
      true,
    );
    assert.equal(runtime.installCalls(), 0);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer rejects mismatched units and exact timer properties', () => {
  for (const mismatch of [
    'service-unit',
    'timer-unit',
    'exec',
    'environment',
    'restart',
    'persistent',
    'collect-mode',
    'calendar',
    'last-trigger',
    'service-drop-in',
    'timer-drop-in',
    'service-daemon-reload-needed',
    'timer-daemon-reload-needed',
    'exec-condition',
    'exec-start-pre',
    'exec-start-post',
    'exec-reload',
    'exec-stop',
    'exec-stop-post',
    'environment-files',
    'pass-environment',
    'unset-environment',
    'root-directory',
    'mount-api-vfs',
    'bind-read-only',
    'bind-read-write',
    'monotonic-trigger',
    'clock-change',
    'timezone-change',
    'random-delay',
    'fixed-random-delay',
    'wake-system',
    'remain-after-elapse',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-mismatch-${mismatch}-`));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: true, mismatch });
      assert.throws(() => installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      }), /identity or content mismatch/);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
        false,
        mismatch,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('retention timer rejects every hostile effective command before and after due', () => {
  for (const mismatch of [
    'exec-path',
    'exec-argv0',
    'exec-token-boundary',
    'exec-appended',
    'exec-ignore-errors',
    'exec-privileged',
    'exec-no-setuid',
    'exec-ambient',
    'exec-no-env-expand',
    'exec-unparsed',
  ]) {
    for (const afterDue of [false, true]) {
      const label = `${mismatch}-${afterDue ? 'after' : 'before'}-due`;
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-retention-hostile-command-${label}-`,
      ));
      try {
        const fixture = persistedWait(root);
        const pendingRuntime = fakeTimerRuntime(
          fixture.persisted,
          { installed: false },
        );
        assert.throws(() => installRetentionResumeTimer({
          contract: fixture.persisted,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: pendingRuntime.commandRunner,
          now: '2026-07-28T10:01:00.000Z',
          crashInjector: (phase) => {
            if (phase === 'after_pending') throw new Error('crash:after_pending');
          },
        }), /crash:after_pending/, label);
        const pendingJournalBytes = fs.readFileSync(
          fixture.persisted.timerJournalPath,
        );
        const hostileRuntime = fakeTimerRuntime(
          fixture.persisted,
          { installed: true, mismatch },
        );
        assert.throws(() => installRetentionResumeTimer({
          contract: fixture.persisted,
          waitPath: fixture.waitPath,
          signingSecret: secret,
          systemctl: '/fake/systemctl',
          commandRunner: hostileRuntime.commandRunner,
          now: afterDue
            ? '2026-07-28T11:05:00.000Z'
            : '2026-07-28T10:05:00.000Z',
        }), /identity or content mismatch.*ExecStart/, label);
        assert.deepEqual(
          fs.readFileSync(fixture.persisted.timerJournalPath),
          pendingJournalBytes,
          label,
        );
        assert.equal(
          JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
          false,
          label,
        );
        assert.equal(hostileRuntime.daemonReloadCalls(), 1, label);
        assert.equal(hostileRuntime.installCalls(), 0, label);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('retention timer rejects a pre-due active resume service without journal advancement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-premature-service-'));
  try {
    const fixture = persistedWait(root);
    const pendingRuntime = fakeTimerRuntime(fixture.persisted, { installed: false });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: pendingRuntime.commandRunner,
      now: '2026-07-28T10:01:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_pending') throw new Error('crash:after_pending');
      },
    }), /crash:after_pending/);
    const pendingJournalBytes = fs.readFileSync(fixture.persisted.timerJournalPath);
    const hostileRuntime = fakeTimerRuntime(
      fixture.persisted,
      { installed: true, mismatch: 'premature-service' },
    );
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: hostileRuntime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    }), /identity or content mismatch.*premature ActiveState.*premature SubState/);
    assert.deepEqual(
      fs.readFileSync(fixture.persisted.timerJournalPath),
      pendingJournalBytes,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    assert.equal(hostileRuntime.installCalls(), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer binds the effective calendar after due when next elapse is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-post-due-calendar-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, {
      installed: true,
      fired: true,
      mismatch: 'calendar-after-due',
    });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T11:05:00.000Z',
    }), /identity or content mismatch.*TimersCalendar/);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention timer rejects a signature-valid journal copied from another wait', () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-stale-first-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-stale-second-'));
  try {
    const first = persistedWait(firstRoot);
    const firstRuntime = fakeTimerRuntime(first.persisted, { installed: false });
    installRetentionResumeTimer({
      contract: first.persisted,
      waitPath: first.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: firstRuntime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const second = persistedWait(secondRoot);
    fs.copyFileSync(first.persisted.timerJournalPath, second.persisted.timerJournalPath);
    const secondRuntime = fakeTimerRuntime(second.persisted, { installed: true });
    assert.throws(() => installRetentionResumeTimer({
      contract: second.persisted,
      waitPath: second.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: secondRuntime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    }), /journal is stale, tampered, or inconsistent/);
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test('retention timer never reconstructs a missing journal after installed publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-missing-journal-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    fs.unlinkSync(fixture.persisted.timerJournalPath);
    assert.throws(() => installRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      dryRun: true,
      now: '2026-07-28T10:06:00.000Z',
    }), /missing its durable journal/);
    assert.equal(fs.existsSync(fixture.persisted.timerJournalPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function exactRelease(firedAt) {
  return {
    schemaVersion: 'cortex.learning_os.retention_window_release.fixture.v1',
    subjectId: 'durable-candidate',
    releasedAt: firedAt,
    items: [],
    truthBoundary: 'Fixture-only exact due release; it is not retention evidence.',
  };
}

test('post-due reconciliation survives crashes at fired and released successor phases', () => {
  for (const crashPhase of [
    'after_durable_service_unit_observation',
    'after_durable_timer_unit_observation',
    'before_durable_unit_observation_commit',
    'after_durable_unit_pinned_descriptor_release_before_return_witness',
    'after_durable_unit_return_witness_descriptor_release_before_confirmation',
    'after_fired',
    'after_release_write',
    'after_released',
    'after_released_wait',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-retention-${crashPhase}-`));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire();
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:00:00.000Z',
        crashInjector: (phase) => {
          if (phase === crashPhase) throw new Error(`crash:${phase}`);
        },
      }), new RegExp(`crash:${crashPhase}`));
      const recovered = reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:01:00.000Z',
      });
      assert.equal(recovered.released, true, crashPhase);
      assert.equal(recovered.contract.timerReleased, true, crashPhase);
      assert.equal(recovered.journal.phase, 'released', crashPhase);
      assert.equal(
        verifyRetentionWaitContract(recovered.contract, secret),
        true,
        `released wait:${crashPhase}`,
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(fixture.releasePath, 'utf8')),
        exactRelease('2026-07-28T11:00:00.000Z'),
        crashPhase,
      );
      assert.equal(verifyRetentionTimerJournal({
        journal: recovered.journal,
        contract: recovered.contract,
        signingSecret: secret,
      }), true, crashPhase);
      const releaseFileSha256 = crypto.createHash('sha256')
        .update(fs.readFileSync(fixture.releasePath))
        .digest('hex');
      assert.equal(
        recovered.journal.transitions.at(-1).evidence.releaseFileSha256,
        releaseFileSha256,
        crashPhase,
      );
      assert.equal(recovered.contract.releaseFileSha256, releaseFileSha256, crashPhase);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('post-due reconciliation requires the exact release file bytes', () => {
  const substitutions = {
    whitespace: (expected) => expected.replace('{\n', '{\n  \n'),
    reordered_keys: (expected) => {
      const value = JSON.parse(expected);
      return `${JSON.stringify(Object.fromEntries(Object.entries(value).reverse()), null, 2)}\n`;
    },
    duplicate_key: (expected) => {
      const value = JSON.parse(expected);
      return `{\n  "schemaVersion": ${JSON.stringify(value.schemaVersion)},${expected.slice(1)}`;
    },
    trailing_byte: (expected) => `${expected} `,
  };
  for (const [substitution, mutate] of Object.entries(substitutions)) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-retention-release-bytes-${substitution}-`,
    ));
    try {
      const fixture = persistedWait(root);
      const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
      installRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        now: '2026-07-28T10:05:00.000Z',
      });
      runtime.fire();
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:00:00.000Z',
        crashInjector: (phase) => {
          if (phase === 'after_release_write') throw new Error('crash:after_release_write');
        },
      }), /crash:after_release_write/);
      const expected = fs.readFileSync(fixture.releasePath, 'utf8');
      const substituted = mutate(expected);
      assert.deepEqual(JSON.parse(substituted), JSON.parse(expected), substitution);
      assert.notEqual(substituted, expected, substitution);
      fs.writeFileSync(fixture.releasePath, substituted, { mode: 0o600 });
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        releaseBuilder: exactRelease,
        now: '2026-07-28T11:01:00.000Z',
      }), /successor already exists with different bytes/, substitution);
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.persisted.timerJournalPath, 'utf8')).phase,
        'fired',
        substitution,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerReleased,
        false,
        substitution,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('post-due reconciliation repairs firing before installed publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-fired-before-publish-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    assert.throws(() => installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_inspected') throw new Error('crash:after_inspected');
      },
    }), /crash:after_inspected/);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.waitPath, 'utf8')).timerInstalled,
      false,
    );
    runtime.fire();
    const reconciled = reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
    });
    assert.equal(reconciled.contract.timerInstalled, true);
    assert.equal(reconciled.contract.timerReleased, true);
    assert.equal(reconciled.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('post-due reconciliation binds release to the exact inspected external firing time', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-exact-fired-at-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire('2026-07-28T11:00:30.000Z');
    const reconciled = reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:01:00.000Z',
    });
    assert.equal(reconciled.release.releasedAt, '2026-07-28T11:00:30.000Z');
    assert.equal(reconciled.contract.timerFiredAt, '2026-07-28T11:00:30.000Z');
    assert.equal(
      reconciled.journal.transitions.find((row) => row.phase === 'fired').evidence.firedAt,
      '2026-07-28T11:00:30.000Z',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('post-due reconciliation rejects rollback to an older authenticated journal prefix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-journal-rollback-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    const inspectedJournal = fs.readFileSync(fixture.persisted.timerJournalPath);
    runtime.fire();
    const released = reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
    });
    fs.writeFileSync(fixture.persisted.timerJournalPath, inspectedJournal, { mode: 0o600 });
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: released.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:01:00.000Z',
    }), /rolled back/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('post-due dry-run cannot manufacture fired or released journal evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-due-dry-run-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire();
    const preview = reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      dryRun: true,
      now: '2026-07-28T11:00:00.000Z',
    });
    assert.equal(preview.released, false);
    assert.equal(preview.release, null);
    assert.equal(preview.journal.phase, 'installed');
    assert.equal(fs.existsSync(fixture.releasePath), false);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.persisted.timerJournalPath, 'utf8')).phase,
      'installed',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fixture preview clean exit is recovered after reboot by rearming the exact due service', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-preview-reboot-recovery-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire();
    const preview = processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      dryRun: true,
      now: '2026-07-28T11:00:00.000Z',
    });
    assert.equal(preview.released, false);
    assert.equal(preview.journal.phase, 'installed');
    runtime.cleanExit();
    runtime.reboot();

    assert.throws(() => reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T11:05:00.000Z',
    }), /repair successor recorded and retry is required/);
    const rearmed = reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T11:05:01.000Z',
    });
    assert.equal(rearmed.released, false);
    assert.equal(rearmed.retry.started, true);
    assert.equal(rearmed.retry.alreadyActive, false);
    assert.equal(runtime.retryResetCalls(), 1);
    assert.equal(runtime.retryStartCalls(), 1);

    const released = processRetentionResumeTimerFiring({
      contract: rearmed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:05:02.000Z',
    });
    assert.equal(released.released, true);
    assert.equal(released.contract.timerReleased, true);
    assert.equal(released.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('privileged reconciliation restarts authenticated fired-but-unreleased service with no retry', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-retention-fired-retry-recovery-',
  ));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    const installed = installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire();
    assert.throws(() => processRetentionResumeTimerFiring({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_fired') throw new Error('crash:after_fired');
      },
    }), /crash:after_fired/);
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.persisted.timerJournalPath, 'utf8')).phase,
      'fired',
    );
    runtime.cleanExit();

    const rearmed = reconcileRetentionResumeTimer({
      contract: installed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T11:01:00.000Z',
    });
    assert.equal(rearmed.retry.started, true);
    assert.equal(rearmed.journal.phase, 'fired');
    assert.equal(runtime.retryResetCalls(), 1);
    assert.equal(runtime.retryStartCalls(), 1);

    const released = processRetentionResumeTimerFiring({
      contract: rearmed.contract,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:01:01.000Z',
    });
    assert.equal(released.released, true);
    assert.equal(released.contract.timerReleased, true);
    assert.equal(released.journal.phase, 'released');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention release rejects premature, mismatched firing, duplicate, and tampered journal state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-release-reject-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T10:59:59.999Z',
    }), /premature/);
    runtime.fire('2026-07-28T11:01:00.000Z');
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
    }), /no exact fired evidence/);
    runtime.fire();
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: '0'.repeat(64),
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
    }), /firing identity/);
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:00:00.000Z',
      crashInjector: (phase) => {
        if (phase === 'after_fired') throw new Error('crash:after_fired');
      },
    }), /crash:after_fired/);
    fs.writeFileSync(fixture.releasePath, '{"substituted":true}\n', { mode: 0o600 });
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:01:00.000Z',
    }), /successor already exists/);
    fs.unlinkSync(fixture.releasePath);
    const journal = JSON.parse(fs.readFileSync(fixture.persisted.timerJournalPath, 'utf8'));
    journal.transitions[0].evidence.timerSpecDigest = 'f'.repeat(64);
    fs.writeFileSync(
      fixture.persisted.timerJournalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      releaseBuilder: exactRelease,
      now: '2026-07-28T11:01:00.000Z',
    }), /journal is stale, tampered, or inconsistent/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timer reconciliation cannot release a different plan or deployment closure identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-retention-closure-bind-'));
  try {
    const fixture = persistedWait(root);
    const runtime = fakeTimerRuntime(fixture.persisted, { installed: false });
    installRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      now: '2026-07-28T10:05:00.000Z',
    });
    runtime.fire();
    const mismatchedFixtureOnly = [0, 1, 'true', {}, [], false];
    for (const hostileFixtureOnly of mismatchedFixtureOnly) {
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseInputs: {
          fixtureOnly: hostileFixtureOnly,
          task: {
            fixtureOnly: true,
            subjectId: fixture.persisted.subjectId,
            deploymentDigest: fixture.persisted.deploymentDigest,
            acquisitionBinding: {
              stateDigest: fixture.persisted.acquisitionStateDigest,
            },
          },
          deployment: qualificationPlan().deployment,
        },
        now: '2026-07-28T11:00:00.000Z',
      }), /release fixture mode differs from the signed wait/);
    }
    for (const hostileFixtureOnly of mismatchedFixtureOnly) {
      assert.throws(() => reconcileRetentionResumeTimer({
        contract: fixture.persisted,
        waitPath: fixture.waitPath,
        signingSecret: secret,
        systemdRun: '/fake/systemd-run',
        systemctl: '/fake/systemctl',
        commandRunner: runtime.commandRunner,
        firingSpecDigest: runtime.specDigest,
        releaseInputs: {
          fixtureOnly: true,
          task: {
            fixtureOnly: hostileFixtureOnly,
            subjectId: fixture.persisted.subjectId,
            deploymentDigest: fixture.persisted.deploymentDigest,
            acquisitionBinding: {
              stateDigest: fixture.persisted.acquisitionStateDigest,
            },
          },
          deployment: qualificationPlan().deployment,
        },
        now: '2026-07-28T11:00:00.000Z',
      }), /release fixture mode differs from the signed wait/);
    }
    assert.throws(() => reconcileRetentionResumeTimer({
      contract: fixture.persisted,
      waitPath: fixture.waitPath,
      signingSecret: secret,
      systemdRun: '/fake/systemd-run',
      systemctl: '/fake/systemctl',
      commandRunner: runtime.commandRunner,
      firingSpecDigest: runtime.specDigest,
      releaseInputs: {
        fixtureOnly: true,
        task: {
          fixtureOnly: true,
          subjectId: fixture.persisted.subjectId,
          deploymentDigest: 'f'.repeat(64),
          acquisitionBinding: { stateDigest: fixture.persisted.acquisitionStateDigest },
        },
        deployment: qualificationPlan().deployment,
      },
      now: '2026-07-28T11:00:00.000Z',
    }), /plan, deployment closure, or acquisition identity mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch verification rejects forged, tampered, inner-forged, and expired plans', () => {
  const plan = qualificationPlan();
  const now = '2026-07-28T10:00:00.000Z';
  const valid = verifyDetachedQualificationJobPlan(plan, secret, { now });
  assert.equal(valid.ok, true, valid.errors.join('; '));
  const launch = verifyQualificationLaunchPlan({ plan, signingSecret: secret, now });
  assert.equal(launch.authenticated, true);
  assert.deepEqual(launch.jobIds, ['campaign-verified.exam-1']);
  assert.equal(launch.productTree, plan.deployment.productTree);
  assert.equal(launch.runtimeSha256, plan.deployment.runtimeSha256);
  assert.equal(launch.closureSha256, plan.deployment.closureSha256);

  assert.throws(() => verifyQualificationLaunchPlan({
    plan,
    signingSecret: secret,
    expectedDeploymentDigest: '0'.repeat(64),
    now,
  }), /deployment digest mismatch/);
  assert.throws(() => verifyQualificationLaunchPlan({
    plan,
    signingSecret: secret,
    expectedSubjectId: 'different-candidate',
    now,
  }), /subject identity mismatch/);

  const forged = structuredClone(plan);
  forged.controlPlaneSignature.digest = 'f'.repeat(64);
  assert.equal(verifyDetachedQualificationJobPlan(forged, secret, { now }).ok, false);

  const tampered = structuredClone(plan);
  tampered.jobs[0].promptSha256 = 'e'.repeat(64);
  assert.equal(verifyDetachedQualificationJobPlan(tampered, secret, { now }).ok, false);

  const injected = structuredClone(plan);
  injected.jobs.push(structuredClone(injected.jobs[0]));
  const duplicateValidation = verifyDetachedQualificationJobPlan(resign(injected), secret, { now });
  assert.equal(duplicateValidation.ok, false);
  assert.match(duplicateValidation.errors.join('; '), /reuse an identity|descriptor set/);

  const removed = resign({ ...plan, jobs: [] });
  assert.equal(verifyDetachedQualificationJobPlan(removed, secret, { now }).ok, false);

  const innerForged = structuredClone(plan);
  innerForged.jobs[0].role = 'proof_candidate';
  const rewrapped = resign(innerForged);
  const innerValidation = verifyDetachedQualificationJobPlan(rewrapped, secret, { now });
  assert.equal(innerValidation.ok, false);
  assert.match(innerValidation.errors.join('; '), /job 1: detached job signature mismatch/);

  const expired = verifyDetachedQualificationJobPlan(plan, secret, {
    now: '2026-08-01T00:00:00.001Z',
  });
  assert.equal(expired.ok, false);
  assert.match(expired.errors.join('; '), /not currently authorized for launch/);
  const archival = verifyDetachedQualificationJobPlan(plan, secret, {
    now: '2026-08-02T00:00:00.000Z',
    authorization: 'archival_harvest',
  });
  assert.equal(archival.ok, true, archival.errors.join('; '));
  const exactJobBytes = Buffer.from(`${JSON.stringify(plan.jobs[0], null, 2)}\n`);
  const archivedJob = verifyExistingQualificationJob({
    plan,
    signingSecret: secret,
    jobBytes: exactJobBytes,
    job: plan.jobs[0],
    jobId: plan.jobs[0].jobId,
    expectedPlanDigest: digest(plan),
    now: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(archivedJob.exactExistingJobBytesVerified, true);
  assert.throws(() => verifyExistingQualificationJob({
    plan,
    signingSecret: secret,
    jobBytes: Buffer.from(`${JSON.stringify(plan.jobs[0])}\n`),
    job: plan.jobs[0],
    jobId: plan.jobs[0].jobId,
    expectedPlanDigest: digest(plan),
    now: '2026-08-02T00:00:00.000Z',
  }), /differs from exact authenticated bytes/);
  assert.throws(() => verifyQualificationLaunchPlan({
    plan,
    signingSecret: secret,
    now: '2026-08-02T00:00:00.000Z',
  }), /not currently authorized for launch/);
  assert.throws(() => materializeAuthenticatedQualificationJob({
    plan,
    signingSecret: secret,
    planDigest: digest(plan),
    jobId: plan.jobs[0].jobId,
    out: path.join(os.tmpdir(), `expired-${crypto.randomUUID()}.json`),
    now: '2026-08-02T00:00:00.000Z',
  }), /not currently authorized for launch/);
});

test('approved executable binding is independent, immutable, and descriptor execution survives path replacement', () => {
  const binding = approvedExecutableBinding();
  assert.equal(validateApprovedModelExecutableBinding(binding).ok, true);
  const sourceCommit = '1'.repeat(40);
  const sourceTree = '2'.repeat(40);
  const productTree = '3'.repeat(40);
  const sourceDeployment = structuredClone(qualificationPlan().deployment);
  sourceDeployment.executionClosure.immutable = true;
  sourceDeployment.executionClosure.checkoutSha256 = digest({
    files: sourceDeployment.executionClosure.files,
    entries: sourceDeployment.executionClosure.entries,
    immutable: true,
  });
  sourceDeployment.executionClosure.closureSha256 = digest({
    sourceCommit,
    sourceTree,
    productTree,
    checkoutSha256: sourceDeployment.executionClosure.checkoutSha256,
    runtimeSha256: sourceDeployment.executionClosure.runtimeSha256,
  });
  sourceDeployment.closureSha256 = sourceDeployment.executionClosure.closureSha256;
  const researchRuntime = approvedResearchRuntimeBinding();
  const deployment = bindApprovedModelExecutable(
    sourceDeployment,
    binding,
    researchRuntime,
  );
  assert.equal(
    deployment.schemaVersion,
    APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  );
  assert.equal(validateDeploymentBinding(deployment).ok, true);
  assert.deepEqual(deployment.approvedModelExecutable, binding);
  assert.deepEqual(deployment.approvedResearchRuntime, researchRuntime);
  assert.equal(assertQualificationDeployment(deployment, sourceDeployment), deployment);
  assert.throws(
    () => assertQualificationDeployment(deployment, {
      ...sourceDeployment,
      sourceCommit: 'f'.repeat(40),
    }),
    /exact executable-bound projection/,
  );

  const substitutedPath = structuredClone(binding);
  substitutedPath.path = '/home/jake/.local/bin/codex';
  assert.match(
    validateApprovedModelExecutableBinding(substitutedPath).errors.join('; '),
    /path.*detached|identity/,
  );
  const substitutedBytes = structuredClone(binding);
  substitutedBytes.bytes += 1;
  assert.match(
    validateApprovedModelExecutableBinding(substitutedBytes).errors.join('; '),
    /path, bytes, digest, or entry set/,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-executable-race-'));
  const executable = path.join(root, 'candidate.sh');
  const displaced = path.join(root, 'opened.sh');
  fs.writeFileSync(executable, '#!/bin/sh\nprintf original\n', { mode: 0o700 });
  const descriptor = fs.openSync(executable, fs.constants.O_RDONLY);
  try {
    fs.renameSync(executable, displaced);
    fs.writeFileSync(executable, '#!/bin/sh\nprintf substituted\n', { mode: 0o700 });
    const raced = spawnSync('/proc/self/fd/3', [], {
      encoding: 'utf8',
      stdio: approvedExecutableStdio(descriptor),
    });
    assert.equal(raced.status, 0, raced.stderr);
    assert.equal(raced.stdout, 'original');
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('signed harvest verification consumes the exact plan, receipt set, intervals, and manifest bytes', () => {
  const plan = qualificationPlan();
  const job = plan.jobs[0];
  const planDigest = digest(plan);
  const executionIdentity = {
    planDigest,
    campaignDigest: plan.campaignDigest,
    descriptorSetSha256: plan.descriptorSetSha256,
    productTree: plan.deployment.productTree,
    runtimeSha256: plan.deployment.runtimeSha256,
    closureSha256: plan.deployment.closureSha256,
  };
  const startedAt = '2026-07-28T10:00:00.000Z';
  const completedAt = '2026-07-28T10:01:00.000Z';
  const outputBytes = Buffer.from('{}');
  const outputSha256 = sha256Text(outputBytes);
  const rawEventLedgerBytes = Buffer.from('{"type":"response","usage":{"total_tokens":1}}\n');
  const rawStderrBytes = Buffer.alloc(0);
  const jobDigest = digest(job);
  const intervalDigest = digest({
    jobDigest,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
  });
  const command = [
    process.execPath,
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--model',
    job.modelRuntime.model,
    '--config',
    'model_reasoning_effort="xhigh"',
    '--cd',
    '/tmp/clos-harvest-model',
    '--json',
    '--output-schema',
    '/tmp/clos-harvest-model/output.schema.json',
    '--output-last-message',
    '/tmp/clos-harvest-model/output.json',
    '-',
  ];
  const usage = { total_tokens: 1 };
  const executionEvidenceCore = createExecutionEvidenceCore({
    executionKind: 'model',
    bindings: {
      candidateId: null,
      candidateSessionId: job.sessionId,
      candidateSha256: outputSha256,
      taskId: null,
      taskSha256: digest(job.task),
      jobId: job.jobId,
      jobSha256: jobDigest,
      campaignId: job.campaignId,
      campaignSha256: job.campaignDigest,
      deploymentSha256: deploymentBindingDigest(job.deployment),
      sourceSha256: executionSourceSha256(job.deployment),
    },
    declaredEnvironment: {
      executionKind: 'host_process',
      role: job.role,
      modelRuntime: job.modelRuntime,
    },
    observedEnvironment: { fixture: true },
    requestedArgv: command,
    executedArgv: command,
    executable: observeExecutableIdentity(process.execPath),
    cwd: '/tmp/clos-harvest-model',
    startedAt,
    completedAt,
    exitCode: 0,
    signal: null,
    error: null,
    input: {
      name: 'prompt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from(job.promptBase64, 'base64'),
    },
    stdout: rawEventLedgerBytes,
    stderr: rawStderrBytes,
    outputFiles: [{
      name: 'model_output',
      path: 'output.json',
      mediaType: 'application/json',
      bytes: outputBytes,
    }],
    model: {
      provider: job.modelRuntime.provider,
      model: job.modelRuntime.model,
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
      toolsUsed: [],
      usage,
      providerRequestId: 'request-1',
      providerSessionId: 'provider-session-1',
      plannedSessionId: job.sessionId,
    },
  });
  const modelCall = {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    jobId: job.jobId,
    jobDigest,
    role: job.role,
    command: command[0],
    args: command.slice(1),
    plannedSessionId: job.sessionId,
    providerRequestId: 'request-1',
    providerSessionId: 'provider-session-1',
    provider: job.modelRuntime.provider,
    model: job.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage,
    positiveUsage: true,
    isolatedDirectory: true,
    exactPromptBytes: true,
    promptSha256: job.promptSha256,
    outputSha256,
    rawEventLedgerSha256: sha256Text(rawEventLedgerBytes),
    executionIdentity,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256: intervalDigest,
    exitCode: 0,
    signal: null,
    error: null,
    postprocessError: null,
    evidenceError: null,
    stderrSha256: sha256Text(rawStderrBytes),
    executionEvidenceCore,
    executionEvidenceSha256: executionEvidenceSha256(executionEvidenceCore),
    attestation: null,
    provenanceStatus: 'awaiting_trusted_runner_attestation',
  };
  const modelCallBytes = Buffer.from(`${JSON.stringify(modelCall, null, 2)}\n`);
  const manifest = {
    schemaVersion: 'cortex.learning_os.phd_worker_manifest.v3',
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest,
    jobControlPlaneSignature: job.controlPlaneSignature,
    deployment: job.deployment,
    executor: job.executor,
    executionIdentity,
    promptSha256: job.promptSha256,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256: intervalDigest,
    status: 'candidate',
    timingProvenance: 'worker_observed_awaiting_execution_attestation',
    outputSha256,
    publication: {
      schemaVersion: 'cortex.learning_os.phd_terminal_publication.v1',
      publisherUid: 0,
      publisherGid: 0,
      rootMode: '0555',
      fileMode: '0444',
      directoryMode: '0555',
      regularFileLinkCount: 1,
      rootLinkCount: 2,
      producerWritableTerminal: false,
      noFollow: true,
      exactMetadata: true,
    },
    directories: [],
    files: [
      {
        path: 'model-call.json',
        bytes: modelCallBytes.length,
        ownerUid: 0, ownerGid: 0, mode: '0444', linkCount: 1,
        sha256: sha256Text(modelCallBytes),
      },
      {
        path: 'output.json',
        bytes: 2,
        ownerUid: 0, ownerGid: 0, mode: '0444', linkCount: 1,
        sha256: outputSha256,
      },
      {
        path: 'raw-events.ndjson',
        bytes: rawEventLedgerBytes.length,
        ownerUid: 0, ownerGid: 0, mode: '0444', linkCount: 1,
        sha256: sha256Text(rawEventLedgerBytes),
      },
      {
        path: 'stderr.raw',
        bytes: 0,
        ownerUid: 0, ownerGid: 0, mode: '0444', linkCount: 1,
        sha256: sha256Text(rawStderrBytes),
      },
    ],
    authority: 'worker_evidence_only',
    truthBoundary: 'Remote worker artifacts cannot mutate or qualify canonical control-plane state.',
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const receipt = sign({
    schemaVersion: 'cortex.learning_os.phd_harvest_receipt.v1',
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest,
    descriptorSha256: job.descriptorSha256,
    executor: job.executor,
    executionIdentity,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256: intervalDigest,
    artifactManifestSha256: sha256Text(manifestBytes),
    status: 'candidate_authenticated_for_independent_replay',
    providerTimeAuthority: false,
    canonicalStateAuthority: false,
    truthBoundary: 'Control-plane HMAC authenticates the exact plan-bound terminal artifact only.',
  });
  const state = sign({
    schemaVersion: 'cortex.learning_os.phd_harvest_state.v2',
    status: 'ready_for_independent_replay',
    planDigest,
    subjectId: plan.subjectId,
    campaignId: plan.campaignId,
    campaignDigest: plan.campaignDigest,
    deploymentDigest: deploymentBindingDigest(plan.deployment),
    descriptorSetSha256: plan.descriptorSetSha256,
    jobSetSha256: digest([job.jobId]),
    productTree: plan.deployment.productTree,
    runtimeSha256: plan.deployment.runtimeSha256,
    closureSha256: plan.deployment.closureSha256,
    liveWorkerSetSha256: '0'.repeat(64),
    expectedJobCount: 1,
    observedJobCount: 1,
    succeededJobCount: 1,
    failedJobCount: 0,
    failures: [],
    jobReceipts: [receipt],
    planSnapshotPath: '/protected/plan.v2.json',
    qualificationSecretPath: '/protected/qualification.hmac',
    artifactRoot: '/protected/artifacts',
    canonicalStateMutated: false,
    updatedAt: '2026-07-28T10:01:30.000Z',
    truthBoundary: 'Harvest completion is not qualification.',
  });
  const evidence = {
    plan,
    harvestState: state,
    artifactManifestBytesByJob: {
      [job.jobId]: manifestBytes.toString('base64'),
    },
    artifactFileBytesByJob: {
      [job.jobId]: {
        'model-call.json': modelCallBytes.toString('base64'),
        'output.json': outputBytes.toString('base64'),
        'raw-events.ndjson': rawEventLedgerBytes.toString('base64'),
        'stderr.raw': rawStderrBytes.toString('base64'),
      },
    },
    signingSecret: secret,
    now: '2026-07-28T10:02:00.000Z',
    requireArtifactFiles: true,
  };
  const valid = verifyQualificationHarvestEvidence(evidence);
  assert.equal(valid.ok, true, valid.errors.join('; '));
  assert.equal(
    Date.parse(state.updatedAt) > Math.max(...state.jobReceipts.map((row) => (
      Date.parse(row.completedAt)
    ))),
    true,
  );
  assert.equal(valid.binding.jobCount, 1);
  assert.match(valid.binding.artifactSetSha256, /^[0-9a-f]{64}$/);

  const changedManifest = {
    ...evidence,
    artifactManifestBytesByJob: {
      [job.jobId]: Buffer.from('{"substituted":true}').toString('base64'),
    },
  };
  assert.match(
    verifyQualificationHarvestEvidence(changedManifest).errors.join('; '),
    /manifest bytes/,
  );
  const changedFile = {
    ...evidence,
    artifactFileBytesByJob: {
      [job.jobId]: {
        'output.json': Buffer.from('[]').toString('base64'),
      },
    },
  };
  assert.match(
    verifyQualificationHarvestEvidence(changedFile).errors.join('; '),
    /artifact file set/,
  );
  const substitutedFileBytes = structuredClone(evidence);
  substitutedFileBytes.artifactFileBytesByJob[job.jobId]['output.json'] = Buffer.from('[]')
    .toString('base64');
  assert.match(
    verifyQualificationHarvestEvidence(substitutedFileBytes).errors.join('; '),
    /artifact file bytes/,
  );
  const removedReceipt = {
    ...evidence,
    harvestState: resign({ ...state, jobReceipts: [] }),
  };
  assert.match(
    verifyQualificationHarvestEvidence(removedReceipt).errors.join('; '),
    /count|partial/,
  );
  const changedInterval = structuredClone(state);
  changedInterval.jobReceipts[0].completedAt = '2026-07-28T10:01:01.000Z';
  changedInterval.jobReceipts[0] = resign(changedInterval.jobReceipts[0]);
  assert.match(
    verifyQualificationHarvestEvidence({
      ...evidence,
      harvestState: resign(changedInterval),
    }).errors.join('; '),
    /interval/,
  );
  const futureState = resign({
    ...state,
    updatedAt: '2026-07-28T10:02:00.001Z',
  });
  assert.match(
    verifyQualificationHarvestEvidence({
      ...evidence,
      harvestState: futureState,
    }).errors.join('; '),
    /terminal status mismatch/,
  );
});

test('committed source consumption authenticates Git blob IDs and avoids pathname rereads', () => {
  const committed = Buffer.from(
    '{"schemaVersion":"cortex.learning_os.source_fixture.v1"}\n',
    'utf8',
  );
  const header = Buffer.from(`blob ${committed.length}\0`, 'utf8');
  const objectId = crypto.createHash('sha1')
    .update(header)
    .update(committed)
    .digest('hex');
  assert.equal(
    assertGitBlobObjectIdentity(committed, objectId, 'test committed blob'),
    true,
  );
  const tampered = Buffer.from(committed);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => assertGitBlobObjectIdentity(
      tampered,
      objectId,
      'test committed blob',
    ),
    /do not match their declared Git object ID/,
  );

  assert.equal(
    assertSafeProductSourceRelativePath('policies/phd-retention-v1.json'),
    'policies/phd-retention-v1.json',
  );
  for (const unsafe of [
    '../outside.json',
    'policies//phd-retention-v1.json',
    'policies/./phd-retention-v1.json',
    'policies\\phd-retention-v1.json',
    'policies/phd-retention-v1.json\n',
    'policies/\0phd-retention-v1.json',
  ]) {
    assert.throws(
      () => assertSafeProductSourceRelativePath(unsafe),
      /safe relative path/,
      unsafe,
    );
  }

  const source = fs.readFileSync(
    path.join(closRoot, 'src', 'git-product-source.mjs'),
    'utf8',
  );
  const liveControl = fs.readFileSync(
    path.join(closRoot, 'src', 'live-control.mjs'),
    'utf8',
  );
  const committedPathReader = source.slice(
    source.indexOf('function committedProductPathSnapshot'),
    source.indexOf('export function readCommittedProductJsonPath'),
  );
  assert.match(committedPathReader, /readStableProductFile/);
  assert.doesNotMatch(committedPathReader, /lstatSync|readFileSync/);
  assert.match(
    liveControl,
    /readCommittedProductJsonPath\([\s\S]+[.]record/,
  );
  assert.doesNotMatch(liveControl, /assertCommittedProductPath/);
});

test('immutable execution closure binds recursive root ownership, types, and full safe modes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-execution-closure-'));
  try {
    fs.mkdirSync(path.join(root, 'cortex-learning-os', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'cortex-learning-os-live'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cortex-learning-os', 'src', 'runtime.mjs'), 'export {};\n');
    fs.chmodSync(path.join(root, 'cortex-learning-os', 'src', 'runtime.mjs'), 0o755);
    fs.writeFileSync(path.join(root, 'plugins', 'cortex-learning-os-live', 'registry.mjs'), 'export {};\n');
    const closure = buildWorkingTreeExecutionClosure({
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      productTree: '3'.repeat(40),
      repositoryRoot: root,
      immutable: true,
    });
    assert.equal(validateExecutionClosure(closure).ok, true);

    fs.mkdirSync(path.join(root, 'cortex-learning-os', 'extra-empty'));
    assert.throws(
      () => assertExecutionClosureEntrySetAtRoot(closure, root),
      /directory\/file set.*extra empty material/,
    );
    fs.rmdirSync(path.join(root, 'cortex-learning-os', 'extra-empty'));

    fs.symlinkSync('/tmp', path.join(root, 'cortex-learning-os', 'proof-kernel'));
    assert.throws(
      () => assertExecutionClosureEntrySetAtRoot(closure, root),
      /contains a symlink/,
    );
    fs.unlinkSync(path.join(root, 'cortex-learning-os', 'proof-kernel'));

    fs.mkdirSync(path.join(root, 'cortex-learning-os', 'proof-kernel', '.lake'), {
      recursive: true,
    });
    fs.chmodSync(path.join(root, 'cortex-learning-os', 'proof-kernel', '.lake'), 0o777);
    assert.throws(
      () => assertExecutionClosureEntrySetAtRoot(closure, root),
      /directory\/file set.*extra empty material/,
    );
    const closureWithUnsafeRuntime = buildWorkingTreeExecutionClosure({
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      productTree: '3'.repeat(40),
      repositoryRoot: root,
      immutable: true,
    });
    const unsafeRuntimeEntry = closureWithUnsafeRuntime.entries.find((entry) => (
      entry.path === 'cortex-learning-os/proof-kernel/.lake'
    ));
    assert.deepEqual(unsafeRuntimeEntry, {
      path: 'cortex-learning-os/proof-kernel/.lake',
      type: 'directory',
      uid: 0,
      gid: 0,
      mode: '0555',
    });
    const unsafeRuntimeStat = fs.lstatSync(
      path.join(root, 'cortex-learning-os', 'proof-kernel', '.lake'),
    );
    assert.equal(unsafeRuntimeStat.mode & 0o777, 0o777);
    if (typeof process.geteuid === 'function' && process.geteuid() !== 0) {
      assert.notEqual(unsafeRuntimeStat.uid, unsafeRuntimeEntry.uid);
    }
    assert.throws(
      () => assertExecutionClosureAtRoot(closureWithUnsafeRuntime, root),
      /root-owned immutable material/,
    );

    const writableNestedFile = structuredClone(closure);
    writableNestedFile.entries.find((entry) => entry.type === 'file').mode = '0644';
    assert.match(
      validateExecutionClosure(writableNestedFile).errors.join('; '),
      /filesystem binding|digest binding/,
    );
    const nonRootDirectory = structuredClone(closure);
    nonRootDirectory.entries.find((entry) => entry.type === 'directory').uid = 1000;
    assert.match(
      validateExecutionClosure(nonRootDirectory).errors.join('; '),
      /filesystem binding/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('execution closure snapshot rejects concurrent rewrites, hard links, and directory substitutions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-execution-source-race-'));
  const sourcePath = path.join(
    root,
    'cortex-learning-os',
    'src',
    'runtime.mjs',
  );
  const linkedPath = path.join(root, 'runtime-hard-link.mjs');
  const originalReadSync = fs.readSync;
  const originalReaddirSync = fs.readdirSync;
  try {
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(
      path.join(root, 'plugins', 'cortex-learning-os-live'),
      { recursive: true },
    );
    fs.writeFileSync(sourcePath, 'export const selected = true;\n');
    fs.writeFileSync(
      path.join(root, 'plugins', 'cortex-learning-os-live', 'registry.mjs'),
      'export {};\n',
    );
    const selected = fs.statSync(sourcePath, { bigint: true });
    let rewroteSelectedInode = false;
    fs.readSync = function rewriteAfterPinnedRead(descriptor, ...args) {
      const count = originalReadSync.call(fs, descriptor, ...args);
      if (!rewroteSelectedInode && count > 0) {
        const observed = fs.fstatSync(descriptor, { bigint: true });
        if (observed.dev === selected.dev && observed.ino === selected.ino) {
          rewroteSelectedInode = true;
          fs.writeFileSync(sourcePath, 'export const selected = false;\n');
        }
      }
      return count;
    };
    assert.throws(
      () => buildWorkingTreeExecutionClosure({
        sourceCommit: '1'.repeat(40),
        sourceTree: '2'.repeat(40),
        productTree: '3'.repeat(40),
        repositoryRoot: root,
        immutable: true,
      }),
      /changed during its descriptor-pinned snapshot/,
    );
    assert.equal(rewroteSelectedInode, true);
    fs.readSync = originalReadSync;

    fs.linkSync(sourcePath, linkedPath);
    assert.throws(
      () => buildWorkingTreeExecutionClosure({
        sourceCommit: '1'.repeat(40),
        sourceTree: '2'.repeat(40),
        productTree: '3'.repeat(40),
        repositoryRoot: root,
        immutable: true,
      }),
      /unsafe regular-file candidate/,
    );
    fs.unlinkSync(linkedPath);

    const sourceDirectory = path.dirname(sourcePath);
    const displacedDirectory = `${sourceDirectory}.displaced`;
    const sourceDirectoryIdentity = fs.statSync(
      sourceDirectory,
      { bigint: true },
    );
    let swappedSourceDirectory = false;
    fs.readdirSync = function swapDirectoryAfterListing(target, ...args) {
      const entries = originalReaddirSync.call(fs, target, ...args);
      const descriptorMatch = /^[/]proc[/]self[/]fd[/]([0-9]+)$/.exec(
        String(target),
      );
      if (!swappedSourceDirectory && descriptorMatch !== null) {
        const observed = fs.fstatSync(
          Number(descriptorMatch[1]),
          { bigint: true },
        );
        if (observed.dev === sourceDirectoryIdentity.dev
            && observed.ino === sourceDirectoryIdentity.ino) {
          swappedSourceDirectory = true;
          fs.renameSync(sourceDirectory, displacedDirectory);
          fs.mkdirSync(sourceDirectory);
          fs.writeFileSync(
            sourcePath,
            'export const selected = "substituted-directory";\n',
          );
        }
      }
      return entries;
    };
    assert.throws(
      () => buildWorkingTreeExecutionClosure({
        sourceCommit: '1'.repeat(40),
        sourceTree: '2'.repeat(40),
        productTree: '3'.repeat(40),
        repositoryRoot: root,
        immutable: true,
      }),
      /directory changed during its descriptor-pinned snapshot/,
    );
    assert.equal(swappedSourceDirectory, true);
  } finally {
    fs.readSync = originalReadSync;
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('immutable execution closure rechecks pinned bytes and named identity after read', {
  skip: typeof process.geteuid !== 'function' || process.geteuid() !== 0,
}, () => {
  const root = fs.mkdtempSync('/root/clos-execution-read-race-');
  const sourcePath = path.join(
    root,
    'cortex-learning-os',
    'src',
    'runtime.mjs',
  );
  const originalReadSync = fs.readSync;
  try {
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(
      path.join(root, 'plugins', 'cortex-learning-os-live'),
      { recursive: true },
    );
    fs.writeFileSync(sourcePath, 'export const selected = true;\n');
    fs.writeFileSync(
      path.join(root, 'plugins', 'cortex-learning-os-live', 'registry.mjs'),
      'export {};\n',
    );
    const closure = buildWorkingTreeExecutionClosure({
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      productTree: '3'.repeat(40),
      repositoryRoot: root,
      immutable: true,
    });
    fs.chownSync(root, 0, 0);
    fs.chmodSync(root, 0o555);
    for (const entry of closure.entries) {
      const target = path.join(root, ...entry.path.split('/'));
      fs.chownSync(target, 0, 0);
      fs.chmodSync(target, Number.parseInt(entry.mode, 8));
    }
    const selected = fs.statSync(sourcePath, { bigint: true });
    let rewroteSelectedInode = false;
    fs.readSync = function rewriteImmutableFileAfterRead(descriptor, ...args) {
      const count = originalReadSync.call(fs, descriptor, ...args);
      if (!rewroteSelectedInode && count > 0) {
        const observed = fs.fstatSync(descriptor, { bigint: true });
        if (observed.dev === selected.dev && observed.ino === selected.ino) {
          rewroteSelectedInode = true;
          fs.chmodSync(sourcePath, 0o644);
          fs.writeFileSync(sourcePath, 'export const selected = false;\n');
          fs.chmodSync(sourcePath, 0o444);
        }
      }
      return count;
    };
    assert.throws(
      () => readExecutionClosureFileAtRoot(
        closure,
        root,
        'cortex-learning-os/src/runtime.mjs',
      ),
      /changed during descriptor-relative validation/,
    );
    assert.equal(rewroteSelectedInode, true);
  } finally {
    fs.readSync = originalReadSync;
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('special privilege bits are rejected across immutable source and approved executable closures', {
  skip: typeof process.geteuid !== 'function' || process.geteuid() !== 0,
}, () => {
  const root = fs.mkdtempSync('/root/clos-special-mode-');
  const approvedRoots = [];
  try {
    fs.mkdirSync(path.join(root, 'cortex-learning-os', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'cortex-learning-os-live'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cortex-learning-os', 'src', 'runtime.mjs'), 'export {};\n');
    fs.writeFileSync(path.join(root, 'plugins', 'cortex-learning-os-live', 'registry.mjs'), 'export {};\n');
    const closure = buildWorkingTreeExecutionClosure({
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      productTree: '3'.repeat(40),
      repositoryRoot: root,
      immutable: true,
    });
    fs.chownSync(root, 0, 0);
    fs.chmodSync(root, 0o555);
    for (const entry of closure.entries) {
      const target = path.join(root, ...entry.path.split('/'));
      fs.chownSync(target, 0, 0);
      fs.chmodSync(target, Number.parseInt(entry.mode, 8));
    }
    assert.equal(assertExecutionClosureAtRoot(closure, root), true);
    const sourceFile = closure.entries.find((entry) => entry.type === 'file');
    const sourceDirectory = closure.entries.find((entry) => entry.type === 'directory');
    for (const specialMode of [0o4555, 0o2555]) {
      const target = path.join(root, ...sourceFile.path.split('/'));
      fs.chmodSync(target, specialMode);
      assert.throws(() => assertExecutionClosureAtRoot(closure, root), /mode mismatch/);
      fs.chmodSync(target, 0o444);
    }
    const hardLinkedSource = path.join(root, ...sourceFile.path.split('/'));
    const outsideHardLink = path.join(
      path.dirname(root),
      `clos-execution-closure-hardlink-${crypto.randomUUID()}`,
    );
    fs.linkSync(hardLinkedSource, outsideHardLink);
    try {
      assert.throws(
        () => assertExecutionClosureAtRoot(closure, root),
        /ownership, type, or mode mismatch/,
      );
    } finally {
      fs.unlinkSync(outsideHardLink);
    }
    const directoryTarget = path.join(root, ...sourceDirectory.path.split('/'));
    fs.chmodSync(directoryTarget, 0o1555);
    assert.throws(() => assertExecutionClosureAtRoot(closure, root), /mode mismatch/);
    fs.chmodSync(directoryTarget, 0o555);

    for (const specialMode of [0o4555, 0o2555, 0o1555]) {
      const bytes = Buffer.from(`not-an-elf-${specialMode}`);
      const executableSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const binding = approvedExecutableBinding({
        bytes: bytes.length,
        sha256: executableSha256,
      });
      const runtimeRoot = binding.runtimeClosure.root;
      approvedRoots.push(runtimeRoot);
      fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o555 });
      fs.chownSync(runtimeRoot, 0, 0);
      fs.chmodSync(runtimeRoot, specialMode === 0o1555 ? specialMode : 0o555);
      fs.writeFileSync(binding.path, bytes, { mode: specialMode });
      fs.chownSync(binding.path, 0, 0);
      fs.chmodSync(binding.path, specialMode === 0o1555 ? 0o555 : specialMode);
      assert.throws(
        () => assertApprovedModelExecutableAtPath(binding),
        /mode is not immutable|object differs|full mode differs/,
      );
    }
  } finally {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
    for (const approvedRoot of approvedRoots) {
      try {
        fs.chmodSync(approvedRoot, 0o700);
        fs.rmSync(approvedRoot, { recursive: true, force: true });
      } catch {}
    }
  }
});

test('delayed resume runtime closure binds interpreter, helpers, dependencies, and data exactly through a sealed image', () => {
  const closure = {
    schemaVersion: 'cortex.learning_os.process_runtime_closure.v2',
    platform: process.platform,
    architecture: process.arch,
    executablePath: '/runtime/node',
    loaderPath: '/runtime/ld.so',
    libraryPaths: ['/runtime'],
    rootDirectory: '/runtime-store/pending/rootfs',
    entryCount: 11,
    entries: [
      {
        path: '/',
        role: 'runtime_ancestor',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: '/etc',
        role: 'runtime_ancestor',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: '/runtime',
        role: 'runtime_ancestor',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: '/usr',
        role: 'runtime_ancestor',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: '/usr/bin',
        role: 'runtime_ancestor',
        type: 'directory',
        uid: 0,
        gid: 0,
        mode: '0555',
      },
      {
        path: '/runtime/node',
        role: 'interpreter',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0555',
        bytes: 10,
        sha256: '1'.repeat(64),
      },
      {
        path: '/runtime/ld.so',
        role: 'runtime_loader',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0555',
        bytes: 15,
        sha256: '2'.repeat(64),
      },
      {
        path: '/runtime/lib.so',
        role: 'shared_object',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0444',
        bytes: 20,
        sha256: '3'.repeat(64),
      },
      {
        path: '/usr/bin/flock',
        role: 'helper_executable',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0555',
        bytes: 30,
        sha256: '4'.repeat(64),
      },
      {
        path: '/runtime/helper-lib.so',
        role: 'helper_runtime_object',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0444',
        bytes: 40,
        sha256: '5'.repeat(64),
      },
      {
        path: '/etc/passwd',
        role: 'mount_target',
        type: 'file',
        uid: 0,
        gid: 0,
        mode: '0444',
        bytes: 0,
        sha256: sha256Text(''),
      },
    ],
  };
  closure.closureSha256 = sha256Text(canonicalJson({
    schemaVersion: closure.schemaVersion,
    platform: closure.platform,
    architecture: closure.architecture,
    executablePath: closure.executablePath,
    loaderPath: closure.loaderPath,
    libraryPaths: closure.libraryPaths,
    entryCount: closure.entryCount,
    entries: closure.entries,
  }));
  closure.rootDirectory = `/runtime-store/${closure.closureSha256}/rootfs`;
  assert.equal(validateProcessRuntimeClosure(closure).ok, true);
  const rehash = (candidate) => {
    candidate.closureSha256 = sha256Text(canonicalJson({
      schemaVersion: candidate.schemaVersion,
      platform: candidate.platform,
      architecture: candidate.architecture,
      executablePath: candidate.executablePath,
      loaderPath: candidate.loaderPath,
      libraryPaths: candidate.libraryPaths,
      entryCount: candidate.entryCount,
      entries: candidate.entries,
    }));
    candidate.rootDirectory = `/runtime-store/${candidate.closureSha256}/rootfs`;
  };
  for (const [entryIndex, unsafeMode] of [
    [5, '4555'],
    [5, '2555'],
    [5, '1555'],
    [5, '0577'],
    [5, '0500'],
    [5, '0455'],
    [6, '0455'],
    [8, '0455'],
    [9, '0466'],
    [10, '0466'],
    [10, '0400'],
    [0, '0655'],
    [0, '0755'],
    [2, '0755'],
  ]) {
    const changed = structuredClone(closure);
    changed.entries[entryIndex].mode = unsafeMode;
    rehash(changed);
    assert.equal(
      validateProcessRuntimeClosure(changed).ok,
      false,
      `correctly rehashed unsafe mode ${unsafeMode} must fail independently of digest`,
    );
  }
  for (const mutation of [
    (candidate) => { candidate.entries[5].bytes += 1; },
    (candidate) => { candidate.entries[6].sha256 = '3'.repeat(64); },
    (candidate) => { candidate.entries[7].sha256 = '4'.repeat(64); },
    (candidate) => { candidate.entries[8].sha256 = '6'.repeat(64); },
    (candidate) => { candidate.entries[9].sha256 = '6'.repeat(64); },
    (candidate) => { candidate.entries[10].sha256 = '6'.repeat(64); },
    (candidate) => { candidate.entries.pop(); candidate.entryCount -= 1; },
  ]) {
    const changed = structuredClone(closure);
    mutation(changed);
    assert.equal(validateProcessRuntimeClosure(changed).ok, false);
  }
});

test('process runtime publication reconciles protected stages before adopting an existing final image', () => {
  const source = fs.readFileSync(
    path.join(closRoot, 'src', 'process-runtime-closure.mjs'),
    'utf8',
  );
  const publisher = source.slice(
    source.indexOf('function publishProcessRuntimeClosure'),
    source.indexOf('export function assertProcessRuntimeClosure'),
  );
  const stageScan = publisher.indexOf(
    'for (const name of fs.readdirSync(stagingRoot).sort())',
  );
  const finalAdoption = publisher.indexOf(
    'if (entryExistsNoFollow(finalImage))',
    stageScan,
  );
  assert.ok(stageScan >= 0 && finalAdoption > stageScan);
  assert.match(publisher, /malformed-stage[\s\S]+stale-stage/);
  assert.match(publisher, /duplicate-stage/);
  assert.match(publisher, /adoptDurableRuntimeImage/);
  assert.match(source, /after_runtime_rename_before_parent_fsync/);
  assert.match(
    source.slice(
      source.indexOf('function quarantineRuntimeStage'),
      source.indexOf('function entryExistsNoFollow'),
    ),
    /fsyncDirectory\(path[.]dirname\(stagePath\)\)[\s\S]+fsyncDirectory\(quarantineRoot\)/,
  );
});

test('terminal and runtime tree adoption repairs a process-death rename cut before success', () => {
  const terminalSource = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-terminal-publication.mjs'),
    'utf8',
  );
  const runtimeSource = fs.readFileSync(
    path.join(closRoot, 'src', 'process-runtime-closure.mjs'),
    'utf8',
  );
  assert.match(terminalSource, /after_terminal_rename_before_parent_fsync/);
  assert.match(terminalSource, /adoptDurableTerminalRoot/);
  assert.match(runtimeSource, /after_runtime_rename_before_parent_fsync/);
  assert.match(runtimeSource, /adoptDurableRuntimeImage/);

  for (const surface of ['terminal', 'runtime']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-${surface}-rename-death-`));
    // The managed test sandbox denies cross-directory rename(2), so this
    // executable cut uses one parent. Production terminal/runtime callers pass
    // their distinct source parent; the source assertions above pin that route.
    const sourceParent = root;
    const targetParent = root;
    const stage = path.join(sourceParent, 'sealed');
    const target = path.join(targetParent, 'published');
    try {
      fs.mkdirSync(stage, { mode: 0o755 });
      const content = Buffer.from(`${surface}-adoption\n`, 'utf8');
      const file = path.join(stage, 'content.txt');
      fs.writeFileSync(file, content, { flag: 'wx', mode: 0o444 });
      fs.chmodSync(file, 0o444);
      fs.chmodSync(stage, 0o555);
      for (const durablePath of [file, stage, sourceParent]) {
        const descriptor = fs.openSync(
          durablePath,
          fs.constants.O_RDONLY
            | (fs.lstatSync(durablePath).isDirectory()
              ? (fs.constants.O_DIRECTORY || 0)
              : 0)
            | (fs.constants.O_NOFOLLOW || 0),
        );
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      }
      const interrupted = spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        [
          "import fs from 'node:fs';",
          `fs.renameSync(${JSON.stringify(stage)}, ${JSON.stringify(target)});`,
          "process.kill(process.pid, 'SIGKILL');",
        ].join(''),
      ], { encoding: 'utf8' });
      assert.equal(interrupted.signal, 'SIGKILL', surface);
      const validate = () => {
        const rootStat = fs.lstatSync(target);
        const fileStat = fs.lstatSync(path.join(target, 'content.txt'));
        assert.equal(rootStat.isDirectory(), true);
        assert.equal(rootStat.mode & 0o7777, 0o555);
        assert.equal(fileStat.isFile(), true);
        assert.equal(fileStat.nlink, 1);
        assert.equal(fileStat.mode & 0o7777, 0o444);
        assert.deepEqual(fs.readFileSync(path.join(target, 'content.txt')), content);
        return true;
      };
      assert.equal(durablyAdoptPublishedTree({
        targetPath: target,
        sourceParentPath: sourceParent,
        validate,
        label: `${surface} test publication`,
      }), true);
      assert.equal(validate(), true);
    } finally {
      if (fs.existsSync(target)) fs.chmodSync(target, 0o755);
      if (fs.existsSync(stage)) fs.chmodSync(stage, 0o755);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('retention mutation stays root-brokered while due firing stays non-root', () => {
  const retentionSource = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-retention.mjs'),
    'utf8',
  );
  const installBoundary = retentionSource.slice(
    retentionSource.indexOf(
      'export function installRetentionResumeTimer(options = {})',
    ),
    retentionSource.indexOf(
      'export function reconcileRetentionResumeTimer(options = {})',
    ),
  );
  const reconcileBoundary = retentionSource.slice(
    retentionSource.indexOf(
      'export function reconcileRetentionResumeTimer(options = {})',
    ),
    retentionSource.indexOf(
      'export function processRetentionResumeTimerFiring(options = {})',
    ),
  );
  const firingBoundary = retentionSource.slice(
    retentionSource.indexOf(
      'export function processRetentionResumeTimerFiring(options = {})',
    ),
  );
  assert.match(installBoundary, /assertInitialRootAuthority\(\);/);
  assert.match(reconcileBoundary, /assertInitialRootAuthority\(\);/);
  assert.doesNotMatch(firingBoundary, /assertInitialRootAuthority\(\);/);
  assert.match(
    firingBoundary,
    /assertRetentionResumeProcessIdentity\([\s\S]*withAuthenticatedRetentionTimerLock/,
  );
  assert.equal(
    retentionSource.match(/assertInitialRootAuthority\(\);/g)?.length,
    2,
  );
});

test('production due-time control exits successfully only after exact release successors', () => {
  const controlSource = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-qualification-control.mjs'),
    'utf8',
  );
  const completionBoundary = controlSource.slice(
    controlSource.indexOf('function assertCompletedRetentionResume'),
    controlSource.indexOf('try {'),
  );
  const resumeBoundary = controlSource.slice(
    controlSource.indexOf("command === 'retention-resume'"),
    controlSource.indexOf("throw new Error('unknown PhD qualification control command')"),
  );
  const retentionSource = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-retention.mjs'),
    'utf8',
  );
  const dueReleaseBoundary = retentionSource.slice(
    retentionSource.indexOf('const fixtureBuilder = sourceWait.fixtureOnly === true'),
    retentionSource.indexOf('let release = null;', retentionSource.indexOf(
      'const fixtureBuilder = sourceWait.fixtureOnly === true',
    )),
  );
  const program = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  const dueBundle = {
    expectedDeployment: program.deployment,
    policy: program.retentionPolicy,
  };
  const dueControl = validateProductionControlBundle({
    canonicalProgram: program,
    command: 'retention-resume',
    bundle: dueBundle,
  });
  assert.doesNotMatch(dueControl.errors.join('; '), /control bundle policy differs/);
  assert.doesNotMatch(
    dueControl.errors.join('; '),
    /requires one exact canonical policy field|policy is ambiguous/,
  );
  assert.match(completionBoundary, /result[?][.]released !== true/);
  assert.match(completionBoundary, /timerReleased !== true/);
  assert.match(completionBoundary, /journal[?][.]phase !== 'released'/);
  assert.match(completionBoundary, /contract[.]fixtureOnly !== false/);
  assert.match(completionBoundary, /release[.]fixtureOnly !== false/);
  assert.match(completionBoundary, /verifyRetentionTimerJournal/);
  assert.match(dueReleaseBoundary, /releaseInputs[.]fixtureOnly !== false/);
  assert.match(dueReleaseBoundary, /releaseInputs[.]task[.]fixtureOnly !== false/);
  assert.match(
    dueReleaseBoundary,
    /releaseInputs[.]fixtureOnly !== sourceWait[.]fixtureOnly/,
  );
  assert.match(dueReleaseBoundary, /assertRetentionResumeBindings/);
  assert.match(resumeBoundary, /releaseInputs:\s*bundle/);
  assert.match(resumeBoundary, /assertCompletedRetentionResume\(result, signingSecret\);/);
  assert.doesNotMatch(resumeBoundary, /dryRun:\s*bundle[.]dryRun/);
});

test('mapped namespace root cannot create production runtime or state authority', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-mapped-root-runtime-authority-',
  ));
  const runtimeStore = path.join(root, 'runtime-store');
  const stateRoot = path.join(root, 'state-root');
  try {
    const runtimeAttempt = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      '--input-type=module',
      '--eval',
      [
        `import { buildProcessRuntimeClosure as build } from ${
          JSON.stringify(path.join(closRoot, 'src', 'process-runtime-closure.mjs'))
        };`,
        `build({storeRoot:${JSON.stringify(runtimeStore)}});`,
      ].join(''),
    ], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(runtimeAttempt.status, 0);
    assert.match(
      runtimeAttempt.stderr,
      /initial Linux user namespace; mapped namespace root is not authority/,
    );
    assert.equal(fs.existsSync(runtimeStore), false);

    const supervisorAttempt = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      path.join(closRoot, 'src', 'local-state-root-supervisor.mjs'),
      '/bin/true',
      '--state-root',
      stateRoot,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(supervisorAttempt.status, 0);
    assert.equal(fs.existsSync(stateRoot), false);

    const terminalSource = fs.readFileSync(
      path.join(closRoot, 'src', 'phd-terminal-publication.mjs'),
      'utf8',
    );
    const supervisorSource = fs.readFileSync(
      path.join(closRoot, 'src', 'local-state-root-supervisor.mjs'),
      'utf8',
    );
    assert.match(
      terminalSource.slice(
        terminalSource.indexOf('function validateOptions'),
        terminalSource.indexOf(
          'export function reconcilePhdTerminalPublication(options)',
        ),
      ),
      /assertInitialRootAuthority\(\);/,
    );
    assert.match(supervisorSource, /assertInitialRootAuthority\(\);/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('root runtime image publication recovers sealed staging and executes independently of host PATH', {
  skip: !initialRootAuthorityAvailable(),
}, () => {
  const storeRoot = `/opt/clos-retention-runtime-test-${process.pid}-${
    crypto.randomBytes(8).toString('hex')
  }`;
  const makeWritable = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      fs.chmodSync(target, 0o700);
      for (const name of fs.readdirSync(target)) {
        makeWritable(path.join(target, name));
      }
    } else if (!stat.isSymbolicLink()) {
      fs.chmodSync(target, 0o600);
    }
  };
  try {
    assert.throws(() => buildProcessRuntimeClosure({
      executablePath: process.execPath,
      additionalExecutablePaths: ['/usr/bin/flock'],
      mountDirectoryPaths: ['/state', '/proc'],
      mountFilePaths: ['/etc/passwd'],
      storeRoot,
      crashInjector: (phase) => {
        if (phase === 'after_runtime_stage_sealed') {
          throw new Error('crash:after_runtime_stage_sealed');
        }
      },
    }), /crash:after_runtime_stage_sealed/);
    const interrupted = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        `import { buildProcessRuntimeClosure as build } from ${
          JSON.stringify(path.join(closRoot, 'src', 'process-runtime-closure.mjs'))
        };`,
        `build({executablePath:${JSON.stringify(process.execPath)},`,
        "additionalExecutablePaths:['/usr/bin/flock'],",
        "mountDirectoryPaths:['/state','/proc'],mountFilePaths:['/etc/passwd'],",
        `storeRoot:${JSON.stringify(storeRoot)},crashInjector(phase){`,
        "if(phase==='after_runtime_rename_before_parent_fsync')",
        "process.kill(process.pid,'SIGKILL');}});",
      ].join(''),
    ], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(
      interrupted.signal,
      'SIGKILL',
      interrupted.stderr || interrupted.error?.message,
    );
    const closure = buildProcessRuntimeClosure({
      executablePath: process.execPath,
      additionalExecutablePaths: ['/usr/bin/flock'],
      mountDirectoryPaths: ['/state', '/proc'],
      mountFilePaths: ['/etc/passwd'],
      storeRoot,
    });
    assert.equal(assertProcessRuntimeClosure(closure, {
      executablePath: closure.executablePath,
      requireCurrentLoadedSet: false,
      rootDirectory: closure.rootDirectory,
    }), true);
    assert.equal(
      fs.readdirSync(path.join(storeRoot, '.staging')).length,
      0,
    );
    const finalImage = path.dirname(closure.rootDirectory);
    const stagingRoot = path.join(storeRoot, '.staging');
    const duplicateStage = path.join(
      stagingRoot,
      `${closure.closureSha256}.2147483647.1.${'a'.repeat(32)}`,
    );
    const staleStage = path.join(
      stagingRoot,
      `${'f'.repeat(64)}.2147483647.1.${'b'.repeat(32)}`,
    );
    fs.cpSync(finalImage, duplicateStage, {
      recursive: true,
      preserveTimestamps: true,
    });
    fs.cpSync(finalImage, staleStage, {
      recursive: true,
      preserveTimestamps: true,
    });
    const reconciled = buildProcessRuntimeClosure({
      executablePath: process.execPath,
      additionalExecutablePaths: ['/usr/bin/flock'],
      mountDirectoryPaths: ['/state', '/proc'],
      mountFilePaths: ['/etc/passwd'],
      storeRoot,
    });
    assert.equal(reconciled.closureSha256, closure.closureSha256);
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
    const quarantinedStages = fs.readdirSync(
      path.join(storeRoot, '.quarantine'),
    );
    assert.equal(
      quarantinedStages.some((name) => name.includes('.duplicate-stage-')),
      true,
    );
    assert.equal(
      quarantinedStages.some((name) => name.includes('.stale-stage-')),
      true,
    );
    const execution = spawnSync('/usr/sbin/chroot', [
      closure.rootDirectory,
      closure.executablePath,
      '-e',
      "process.stdout.write('sealed-runtime\\n')",
    ], {
      encoding: 'utf8',
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/host-runtime-replaced',
        TZ: 'UTC',
      },
    });
    assert.equal(
      execution.status,
      0,
      execution.stderr || execution.error?.message,
    );
    assert.equal(execution.stdout, 'sealed-runtime\n');

    const interpreter = path.join(
      closure.rootDirectory,
      closure.executablePath.slice(1),
    );
    fs.chmodSync(interpreter, 0o755);
    assert.throws(() => assertProcessRuntimeClosure(closure, {
      executablePath: closure.executablePath,
      requireCurrentLoadedSet: false,
      rootDirectory: closure.rootDirectory,
    }), /differs|mode|runtime file/);
    fs.chmodSync(interpreter, 0o555);

    const stateMountTarget = path.join(closure.rootDirectory, 'state');
    fs.chmodSync(stateMountTarget, 0o755);
    assert.throws(() => assertProcessRuntimeClosure(closure, {
      executablePath: closure.executablePath,
      requireCurrentLoadedSet: false,
      rootDirectory: closure.rootDirectory,
    }), /ownership, or mode changed/);
    fs.chmodSync(stateMountTarget, 0o555);

    const displacedStateMountTarget = path.join(finalImage, 'state.displaced');
    fs.renameSync(stateMountTarget, displacedStateMountTarget);
    fs.symlinkSync(displacedStateMountTarget, stateMountTarget);
    assert.throws(() => assertProcessRuntimeClosure(closure, {
      executablePath: closure.executablePath,
      requireCurrentLoadedSet: true,
      rootDirectory: closure.rootDirectory,
    }), /mount target type changed or became a symbolic link/);
    fs.unlinkSync(stateMountTarget);
    fs.renameSync(displacedStateMountTarget, stateMountTarget);
  } finally {
    makeWritable(storeRoot);
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test('authenticated plan snapshot preserves the exact HMAC plan bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-plan-snapshot-'));
  try {
    fs.chmodSync(root, 0o700);
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({ plan, signingSecret: secret, now });
    const out = path.join(root, 'plan.v2.json');
    const snapshot = snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out,
      now,
    });
    assert.equal(snapshot.planDigest, verification.planDigest);
    assert.equal(snapshot.snapshotFileSha256, sha256Bytes(planBytes));
    assert.deepEqual(fs.readFileSync(out), planBytes);
    fs.writeFileSync(out, '{"tampered":true}\n', { mode: 0o600 });
    assert.throws(() => snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out,
      now,
    }), /differs from authenticated bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated plan snapshot accepts an inherited descriptor-root capability', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-plan-descriptor-root-'));
  let descriptor;
  try {
    fs.chmodSync(root, 0o700);
    const authority = path.join(root, 'authority');
    fs.mkdirSync(authority, { mode: 0o700 });
    descriptor = fs.openSync(
      root,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });
    const out = `/proc/self/fd/${descriptor}/authority/plan.v2.json`;
    const snapshot = snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out,
      now,
    });
    assert.equal(snapshot.planDigest, verification.planDigest);
    assert.equal(snapshot.snapshotFileSha256, sha256Bytes(planBytes));
    assert.deepEqual(fs.readFileSync(path.join(authority, 'plan.v2.json')), planBytes);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated job materialization is plan-digest-bound and preserves the job HMAC', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-job-materialize-'));
  try {
    const plan = qualificationPlan();
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({ plan, signingSecret: secret, now });
    const out = path.join(root, 'job.json');
    const materialized = materializeAuthenticatedQualificationJob({
      plan,
      signingSecret: secret,
      planDigest: verification.planDigest,
      jobId: verification.jobIds[0],
      out,
      now,
    });
    assert.equal(materialized.authenticated, true);
    assert.equal(
      materialized.jobFileSha256,
      sha256Bytes(Buffer.from(`${JSON.stringify(plan.jobs[0], null, 2)}\n`)),
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), plan.jobs[0]);
    assert.match(materialized.jobFileSha256, /^[0-9a-f]{64}$/);
    assert.throws(() => materializeAuthenticatedQualificationJob({
      plan,
      signingSecret: secret,
      planDigest: '0'.repeat(64),
      jobId: verification.jobIds[0],
      out: path.join(root, 'forged.json'),
      now,
    }), /plan changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch receipts never reopen a published pathname to derive authority', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-launch-publication-reopen-',
  ));
  const originalReadFileSync = fs.readFileSync;
  try {
    fs.chmodSync(root, 0o700);
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });
    const snapshotPath = path.join(root, 'plan.v2.json');
    const jobPath = path.join(root, 'job.json');
    const forbiddenReopens = new Set([
      path.resolve(snapshotPath),
      path.resolve(jobPath),
    ]);
    fs.readFileSync = function rejectPostPublicationPathReopen(target, ...args) {
      if (typeof target === 'string'
          && forbiddenReopens.has(path.resolve(target))) {
        throw new Error(`hostile post-publication pathname reopen: ${target}`);
      }
      return originalReadFileSync.call(fs, target, ...args);
    };

    const snapshot = snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out: snapshotPath,
      now,
    });
    const materialized = materializeAuthenticatedQualificationJob({
      plan,
      signingSecret: secret,
      planDigest: verification.planDigest,
      jobId: verification.jobIds[0],
      out: jobPath,
      now,
    });
    assert.equal(snapshot.snapshotFileSha256, sha256Bytes(planBytes));
    assert.equal(
      materialized.jobFileSha256,
      sha256Bytes(Buffer.from(`${JSON.stringify(plan.jobs[0], null, 2)}\n`)),
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch publication reconciles exact crash stages and rejects unknown ones', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-launch-publication-recovery-',
  ));
  try {
    fs.chmodSync(root, 0o700);
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const jobBytes = Buffer.from(`${JSON.stringify(plan.jobs[0], null, 2)}\n`);
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });

    const snapshotPath = path.join(root, 'plan.v2.json');
    const partialStage = path.join(
      root,
      `.plan.v2.json.publish-${'a'.repeat(32)}.tmp`,
    );
    fs.writeFileSync(
      partialStage,
      planBytes.subarray(0, Math.floor(planBytes.length / 2)),
      { mode: 0o600 },
    );
    const snapshot = snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out: snapshotPath,
      now,
    });
    assert.equal(snapshot.snapshotFileSha256, sha256Bytes(planBytes));
    assert.deepEqual(fs.readFileSync(snapshotPath), planBytes);
    assert.equal(fs.existsSync(partialStage), false);

    const jobPath = path.join(root, 'job.json');
    const linkedStage = path.join(
      root,
      `.job.json.publish-${'b'.repeat(32)}.tmp`,
    );
    fs.writeFileSync(linkedStage, jobBytes, { mode: 0o600 });
    fs.linkSync(linkedStage, jobPath);
    assert.equal(fs.statSync(jobPath).nlink, 2);
    const materialized = materializeAuthenticatedQualificationJob({
      plan,
      signingSecret: secret,
      planDigest: verification.planDigest,
      jobId: verification.jobIds[0],
      out: jobPath,
      now,
    });
    assert.equal(materialized.jobFileSha256, sha256Bytes(jobBytes));
    assert.equal(fs.existsSync(linkedStage), false);
    assert.equal(fs.statSync(jobPath).nlink, 1);
    assert.deepEqual(fs.readFileSync(jobPath), jobBytes);

    const unsafePath = path.join(root, 'unsafe.json');
    fs.writeFileSync(
      path.join(root, '.unsafe.json.publish-not-a-stage.tmp'),
      jobBytes,
      { mode: 0o600 },
    );
    assert.throws(
      () => materializeAuthenticatedQualificationJob({
        plan,
        signingSecret: secret,
        planDigest: verification.planDigest,
        jobId: verification.jobIds[0],
        out: unsafePath,
        now,
      }),
      /crash stage name is unsafe/,
    );
    assert.equal(fs.existsSync(unsafePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch publication rejects a final parent-name substitution', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-launch-publication-parent-swap-',
  ));
  const originalOpenSync = fs.openSync;
  try {
    fs.chmodSync(root, 0o700);
    const authority = path.join(root, 'authority');
    const displaced = path.join(root, 'authority-displaced');
    fs.mkdirSync(authority, { mode: 0o700 });
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });
    const snapshotPath = path.join(authority, 'plan.v2.json');
    fs.writeFileSync(snapshotPath, planBytes, { mode: 0o600 });
    let swapped = false;
    fs.openSync = function swapParentAfterPinnedTargetOpen(target, ...args) {
      const descriptor = originalOpenSync.call(fs, target, ...args);
      if (!swapped
          && typeof target === 'string'
          && target.startsWith('/proc/self/fd/')
          && target.endsWith('/plan.v2.json')) {
        swapped = true;
        fs.renameSync(authority, displaced);
        fs.mkdirSync(authority, { mode: 0o700 });
        fs.writeFileSync(
          snapshotPath,
          `${JSON.stringify({ hostile: true })}\n`,
          { mode: 0o600 },
        );
      }
      return descriptor;
    };
    assert.throws(
      () => snapshotAuthenticatedQualificationPlan({
        plan,
        planBytes,
        signingSecret: secret,
        expectedPlanDigest: verification.planDigest,
        expectedCampaignId: plan.campaignId,
        out: snapshotPath,
        now,
      }),
      /publication parent identity changed/,
    );
    assert.equal(swapped, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(snapshotPath, 'utf8')),
      { hostile: true },
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch publication rejects writable and symlinked ancestors before mutation', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-launch-publication-unsafe-ancestor-',
  ));
  try {
    fs.chmodSync(root, 0o700);
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });
    const writableAncestor = path.join(root, 'writable');
    const protectedParent = path.join(writableAncestor, 'authority');
    fs.mkdirSync(protectedParent, { recursive: true, mode: 0o700 });
    fs.chmodSync(writableAncestor, 0o770);
    const writableTarget = path.join(protectedParent, 'plan.v2.json');
    assert.throws(
      () => snapshotAuthenticatedQualificationPlan({
        plan,
        planBytes,
        signingSecret: secret,
        expectedPlanDigest: verification.planDigest,
        expectedCampaignId: plan.campaignId,
        out: writableTarget,
        now,
      }),
      /publication ancestor is unsafe/,
    );
    assert.equal(fs.existsSync(writableTarget), false);

    const actualParent = path.join(root, 'actual-authority');
    const linkedParent = path.join(root, 'linked-authority');
    fs.mkdirSync(actualParent, { mode: 0o700 });
    fs.symlinkSync(actualParent, linkedParent);
    const linkedTarget = path.join(linkedParent, 'plan.v2.json');
    assert.throws(
      () => snapshotAuthenticatedQualificationPlan({
        plan,
        planBytes,
        signingSecret: secret,
        expectedPlanDigest: verification.planDigest,
        expectedCampaignId: plan.campaignId,
        out: linkedTarget,
        now,
      }),
      /ancestor is not a no-follow directory/,
    );
    assert.equal(
      fs.existsSync(path.join(actualParent, 'plan.v2.json')),
      false,
    );

    const nestedTarget = path.join(
      root,
      'created',
      'jobs',
      'job.json',
    );
    const materialized = materializeAuthenticatedQualificationJob({
      plan,
      signingSecret: secret,
      planDigest: verification.planDigest,
      jobId: verification.jobIds[0],
      out: nestedTarget,
      now,
    });
    assert.equal(materialized.output, nestedTarget);
    assert.equal(fs.statSync(path.join(root, 'created')).mode & 0o7777, 0o700);
    assert.equal(
      fs.statSync(path.join(root, 'created', 'jobs')).mode & 0o7777,
      0o700,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification launch publication pins every ancestor and fsyncs adopted bytes before success', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-launch-publication-ancestor-handoff-',
  ));
  const originalOpenSync = fs.openSync;
  const originalFsyncSync = fs.fsyncSync;
  try {
    fs.chmodSync(root, 0o700);
    const outer = path.join(root, 'outer');
    const authority = path.join(outer, 'authority');
    const displaced = path.join(root, 'outer-displaced');
    fs.mkdirSync(authority, { recursive: true, mode: 0o700 });
    const plan = qualificationPlan();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const now = '2026-07-28T10:00:00.000Z';
    const verification = verifyQualificationLaunchPlan({
      plan,
      signingSecret: secret,
      now,
    });
    const snapshotPath = path.join(authority, 'plan.v2.json');
    fs.writeFileSync(snapshotPath, planBytes, { mode: 0o600 });
    let swapped = false;
    fs.openSync = function swapIntermediateAncestorAfterTargetOpen(
      target,
      ...args
    ) {
      const descriptor = originalOpenSync.call(fs, target, ...args);
      if (!swapped
          && typeof target === 'string'
          && target.startsWith('/proc/self/fd/')
          && target.endsWith('/plan.v2.json')) {
        swapped = true;
        fs.renameSync(outer, displaced);
        fs.mkdirSync(authority, { recursive: true, mode: 0o700 });
        fs.writeFileSync(
          snapshotPath,
          `${JSON.stringify({ hostile: true })}\n`,
          { mode: 0o600 },
        );
      }
      return descriptor;
    };
    assert.throws(
      () => snapshotAuthenticatedQualificationPlan({
        plan,
        planBytes,
        signingSecret: secret,
        expectedPlanDigest: verification.planDigest,
        expectedCampaignId: plan.campaignId,
        out: snapshotPath,
        now,
      }),
      /publication parent identity changed/,
    );
    assert.equal(swapped, true);
    fs.openSync = originalOpenSync;

    const adoptedPath = path.join(authority, 'adopted-plan.v2.json');
    fs.writeFileSync(adoptedPath, planBytes, { mode: 0o600 });
    const adoptedStat = fs.statSync(adoptedPath, { bigint: true });
    const authorityStat = fs.statSync(authority, { bigint: true });
    const fsyncEvents = [];
    fs.fsyncSync = function recordPublicationDurability(descriptor) {
      const stat = fs.fstatSync(descriptor, { bigint: true });
      if (stat.dev === adoptedStat.dev && stat.ino === adoptedStat.ino) {
        fsyncEvents.push('file');
      }
      if (stat.dev === authorityStat.dev && stat.ino === authorityStat.ino) {
        fsyncEvents.push('parent');
      }
      return originalFsyncSync.call(fs, descriptor);
    };
    snapshotAuthenticatedQualificationPlan({
      plan,
      planBytes,
      signingSecret: secret,
      expectedPlanDigest: verification.planDigest,
      expectedCampaignId: plan.campaignId,
      out: adoptedPath,
      now,
    });
    assert.deepEqual(fsyncEvents.slice(-2), ['file', 'parent']);
  } finally {
    fs.openSync = originalOpenSync;
    fs.fsyncSync = originalFsyncSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archival supervisor restart authenticates expired saved plan and exact jobs in fresh processes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-archival-supervisor-'));
  try {
    fs.chmodSync(root, 0o700);
    const plan = qualificationPlan();
    const planPath = path.join(root, 'plan.v2.json');
    const secretPath = path.join(root, 'qualification.hmac');
    const jobPath = path.join(root, `${plan.jobs[0].jobId}.json`);
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    fs.writeFileSync(jobPath, `${JSON.stringify(plan.jobs[0], null, 2)}\n`, { mode: 0o600 });
    const verifier = path.join(closRoot, 'src', 'phd-qualification-launch.mjs');
    const expiredAt = '2026-08-02T00:00:00.000Z';
    const authorityArgs = [
      '--expected-subject-id', plan.subjectId,
      '--expected-campaign-id', plan.campaignId,
      '--expected-campaign-digest', plan.campaignDigest,
      '--expected-deployment-digest', deploymentBindingDigest(plan.deployment),
      '--expected-key-id', sha256Text(secret).slice(0, 16),
    ];
    const launch = spawnSync(process.execPath, [
      verifier,
      'verify-plan',
      '--plan', planPath,
      '--secret', secretPath,
      ...authorityArgs,
      '--now', expiredAt,
    ], { encoding: 'utf8' });
    if (launch.error?.code === 'EPERM') {
      t.skip('sandbox forbids nested process execution; in-process archival contract is covered separately');
      return;
    }
    assert.notEqual(launch.status, 0);
    assert.match(launch.stderr, /not currently authorized for launch/);
    const archival = spawnSync(process.execPath, [
      verifier,
      'verify-harvest-plan',
      '--plan', planPath,
      '--secret', secretPath,
      ...authorityArgs,
      '--now', expiredAt,
    ], { encoding: 'utf8' });
    assert.equal(archival.status, 0, archival.stderr);
    const verification = JSON.parse(archival.stdout);
    const existing = spawnSync(process.execPath, [
      verifier,
      'verify-existing-job',
      '--plan', planPath,
      '--secret', secretPath,
      ...authorityArgs,
      '--expected-plan-digest', verification.planDigest,
      '--job-id', plan.jobs[0].jobId,
      '--job', jobPath,
      '--now', expiredAt,
    ], { encoding: 'utf8' });
    assert.equal(existing.status, 0, existing.stderr);
    assert.equal(JSON.parse(existing.stdout).exactExistingJobBytesVerified, true);
    fs.writeFileSync(jobPath, `${JSON.stringify(plan.jobs[0])}\n`, { mode: 0o600 });
    const changed = spawnSync(process.execPath, [
      verifier,
      'verify-existing-job',
      '--plan', planPath,
      '--secret', secretPath,
      ...authorityArgs,
      '--expected-plan-digest', verification.planDigest,
      '--job-id', plan.jobs[0].jobId,
      '--job', jobPath,
      '--now', expiredAt,
    ], { encoding: 'utf8' });
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /differs from exact authenticated bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shell launcher cannot reach remote dispatch or job extraction before plan authentication', () => {
  const launcher = fs.readFileSync(
    path.join(closRoot, 'scripts', 'launch-phd-qualification.sh'),
    'utf8',
  );
  const verification = launcher.indexOf('VERIFIED_PLAN="$(node "$VERIFIER" "$PLAN_VERIFICATION_COMMAND"');
  const materialization = launcher.indexOf('VERIFIED_JOB="$(node "$VERIFIER" materialize-job');
  assert.ok(verification > 0);
  assert.ok(materialization > verification);
  for (const remoteOperation of [
    'REMOTE_HEAD="$(ssh',
    'scp -q "$LOCAL_JOB"',
    'ssh "$SSH_HOST" systemd-run',
  ]) {
    assert.ok(
      launcher.indexOf(remoteOperation) > verification,
      `${remoteOperation} must follow plan verification`,
    );
  }
  assert.ok(launcher.indexOf('scp -q "$LOCAL_JOB"') > materialization);
  assert.doesNotMatch(launcher, /require\(process[.]argv\[1\]\)/);
  assert.doesNotMatch(launcher, /remote-codex-bin|REMOTE_CODEX_BIN/);
  assert.match(launcher, /verify-executable/);
  assert.match(launcher, /approved-model-executors\/\$APPROVED_CODEX_SHA256\/codex/);
  assert.match(launcher, /--archival-only/);
  assert.match(launcher, /PLAN_VERIFICATION_COMMAND="verify-harvest-plan"/);
  assert.match(launcher, /verify-existing-job/);
  assert.match(launcher, /while IFS= read -r JOB_ID; do[\s\S]+WORKER_COMMAND=/);
  assert.match(
    launcher,
    /if \[\[ "\$ARCHIVAL_ONLY" == true \]\]; then[\s\S]+WORKER_COMMAND[+]=\(reconcile-only\)/,
  );
  assert.match(
    launcher,
    /if \[\[ "\$ARCHIVAL_ONLY" == true \]\]; then\s+if ssh [^\n]+systemctl is-active[\s\S]+WORKER_COMMAND[+]=\(reconcile-only\)/,
  );
  assert.match(
    launcher,
    /if \[\[ "\$ARCHIVAL_ONLY" == true \]\]; then[\s\S]+verify-existing-job[\s\S]+else[\s\S]+materialize-job/,
  );
  assert.match(
    launcher,
    /&& \[\[ "\$ARCHIVAL_ONLY" == false \]\]; then\s+scp -q "\$LOCAL_JOB"/,
  );
  assert.match(launcher, /DURABLE_PUBLISHER=/);
  assert.match(
    launcher,
    /durable_publish_local immutable-tree "\$LOCAL_FROZEN_STAGE" "\$LOCAL_FROZEN_ROOT"/,
  );
  assert.match(
    launcher,
    /durable_publish_remote immutable-tree "\$REMOTE_FROZEN_STAGE" "\$REMOTE_FROZEN_ROOT"/,
  );
  assert.match(
    launcher,
    /durable_publish_remote file "\$REMOTE_PLAN_STAGE" "\$REMOTE_AUTHENTICATED_PLAN"/,
  );
  assert.match(launcher, /chown root:root "\$REMOTE_PLAN_STAGE"/);
  assert.match(launcher, /chmod 400 "\$REMOTE_PLAN_STAGE"/);
  assert.match(launcher, /== "root:root:400"/);
  assert.doesNotMatch(launcher, /chown root:jake "\$REMOTE_PLAN_STAGE"/);
  assert.match(
    launcher,
    /durable_publish_local file "\$LOCAL_JOB_STAGE" "\$LOCAL_JOB"/,
  );
  assert.match(
    launcher,
    /durable_publish_remote file "\$REMOTE_JOB_TEMP" "\$REMOTE_JOB"[\s\\]+"\$JOB_FILE_SHA256" 0 "\$REMOTE_WORKER_GID" 0440/,
  );
  assert.match(launcher, /REMOTE_WORKER_GID="\$\(ssh[^\n]+id -g jake\)"/);
  assert.doesNotMatch(
    launcher,
    /mv -- "\$(?:LOCAL_FROZEN|REMOTE_FROZEN|REMOTE_PLAN|LOCAL_JOB|REMOTE_JOB)/,
  );
});

test('production launch requires an exact zero-provider topology rehearsal and one-attempt receipt', () => {
  const launcher = fs.readFileSync(
    path.join(closRoot, 'scripts', 'launch-phd-qualification.sh'),
    'utf8',
  );
  const transaction = fs.readFileSync(
    path.join(closRoot, 'scripts', 'phd-launch-transaction.py'),
    'utf8',
  );
  const remoteCanary = fs.readFileSync(
    path.join(closRoot, 'scripts', 'phd-launch-rehearsal-worker.py'),
    'utf8',
  );
  const inventory = fs.readFileSync(
    path.join(closRoot, 'scripts', 'phd-remote-job-inventory.py'),
    'utf8',
  );

  assert.match(launcher, /real launch requires an exact signed production rehearsal receipt/);
  assert.match(launcher, /verify-rehearsal/);
  assert.match(launcher, /begin-attempt/);
  assert.match(launcher, /trap finish_launch_attempt EXIT/);
  assert.match(launcher, /finish-attempt/);
  assert.match(launcher, /LAUNCH_PHASE="remote_job_inventory"/);
  assert.match(launcher, /if \[\[ "\$REHEARSAL" == true \]\]; then[\s\S]+run-rehearsal-suite/);
  assert.ok(
    launcher.indexOf('run-rehearsal-suite') < launcher.indexOf('LAUNCH_PHASE="worker_dispatch"'),
    'zero-provider rehearsal must branch before real worker dispatch',
  );
  assert.doesNotMatch(launcher, /ssh[^\n]+find "\$REMOTE_JOB_ROOT"/);
  assert.match(launcher, /python3 "\$REMOTE_INVENTORY" "\$REMOTE_JOB_ROOT" metadata/);
  assert.match(inventory, /entry[.]stat\(follow_symlinks=False\)/);
  assert.match(inventory, /pwd[.]getpwuid/);
  assert.match(inventory, /grp[.]getgrgid/);

  assert.match(transaction, /EXPECTED_INJECTED_EXIT = 42/);
  assert.match(transaction, /DETECTION_LIMIT_SECONDS = 30[.]0/);
  assert.match(transaction, /run_trial\(args, kind="failure", index=1/);
  assert.match(transaction, /run_trial\(args, kind="success", index=1/);
  assert.match(transaction, /run_trial\(args, kind="success", index=2/);
  assert.match(transaction, /"successTrialCount": 2/);
  assert.match(transaction, /launch circuit breaker is open for this exact plan/);
  assert.match(transaction, /os[.]O_EXCL/);
  assert.match(transaction, /"providerCallsObserved": 0/);
  assert.match(transaction, /"modelExecutableInvoked": False/);
  assert.doesNotMatch(remoteCanary, /openai|codex|oracle|provider\//i);
  assert.match(remoteCanary, /runuser/);
  assert.match(remoteCanary, /worker_running/);
});

test('local qualification state rejects writable ancestors and survives an ancestor name swap', {
  skip: !initialRootAuthorityAvailable(),
}, () => {
  const root = fs.mkdtempSync('/root/clos-local-state-root-');
  try {
    const unsafe = path.join(root, 'unsafe');
    fs.mkdirSync(unsafe, { mode: 0o700 });
    fs.chmodSync(unsafe, 0o777);
    assert.throws(
      () => openLocalStateRootChain(path.join(unsafe, 'launch-state'), { create: true }),
      /not immutable root-owned material/,
    );
    assert.throws(
      () => openLocalStateRootChain(path.join(unsafe, 'archival-state'), { create: false }),
      /not immutable root-owned material/,
    );
    fs.chmodSync(unsafe, 0o700);

    const ancestor = path.join(root, 'ancestor');
    const stateRoot = path.join(ancestor, 'state');
    fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const chain = openLocalStateRootChain(stateRoot, { create: false });
    try {
      const originalIdentity = fs.fstatSync(chain.stateDescriptor);
      const displaced = path.join(root, 'ancestor-displaced');
      fs.renameSync(ancestor, displaced);
      fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        `/proc/self/fd/${chain.stateDescriptor}/archival-resume.marker`,
        'descriptor-bound\n',
      );
      assert.equal(
        fs.readFileSync(path.join(displaced, 'state', 'archival-resume.marker'), 'utf8'),
        'descriptor-bound\n',
      );
      assert.equal(fs.existsSync(path.join(stateRoot, 'archival-resume.marker')), false);
      const retainedIdentity = fs.fstatSync(chain.stateDescriptor);
      assert.equal(retainedIdentity.dev, originalIdentity.dev);
      assert.equal(retainedIdentity.ino, originalIdentity.ino);
    } finally {
      for (const descriptor of chain.descriptors.reverse()) fs.closeSync(descriptor);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification transient names distinguish same-sanitization concurrent campaign identities', () => {
  const launcher = fs.readFileSync(
    path.join(closRoot, 'scripts', 'launch-phd-qualification.sh'),
    'utf8',
  );
  const contentIdentity = (...values) => sha256Text(
    values.map((value) => `${String(value).length}:${String(value)}\n`).join(''),
  );
  const unit = (kind, readable, identity) => (
    `clos-phd-${kind}-${readable.replaceAll(/[^A-Za-z0-9-]/g, '-').slice(0, 40)}-${identity}`
  );
  const planDigest = 'a'.repeat(64);
  const firstJob = 'campaign.alpha:phd-qual-algebra-v1';
  const secondJob = 'campaign.alpha-phd-qual-algebra-v1';
  assert.equal(
    firstJob.replaceAll(/[^A-Za-z0-9-]/g, '-'),
    secondJob.replaceAll(/[^A-Za-z0-9-]/g, '-'),
  );
  const firstBinding = contentIdentity(
    'worker', planDigest, 'campaign.alpha', firstJob, 'b'.repeat(64), 'c'.repeat(64),
  );
  const secondBinding = contentIdentity(
    'worker', planDigest, 'campaign-alpha', secondJob, 'b'.repeat(64), 'c'.repeat(64),
  );
  assert.notEqual(unit('worker', firstJob, firstBinding), unit('worker', secondJob, secondBinding));
  assert.ok(unit('worker', firstJob, firstBinding).length < 256);
  assert.match(launcher, /WORKER_BINDING="\$\(content_identity_sha256/);
  assert.match(launcher, /assert_remote_active_unit/);
  assert.match(launcher, /HARVEST_BINDING="\$\(content_identity_sha256/);
  assert.match(
    launcher.match(/HARVEST_BINDING="\$\(content_identity_sha256[\s\S]+?\)"/)?.[0] || '',
    /HARVEST_COMMAND_SHA/,
  );
  assert.match(launcher, /--campaign-lock "\$CAMPAIGN_HARVEST_LOCK_STABLE"/);
  assert.match(launcher, /assert_local_active_harvester/);
  assert.match(launcher, /NOTIFY_BINDING="\$\(content_identity_sha256/);
});

test('campaign harvest exclusion and state publication survive competing processes and crash cuts', () => {
  const result = spawnSync('python3', [
    '-m',
    'unittest',
    'scripts.test_harvest_phd_qualification.HarvestValidationTests.test_campaign_lock_serializes_processes_and_recovers_on_crash',
    'scripts.test_harvest_phd_qualification.HarvestValidationTests.test_harvest_state_is_monotonic_compare_and_swap_across_crash_cuts',
  ], {
    cwd: closRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('qualification crash remnants live outside exact-set roots and are reconciled by digest', () => {
  const launcher = fs.readFileSync(
    path.join(closRoot, 'scripts', 'launch-phd-qualification.sh'),
    'utf8',
  );
  const worker = fs.readFileSync(
    path.join(closRoot, 'scripts', 'remote-phd-qualification-worker.sh'),
    'utf8',
  );
  assert.match(launcher, /REMOTE_JOB_TEMP="\$REMOTE_STAGING_ROOT\/\$JOB_ID[.]json"/);
  assert.match(launcher, /LOCAL_HARVEST_STAGING_ROOT/);
  assert.match(launcher, /--local-staging-root "\$LOCAL_HARVEST_STAGING_ROOT_STABLE"/);
  assert.match(launcher, /--local-quarantine-root "\$LOCAL_HARVEST_QUARANTINE_ROOT_STABLE"/);
  assert.match(launcher, /LOCAL_CHECKOUT_QUARANTINE_ROOT=/);
  assert.match(launcher, /quarantine_local_frozen_stage/);
  assert.match(launcher, /quarantine_remote_frozen_stage/);
  assert.match(launcher, /build_local_frozen_stage/);
  assert.match(launcher, /build_remote_frozen_stage/);
  assert.match(
    launcher,
    /mv -T -- "\$LOCAL_FROZEN_STAGE" "\$REMNANT"[\s\S]+os[.]fsync\(descriptor\)/,
  );
  assert.match(
    launcher,
    /mv -T -- "\$STAGE" "\$REMNANT"[\s\S]+REMOTE_CHECKOUT_QUARANTINE/,
  );
  const harvester = fs.readFileSync(
    path.join(closRoot, 'scripts', 'harvest-phd-qualification.py'),
    'utf8',
  );
  assert.doesNotMatch(harvester, /TemporaryDirectory[(]dir=local_root/);
  assert.match(harvester, /adopt_staged_terminal/);
  assert.match(harvester, /fsync_tree[(]stage[)]/);
  assert.match(launcher, /durable_publish_remote file "\$REMOTE_JOB_TEMP" "\$REMOTE_JOB"/);
  assert.match(launcher, /remote published job differs from authenticated bytes/);
  assert.doesNotMatch(launcher, /REMOTE_JOB_TEMP="\$REMOTE_JOB[.]tmp/);
  assert.match(launcher, /REMOTE_ARTIFACT_STAGING_ROOT/);
  assert.match(launcher, /WORKER_COMMAND[+]=\(reconcile-only\)/);
  assert.match(launcher, /RECONCILE_STATUS/);
  assert.doesNotMatch(launcher, /--live-worker-spec/);
  assert.match(harvester, /def derive_live_worker_specs/);
  assert.match(harvester, /liveWorkerSetSha256/);
  assert.match(launcher, /HARVEST_STATE_ADVANCED=false/);
  assert.match(harvester, /fcntl[.]flock\(descriptor, fcntl[.]LOCK_EX\)/);
  assert.match(harvester, /def publish_harvest_state/);
  assert.match(harvester, /qualification harvest state compare-and-swap predecessor changed/);
  assert.match(harvester, /adopted_ready/);
  assert.match(harvester, /after_state_replace_before_parent_fsync/);
  assert.match(
    harvester,
    /if existing_state[.]get\("status"\) == "ready_for_independent_replay":[\s\S]+adopt_durable_harvest_state/,
  );
  assert.ok(
    launcher.indexOf('[[ "$HARVEST_STATE_ADVANCED" == true ]]')
      < launcher.indexOf('if [[ "$NOTIFY" == true ]]'),
    'notification must wait for the restarted harvester to reconcile campaign state',
  );
  assert.match(worker, /QUARANTINE_ROOT="\$CAMPAIGN_ROOT\/quarantine\/artifacts"/);
  assert.match(worker, /PRODUCER_STAGE="\$ARTIFACT_STAGING_ROOT\/\$JOB_ID[.]producer"/);
  assert.match(worker, /PUBLISHER_STAGE="\$ARTIFACT_STAGING_ROOT\/\$JOB_ID[.]publisher"/);
  assert.match(worker, /PUBLICATION_JOURNAL="\$ARTIFACT_STAGING_ROOT\/\$JOB_ID[.]publication[.]json"/);
  assert.match(worker, /PUBLICATION_LOCK="\$ARTIFACT_STAGING_ROOT\/\$JOB_ID[.]exclusion"/);
  assert.match(worker, /KERNEL_FLOCK_FD/);
  assert.match(worker, /--exclusive --nonblock "\$PUBLICATION_LOCK_FD"/);
  assert.match(worker, /--lock-fd "\$PUBLICATION_LOCK_FD"/);
  assert.ok(
    worker.indexOf('--exclusive --nonblock "$PUBLICATION_LOCK_FD"')
      < worker.indexOf('RECOVERY="$(publish_or_recover)"'),
  );
  assert.ok(
    worker.indexOf('--exclusive --nonblock "$PUBLICATION_LOCK_FD"')
      < worker.indexOf('install -d -m 700 -o jake -g jake "$PRODUCER_STAGE"'),
  );
  assert.match(worker, /WORKER_MODE.*reconcile-only/);
  assert.match(worker, /phd-terminal-publication[.]mjs/);
  assert.match(worker, /runuser --user jake --group jake/);
  assert.doesNotMatch(worker, /install -d [^\n]*"\$FINAL_ARTIFACT_ROOT"/);
  assert.doesNotMatch(worker, /codex-command|CODEX_BIN/);
  const publisher = fs.readFileSync(
    path.join(closRoot, 'src', 'phd-terminal-publication.mjs'),
    'utf8',
  );
  assert.match(publisher, /copyOpenedRegular/);
  assert.match(publisher, /[/]proc[/]self[/]fd[/]\$\{sourceDescriptor\}/);
  assert.match(publisher, /fs[.]fsyncSync/);
  assert.match(publisher, /validateTerminalArtifactMetadata/);
  assert.match(publisher, /fs[.]renameSync\(options[.]publisherStage, options[.]finalRoot\)/);
  assert.match(publisher, /adoptDurableTerminalRoot/);
  assert.match(publisher, /after_terminal_rename_before_parent_fsync/);
  assert.match(publisher, /jobControlPlaneSignatureSha256/);
  assert.match(publisher, /closureSha256/);
  assert.match(publisher, /acquirePhdJobExclusion/);
  assert.match(publisher, /terminal publication is deferred while the exact job owner is live/);
  assert.match(publisher, /reconcilePhdTerminalPublicationJournalStages/);
  assert.match(harvester, /validate_terminal_metadata/);
  assert.match(harvester, /entry_stat[.]st_nlink != 1/);
  assert.match(harvester, /stat[.]S_IMODE/);
  const workerRuntime = fs.readFileSync(
    path.join(closRoot, 'src', 'run-phd-worker.mjs'),
    'utf8',
  );
  assert.match(workerRuntime, /openApprovedModelExecutable/);
  assert.match(workerRuntime, /executedArgv:\s*\[executedExecutable/);
  assert.match(workerRuntime, /production worker rejects --codex-command/);
});

test('terminal publication quarantines crash-cut and unsafe journal stages idempotently', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-terminal-journal-stage-recovery-',
  ));
  const staging = path.join(root, 'staging');
  const quarantine = path.join(root, 'quarantine');
  const journalPath = path.join(staging, 'campaign.job.publication.json');
  const exactStage = path.join(
    staging,
    `.campaign.job.publication.json.${process.pid}.${'a'.repeat(32)}.tmp`,
  );
  const unsafeStage = path.join(
    staging,
    '.campaign.job.publication.json.malformed.tmp',
  );
  const inputPath = path.join(root, 'input.json');
  const resultPath = path.join(root, 'result.json');
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    fs.mkdirSync(quarantine, { mode: 0o700 });
    fs.writeFileSync(exactStage, '{"phase":"sealed"', {
      flag: 'wx',
      mode: 0o600,
    });
    fs.symlinkSync('/nonexistent-terminal-journal-stage', unsafeStage);
    fs.writeFileSync(inputPath, `${JSON.stringify({
      journalPath,
      quarantineRoot: quarantine,
      jobId: 'campaign.job',
      resultPath,
      stagingRoot: staging,
    })}\n`, { mode: 0o600 });

    const recovered = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      terminalJournalRecoveryChild,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.recovered.length, 2);
    assert.deepEqual(result.staging, []);
    assert.equal(result.quarantined.length, 2);
    assert.ok(result.quarantined.some(({ name }) => (
      name.startsWith('campaign.job.orphan-journal-stage.')
    )));
    assert.ok(result.quarantined.some(({ name }) => (
      name.startsWith('campaign.job.unsafe-journal-stage.')
    )));
    assert.ok(result.quarantined.some(({ symbolicLink }) => symbolicLink));

    fs.unlinkSync(resultPath);
    const repeated = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      terminalJournalRecoveryChild,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(repeated.status, 0, repeated.stderr);
    const repeatedResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.deepEqual(repeatedResult.recovered, []);
    assert.deepEqual(repeatedResult.staging, []);
    assert.equal(repeatedResult.quarantined.length, 2);

    const overlapping = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      '--input-type=module',
      '--eval',
      [
        `import { reconcilePhdTerminalPublicationJournalStages as reconcile } from ${
          JSON.stringify(path.join(closRoot, 'src', 'phd-terminal-publication.mjs'))
        };`,
        `reconcile({ journalPath: ${
          JSON.stringify(journalPath)
        }, quarantineRoot: ${
          JSON.stringify(path.join(staging, 'quarantine'))
        }, jobId: 'campaign.job' });`,
      ].join(''),
    ], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(overlapping.status, 0);
    assert.match(
      overlapping.stderr,
      /reconciliation paths are unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification checkout, plan, and job publication is no-replace durable and archival-adoptable', () => {
  const publisher = fs.readFileSync(
    path.join(closRoot, 'scripts', 'durable-qualification-publication.py'),
    'utf8',
  );
  assert.match(publisher, /renameat2/);
  assert.match(publisher, /RENAME_NOREPLACE/);
  assert.match(publisher, /os[.]fsync/);
  assert.match(publisher, /_walk_immutable_tree/);
  assert.match(publisher, /st_nlink != 1/);
  assert.match(publisher, /O_NOFOLLOW/);
  assert.match(
    publisher,
    /_fsync_pinned_directory\(staging_parent,\s*staging[.]parent\)/,
  );
  assert.match(
    publisher,
    /_fsync_pinned_directory\(final_parent,\s*final[.]parent\)/,
  );
  assert.match(publisher, /_open_protected_parent/);
  assert.match(publisher, /dir_fd=descriptor/);
  assert.match(publisher, /_assert_named_parent_identity/);
  const result = spawnSync('python3', [
    '-m',
    'unittest',
    'scripts.test_durable_qualification_publication',
  ], {
    cwd: closRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('per-job kernel exclusion defers archival mutation across every publication phase', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-publication-kernel-lock-'));
  const lockPath = path.join(root, 'campaign.job.exclusion');
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const lockIdentity = fs.statSync(lockPath, { bigint: true });
  const simulatedState = path.join(root, 'publication-state.json');
  let holder = null;
  try {
    for (const phase of ['producer-write', 'import', 'sealing', 'final-rename']) {
      const readyPath = path.join(root, `${phase}.ready`);
      const inputPath = path.join(root, `${phase}.input.json`);
      const state = {
        phase,
        producerStage: `${phase}:producer-bytes`,
        publisherStage: `${phase}:publisher-bytes`,
        journal: `${phase}:journal-bytes`,
        finalRoot: `${phase}:terminal-bytes`,
      };
      fs.writeFileSync(simulatedState, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      const before = fs.readFileSync(simulatedState);
      fs.writeFileSync(inputPath, `${JSON.stringify({
        lockPath,
        expectedUid: process.getuid(),
        expectedGid: process.getgid(),
        readyPath,
        phase,
      }, null, 2)}\n`, { mode: 0o600 });

      let holderStderr = '';
      holder = spawn(process.execPath, [
        concurrencyChild,
        'publication-hold',
        inputPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      holder.stderr.setEncoding('utf8');
      holder.stderr.on('data', (chunk) => { holderStderr += chunk; });
      await waitForFixtureReady(holder, readyPath, () => holderStderr);

      const archival = spawnSync(process.execPath, [
        concurrencyChild,
        'publication-contend',
        inputPath,
      ], { encoding: 'utf8' });
      assert.equal(archival.status, 4, phase);
      assert.match(
        archival.stderr,
        /deferred while the exact job owner is live/,
        phase,
      );
      assert.deepEqual(fs.readFileSync(simulatedState), before, phase);

      await stopFixtureChild(holder);
      holder = null;
      const recovered = spawnSync(process.execPath, [
        concurrencyChild,
        'publication-contend',
        inputPath,
      ], { encoding: 'utf8' });
      assert.equal(recovered.status, 0, `${phase}: process-death recovery`);
      assert.deepEqual(fs.readFileSync(simulatedState), before, phase);
      const after = fs.statSync(lockPath, { bigint: true });
      assert.equal(after.dev, lockIdentity.dev, phase);
      assert.equal(after.ino, lockIdentity.ino, phase);
    }
  } finally {
    if (holder) await stopFixtureChild(holder);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('terminal artifact metadata rejects producer writability, hard links, symlinks, and extras', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-terminal-metadata-'));
  const artifact = path.join(root, 'terminal');
  const outsideLink = path.join(root, 'outside-hard-link');
  fs.mkdirSync(artifact, { mode: 0o755 });
  fs.writeFileSync(path.join(artifact, 'result.json'), '{}\n', { mode: 0o444 });
  fs.writeFileSync(path.join(artifact, 'artifact-manifest.json'), '{}\n', { mode: 0o444 });
  const ownerUid = process.getuid();
  const ownerGid = process.getgid();
  const manifest = {
    publication: {
      schemaVersion: 'cortex.learning_os.phd_terminal_publication.v1',
      publisherUid: ownerUid,
      publisherGid: ownerGid,
      rootMode: '0555',
      fileMode: '0444',
      directoryMode: '0555',
      regularFileLinkCount: 1,
      rootLinkCount: 2,
      producerWritableTerminal: false,
      noFollow: true,
      exactMetadata: true,
    },
    directories: [],
    files: [{ path: 'result.json' }],
  };
  fs.chmodSync(artifact, 0o555);
  try {
    assert.equal(validateTerminalArtifactMetadata(artifact, manifest, {
      ownerUid,
      ownerGid,
    }), true);

    fs.chmodSync(path.join(artifact, 'result.json'), 0o644);
    assert.throws(
      () => validateTerminalArtifactMetadata(artifact, manifest, { ownerUid, ownerGid }),
      /file metadata mismatch/,
    );
    fs.chmodSync(path.join(artifact, 'result.json'), 0o444);

    fs.linkSync(path.join(artifact, 'result.json'), outsideLink);
    assert.throws(
      () => validateTerminalArtifactMetadata(artifact, manifest, { ownerUid, ownerGid }),
      /file metadata mismatch/,
    );
    fs.unlinkSync(outsideLink);

    fs.chmodSync(artifact, 0o755);
    fs.symlinkSync('result.json', path.join(artifact, 'injected-link'));
    fs.chmodSync(artifact, 0o555);
    assert.throws(
      () => validateTerminalArtifactMetadata(artifact, manifest, { ownerUid, ownerGid }),
      /contains a symlink/,
    );
    fs.chmodSync(artifact, 0o755);
    fs.unlinkSync(path.join(artifact, 'injected-link'));

    fs.writeFileSync(path.join(artifact, 'extra.json'), '{}\n', { mode: 0o444 });
    fs.chmodSync(artifact, 0o555);
    assert.throws(
      () => validateTerminalArtifactMetadata(artifact, manifest, { ownerUid, ownerGid }),
      /exact recursive set/,
    );
  } finally {
    fs.chmodSync(artifact, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Python production harvester accepts exact 0555/0444 metadata and rejects mode tamper', () => {
  const probe = spawnSync('python3', ['-c', String.raw`
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import sys

module_path = pathlib.Path(sys.argv[1])
module_spec = importlib.util.spec_from_file_location("harvest", module_path)
harvest = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(harvest)
temporary = pathlib.Path(tempfile.mkdtemp(prefix="clos-python-terminal-"))
root = temporary / "terminal"
root.mkdir(mode=0o700)
try:
    job = {
        "jobId": "metadata-regression",
        "campaignId": "metadata-campaign",
        "executor": "model_no_tools",
        "promptSha256": "1" * 64,
        "deployment": {},
        "controlPlaneSignature": {
            "algorithm": "hmac-sha256",
            "keyId": "2" * 16,
            "digest": "3" * 64,
        },
        "notBefore": "2026-07-28T10:00:00.000Z",
        "expiresAt": "2026-07-28T12:00:00.000Z",
    }
    job_digest = harvest.canonical_digest(job)
    started = "2026-07-28T10:01:00.000Z"
    completed = "2026-07-28T10:02:00.000Z"
    interval = {
        "jobDigest": job_digest,
        "notBefore": job["notBefore"],
        "startedAt": started,
        "completedAt": completed,
        "expiresAt": job["expiresAt"],
    }
    blocker = {
        "schemaVersion": harvest.WORKER_BLOCKER_SCHEMA,
        "code": "worker_exception",
        "phase": "worker_exception",
        "message": "bounded fixture failure",
    }
    (root / "output.json").write_text(
        json.dumps({"blocker": blocker}) + "\n", encoding="utf-8"
    )
    (root / "job.json").write_text(json.dumps(job) + "\n", encoding="utf-8")
    summary = {
        "schemaVersion": "cortex.learning_os.phd_worker_summary.v2",
        "jobId": job["jobId"],
        "campaignId": job["campaignId"],
        "jobDigest": job_digest,
        "executor": job["executor"],
        "status": "failed",
        "blocker": blocker,
        "notBefore": job["notBefore"],
        "startedAt": started,
        "completedAt": completed,
        "expiresAt": job["expiresAt"],
        "executionIntervalSha256": harvest.canonical_digest(interval),
        "timingProvenance": "worker_observed_awaiting_execution_attestation",
        "outputSha256": harvest.sha256_file(root / "output.json"),
        "executionIdentity": {"fixture": True},
        "authority": "worker_evidence_only",
        "canonicalStateMutated": False,
        "truthBoundary": "A failed worker terminal cannot qualify or mutate canonical state.",
    }
    (root / "worker-summary.json").write_text(
        json.dumps(summary) + "\n", encoding="utf-8"
    )
    files = [{
        "path": target.name,
        "bytes": target.stat().st_size,
        "ownerUid": 0,
        "ownerGid": 0,
        "mode": "0444",
        "linkCount": 1,
        "sha256": harvest.sha256_file(target),
    } for target in sorted(root.iterdir())]
    manifest = {
        "schemaVersion": "cortex.learning_os.phd_worker_manifest.v3",
        "jobId": job["jobId"],
        "campaignId": job["campaignId"],
        "jobDigest": job_digest,
        "jobControlPlaneSignature": job["controlPlaneSignature"],
        "deployment": job["deployment"],
        "executor": job["executor"],
        "executionIdentity": summary["executionIdentity"],
        "promptSha256": job["promptSha256"],
        "status": "failed",
        "notBefore": job["notBefore"],
        "startedAt": started,
        "completedAt": completed,
        "expiresAt": job["expiresAt"],
        "executionIntervalSha256": summary["executionIntervalSha256"],
        "timingProvenance": summary["timingProvenance"],
        "outputSha256": summary["outputSha256"],
        "publication": {
            "schemaVersion": "cortex.learning_os.phd_terminal_publication.v1",
            "publisherUid": os.geteuid(),
            "publisherGid": os.getegid(),
            "rootMode": "0555",
            "fileMode": "0444",
            "directoryMode": "0555",
            "regularFileLinkCount": 1,
            "rootLinkCount": 2,
            "producerWritableTerminal": False,
            "noFollow": True,
            "exactMetadata": True,
        },
        "directories": [],
        "files": files,
        "authority": "worker_evidence_only",
        "truthBoundary": "Remote worker artifacts cannot mutate or qualify canonical control-plane state.",
    }
    (root / "artifact-manifest.json").write_text(
        json.dumps(manifest) + "\n", encoding="utf-8"
    )
    for target in root.iterdir():
        target.chmod(0o444)
    root.chmod(0o555)
    metadata = harvest.validate_terminal_metadata(
        root, manifest, owner_uid=os.geteuid(), owner_gid=os.getegid()
    )
    accepted = harvest.validate_harvested(
        root, job, require_terminal_metadata=True,
        terminal_owner_uid=os.geteuid(), terminal_owner_gid=os.getegid()
    )
    (root / "output.json").chmod(0o644)
    tampered_metadata = harvest.validate_terminal_metadata(
        root, manifest, owner_uid=os.geteuid(), owner_gid=os.getegid()
    )
    tampered_harvest = harvest.validate_harvested(
        root, job, require_terminal_metadata=True,
        terminal_owner_uid=os.geteuid(), terminal_owner_gid=os.getegid()
    )
    print(json.dumps({
        "modes": [harvest.mode_string(0o555), harvest.mode_string(0o444)],
        "metadata": metadata,
        "accepted": accepted,
        "tamperedMetadata": tampered_metadata,
        "tamperedHarvest": tampered_harvest,
    }))
finally:
    root.chmod(0o700)
    for target in root.iterdir():
        target.chmod(0o600)
    shutil.rmtree(temporary)
`, path.join(closRoot, 'scripts', 'harvest-phd-qualification.py')], {
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.deepEqual(result.modes, ['0555', '0444']);
  assert.deepEqual(result.metadata, [true, '']);
  assert.deepEqual(result.accepted, [true, '']);
  assert.equal(result.tamperedMetadata[0], false);
  assert.equal(result.tamperedHarvest[0], false);
});

test('post-expiry archival reconciliation waits for the authenticated live owner then recovers', () => {
  const probe = spawnSync('python3', ['-c', String.raw`
import importlib.util
import json
import pathlib
import tempfile
import sys
import types

module_path = pathlib.Path(sys.argv[1])
module_spec = importlib.util.spec_from_file_location("harvest", module_path)
harvest = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(harvest)
with tempfile.TemporaryDirectory() as temporary:
    campaign_id = "campaign-one"
    job_id = f"{campaign_id}.job"
    campaign_root = pathlib.Path(temporary) / campaign_id
    jobs_root = campaign_root / "jobs"
    jobs_root.mkdir(parents=True)
    job = {"jobId": job_id, "authenticated": True}
    job_bytes = (json.dumps(job, indent=2) + "\n").encode()
    (jobs_root / f"{job_id}.json").write_bytes(job_bytes)
    (jobs_root / f"{job_id}.json").chmod(0o600)
    plan = {
        "deployment": {
            "sourceCommit": "1" * 40,
            "sourceTree": "2" * 40,
            "productTree": "3" * 40,
            "runtimeSha256": "4" * 64,
            "closureSha256": "5" * 64,
        },
        "jobs": [job],
    }
    verification = {
        "sourceCommit": "1" * 40,
        "sourceTree": "2" * 40,
        "jobDigests": {job_id: harvest.canonical_digest(job)},
    }
    args = types.SimpleNamespace(
        state_file=str(campaign_root / "state.json"),
        remote_job_root=f"/remote/campaigns/{campaign_id}/jobs",
        remote_artifact_root=f"/remote/campaigns/{campaign_id}/artifacts",
        remote_checkout_root=f"/remote/campaigns/{campaign_id}/checkout",
        expected_campaign_id=campaign_id,
        expected_plan_digest="6" * 64,
        expected_campaign_digest="7" * 64,
        expected_deployment_digest="8" * 64,
        expected_descriptor_set_sha256="9" * 64,
        expected_product_tree="3" * 40,
        expected_runtime_sha256="4" * 64,
        expected_closure_sha256="5" * 64,
    )
    parsed = harvest.derive_live_worker_specs(
        plan, verification, args,
        "fixture-harvest-signing-secret-000000000000000000",
    )
    value = parsed[job_id]
    recovery = value["recoveryCommand"]
    arbitrary_placeholders_rejected = recovery[3:14] != ["x"] * 11
    signature_valid = harvest.verify_control_signature(
        value, "fixture-harvest-signing-secret-000000000000000000"
    )
    changed = dict(value)
    changed["recoveryCommand"] = recovery[:3] + ["x"] * 11 + ["reconcile-only"]
    changed_signature_rejected = not harvest.verify_control_signature(
        changed, "fixture-harvest-signing-secret-000000000000000000"
    )
    states = iter([True, False])
    harvest.authenticated_remote_worker_active = lambda host, worker: next(states)
    commands = []
    def remote(host, command):
        commands.append(command)
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    harvest.remote_command = remote
    recovered = harvest.reconcile_after_live_worker(
        "root@example", value, attempts=3, sleep=lambda seconds: None
    )
    deferred = harvest.expired_missing_terminal_failure(
        job_id, set(), archival_after_expiry=True, authenticated_live_owner=True
    )
    print(json.dumps({
        "recovered": recovered,
        "deferred": deferred,
        "signatureValid": signature_valid,
        "changedSignatureRejected": changed_signature_rejected,
        "arbitraryPlaceholdersRejected": arbitrary_placeholders_rejected,
        "recoveryCommandObserved": commands[0] == recovery,
        "terminalProbeObserved": commands[1] == ["test", "-f", value["terminalManifest"]],
    }))
`, path.join(closRoot, 'scripts', 'harvest-phd-qualification.py')], {
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), {
    recovered: true,
    deferred: null,
    signatureValid: true,
    changedSignatureRejected: true,
    arbitraryPlaceholdersRejected: true,
    recoveryCommandObserved: true,
    terminalProbeObserved: true,
  });
});

test('worker rejects changed authenticated bytes and invalid v2 authority fields before execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-worker-auth-'));
  try {
    const invoke = (job, expectedJobFileSha256, label) => {
      const jobPath = path.join(root, `${label}.json`);
      const artifactRoot = path.join(root, `${label}-artifacts`);
      const bytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
      fs.writeFileSync(jobPath, bytes, { mode: 0o600 });
      fs.mkdirSync(artifactRoot, { mode: 0o700 });
      const plan = qualificationPlan();
      return {
        bytes,
        artifactRoot,
        result: spawnSync(process.execPath, [
          path.join(closRoot, 'src', 'run-phd-worker.mjs'),
          '--job', jobPath,
          '--expected-job-file-sha256', expectedJobFileSha256 ?? sha256Text(bytes),
          '--plan-digest', sha256Text(canonicalJson(plan)),
          '--campaign-digest', job.campaignDigest,
          '--descriptor-set-sha256', plan.descriptorSetSha256,
          '--product-tree', job.deployment.productTree,
          '--runtime-sha256', job.deployment.runtimeSha256,
          '--closure-sha256', job.deployment.closureSha256,
          '--checkout-root', path.resolve(closRoot, '..'),
          '--job-root', root,
          '--artifact-root', artifactRoot,
          '--codex-command', '/bin/false',
        ], { encoding: 'utf8' }),
      };
    };
    const job = qualificationPlan().jobs[0];
    const changed = invoke(job, '0'.repeat(64), 'changed');
    assert.equal(changed.result.status, 4);
    assert.match(
      JSON.parse(fs.readFileSync(
        path.join(changed.artifactRoot, 'worker-summary.json'),
        'utf8',
      )).blocker.message,
      /authenticated detached job bytes changed before execution/,
    );

    const authorityEscalation = resign({
      ...job,
      canonicalStateAuthority: true,
    });
    const escalated = invoke(authorityEscalation, null, 'authority-escalation');
    assert.equal(escalated.result.status, 4);
    assert.match(
      JSON.parse(fs.readFileSync(
        path.join(escalated.artifactRoot, 'worker-summary.json'),
        'utf8',
      )).blocker.message,
      /invalid detached qualification job/,
    );

    const invalidEnvelope = structuredClone(job);
    invalidEnvelope.controlPlaneSignature.keyId = 'not-a-valid-key';
    const enveloped = invoke(invalidEnvelope, null, 'invalid-envelope');
    assert.equal(enveloped.result.status, 4);
    assert.match(
      JSON.parse(fs.readFileSync(
        path.join(enveloped.artifactRoot, 'worker-summary.json'),
        'utf8',
      )).blocker.message,
      /invalid detached qualification job/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
