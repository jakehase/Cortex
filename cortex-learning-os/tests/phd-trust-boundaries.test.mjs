import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { verifyAdaptiveArtifacts } from '../src/adaptive-verifier.mjs';
import {
  validateApprovedResearchDaemonObservation,
  validateApprovedResearchRuntimeBinding,
} from '../src/approved-research-runtime.mjs';
import {
  assembleProductionResearchEvidence,
  buildResearchJobDescriptor,
  buildSealedQualificationBanks,
  buildExamJobDescriptors,
  assembleExamAttempt,
  RESEARCH_REPRODUCTION_BUNDLE_SCHEMA,
  validateProductionResearchAttestations,
  validateAcquisitionAssessmentRegistry,
  validateProductionQualificationBank,
} from '../src/phd-campaign.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
  executionSourceSha256,
  observeExecutableIdentity,
  validateExecutionEvidenceCore,
} from '../src/execution-evidence.mjs';
import { deploymentBindingDigest } from '../src/deployment-identity.mjs';
import {
  RESEARCH_REPRODUCTION_REQUEST_SCHEMA,
  serializeResearchReproductionAuthorityRequest,
  validateEffectiveResearchIsolation,
} from '../src/frozen-research-reproduction.mjs';
import { sha256Bytes, sha256Text } from '../src/hash.mjs';
import { validateProductionControlBundle } from '../src/phd-control-boundary.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import { validateRetentionPolicy } from '../src/phd-retention.mjs';
import {
  EXECUTION_ATTESTATION_SCHEMA,
  AUTHORITY_ATTESTATION_SCHEMA,
  validateCapabilityAuthorityIndependence,
  validatePhdTrustPolicy,
  verifyTrustedExecutionEvidence,
} from '../src/phd-trust.mjs';
import {
  cycle8KernelEvidence,
  cycle7ApprovedResearchRuntimeBinding,
} from './research-runtime-fixture.mjs';
import {
  createResearchReviewAuthorityRequest,
  createResearchReviewRequestBinding,
  serializeResearchReviewAuthorityRequest,
} from '../src/research-review-request.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

function approvedResearchRuntimeBinding() {
  return cycle7ApprovedResearchRuntimeBinding({
    bytes: 345678,
    sha256: 'd'.repeat(64),
  });
}

function observedDaemonMeasurement(phase, daemonClosure) {
  return {
    phase,
    closureSha256: daemonClosure.closureSha256,
    serviceUnit: daemonClosure.serviceUnit,
    socketPath: daemonClosure.socketPath,
    mainPid: daemonClosure.serviceManager.mainPid,
    invocationId: daemonClosure.serviceManager.invocationId,
    cgroup: daemonClosure.process.cgroup,
    startTimeTicks: daemonClosure.process.startTimeTicks,
    socketDevice: daemonClosure.process.socketDevice,
    socketInode: daemonClosure.process.socketInode,
  };
}

test('approved research daemon closure is observed, recursive, and restart-bound', () => {
  const binding = approvedResearchRuntimeBinding();
  assert.equal(
    validateApprovedResearchRuntimeBinding(binding, { observe: false }).ok,
    true,
  );
  assert.equal(validateApprovedResearchRuntimeBinding(binding, {
    systemctl: '/fake/systemctl',
    commandRunner: () => ({ status: 1, stdout: '', stderr: 'not observed' }),
  }).ok, false, 'a correctly rehashed declaration is not a live approval');

  const mutations = [
    ['service unit', (closure) => {
      closure.entries.find((entry) => entry.roles.includes('service_unit')).sha256 =
        'f'.repeat(64);
    }],
    ['drop-in', (closure) => {
      closure.entries.find((entry) => entry.roles.includes('service_drop_in')).sha256 =
        'f'.repeat(64);
    }],
    ['daemon executable', (closure) => {
      closure.process.executableSha256 = 'f'.repeat(64);
    }],
    ['configuration', (closure) => {
      closure.entries.find((entry) => entry.roles.includes('configuration_root')
        && entry.type === 'file').sha256 = 'f'.repeat(64);
    }],
    ['dummy configuration root', (closure) => {
      closure.roots[0].path = '/opt/dummy-immutable-root';
    }],
    ['dummy rootfs root', (closure) => {
      closure.roots.find((root) => root.role === 'rootfs_root').path =
        '/opt/dummy-immutable-rootfs';
    }],
    ['mutable execution store identity', (closure) => {
      closure.executionStore.dataRootInode = '999999';
    }],
    ['rootfs', (closure) => {
      closure.entries.find((entry) => entry.roles.includes('rootfs_root')
        && entry.type === 'file').sha256 = 'f'.repeat(64);
    }],
    ['ancestor mode', (closure) => {
      closure.entries.find((entry) => entry.path === '/usr').mode = '0777';
    }],
    ['socket replacement', (closure) => {
      closure.process.socketInode = '999999';
    }],
    ['swapped containerd', (closure) => {
      closure.auxiliaryProcesses[0].executableSha256 = 'f'.repeat(64);
    }],
    ['swapped containerd configuration', (closure) => {
      closure.auxiliaryProcesses[0].configurationFiles[0].sha256 = 'f'.repeat(64);
    }],
    ['swapped runc', (closure) => {
      closure.runtimeHelpers.find((helper) => helper.path.endsWith('/runc')).sha256 =
        'f'.repeat(64);
    }],
    ['swapped seccomp profile', (closure) => {
      closure.securityProfiles.find((profile) => profile.kind === 'seccomp').sha256 =
        'f'.repeat(64);
    }],
    ['reloaded permissive AppArmor policy', (closure) => {
      closure.securityProfiles.find((profile) => profile.kind === 'apparmor')
        .kernelPolicySha256 = 'f'.repeat(64);
    }],
    ['helper restart', (closure) => {
      closure.auxiliaryProcesses[0].startTimeTicks = '999999';
    }],
    ['daemon restart', (closure) => {
      closure.process.startTimeTicks = '999999';
      closure.serviceManager.invocationId = 'f'.repeat(32);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const observed = structuredClone(binding.daemonClosure);
    mutate(observed);
    const unsigned = { ...observed };
    delete unsigned.closureSha256;
    observed.closureSha256 = sha256Text(canonicalJson(unsigned));
    assert.equal(
      validateApprovedResearchDaemonObservation(observed, binding).ok,
      false,
      label,
    );
  }
});

test('daemon inspect is supplemental and production isolation requires host-kernel evidence', () => {
  const workspace = '/var/lib/cortex/reproduction/workspace';
  const containerId = 'a'.repeat(64);
  const imageId = `sha256:${'b'.repeat(64)}`;
  const runtimeName = 'runc';
  const seccompProfilePath = '/etc/clos-research/research-seccomp.json';
  const inspected = {
    Id: containerId,
    Image: imageId,
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      PidsLimit: 256,
      Runtime: runtimeName,
      LogConfig: { Type: 'none', Config: {} },
      CapDrop: ['ALL'],
      CapAdd: [],
      Devices: [],
      SecurityOpt: [
        'apparmor=docker-default',
        'no-new-privileges',
        `seccomp=${seccompProfilePath}`,
      ],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=64m' },
    },
    Config: { WorkingDir: '/workspace' },
    Mounts: [{
      Type: 'bind',
      Source: workspace,
      Destination: '/workspace',
      RW: true,
    }],
  };
  assert.equal(
    validateEffectiveResearchIsolation(inspected, {
      containerId,
      imageId,
      workspace,
      runtimeName,
      seccompProfilePath,
    }).network,
    'none',
  );
  for (const [label, mutate] of [
    ['network', (value) => { value.HostConfig.NetworkMode = 'bridge'; }],
    ['rootfs', (value) => { value.HostConfig.ReadonlyRootfs = false; }],
    ['privilege', (value) => { value.HostConfig.Privileged = true; }],
    ['capabilities', (value) => { value.HostConfig.CapAdd = ['SYS_ADMIN']; }],
    ['devices', (value) => { value.HostConfig.Devices = [{ PathOnHost: '/dev/kvm' }]; }],
    ['security', (value) => { value.HostConfig.SecurityOpt = []; }],
    ['logging plugin', (value) => { value.HostConfig.LogConfig.Type = 'external'; }],
    ['pids', (value) => { value.HostConfig.PidsLimit = 0; }],
    ['tmpfs', (value) => { value.HostConfig.Tmpfs['/tmp'] = 'rw'; }],
    ['mount', (value) => { value.Mounts[0].Source = '/tmp/substituted'; }],
    ['image', (value) => { value.Image = `sha256:${'f'.repeat(64)}`; }],
  ]) {
    const candidate = structuredClone(inspected);
    mutate(candidate);
    assert.throws(() => validateEffectiveResearchIsolation(candidate, {
      containerId,
      imageId,
      workspace,
      runtimeName,
      seccompProfilePath,
    }), /isolation state/, label);
  }
});

function timedWorkerCall(campaign, call) {
  const jobDigest = sha256Text(canonicalJson({
    campaignId: campaign.campaignId,
    role: call.role,
    sessionId: call.plannedSessionId || call.sessionId,
    promptSha256: call.promptSha256 || null,
  }));
  return {
    ...call,
    jobDigest,
    notBefore: campaign.frozenAt,
    expiresAt: campaign.expiresAt,
    executionIntervalSha256: sha256Text(canonicalJson({
      jobDigest,
      notBefore: campaign.frozenAt,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
      expiresAt: campaign.expiresAt,
    })),
    ...(campaign.fixtureOnly === false ? {
      executionIdentity: {
        planDigest: '9'.repeat(64),
        campaignDigest: sha256Text(canonicalJson(campaign)),
        descriptorSetSha256: 'a'.repeat(64),
        productTree: campaign.deployment.productTree,
        runtimeSha256: campaign.deployment.runtimeSha256,
        closureSha256: campaign.deployment.closureSha256,
      },
    } : {}),
  };
}

function authorityFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyId = sha256Text(publicKey.export({ format: 'der', type: 'spki' }));
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'fixture-trust-policy',
    boundaryId: 'fixture-protected-runner',
    productionEnabled: false,
    authorities: [{
      authorityId: 'fixture-execution-authority',
      capabilities: ['execution'],
      publicKeyPem,
      keyId,
    }],
    truthBoundary: 'Fixture key tests signature mechanics only.',
  };
  return { privateKey, trustPolicy, keyId };
}

function signExecution(privateKey, keyId, payload) {
  const core = {
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
    attestationId: 'fixture-execution-attestation',
    authorityId: 'fixture-execution-authority',
    payload,
  };
  return {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId,
      valueBase64: crypto.sign(
        null,
        Buffer.from(canonicalJson(core), 'utf8'),
        privateKey,
      ).toString('base64'),
    },
  };
}

function modelExecutionCore({
  role,
  sessionId,
  prompt,
  output,
  ledger,
  stderr = Buffer.alloc(0),
  startedAt,
  completedAt,
  provider = 'openai-codex',
  model = 'gpt-test',
  usage = { inputTokens: 10, outputTokens: 5 },
  providerRequestId = 'request-1',
  providerSessionId = 'provider-session-1',
  bindings = {},
  observedEnvironment = {
    executionKind: 'test_fixture_process',
    platform: process.platform,
    architecture: process.arch,
  },
} = {}) {
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
    model,
    '--config',
    'model_reasoning_effort="xhigh"',
    '--cd',
    root,
    '--json',
    '--output-schema',
    path.join(root, 'fixture.schema.json'),
    '--output-last-message',
    path.join(root, 'output.json'),
    '-',
  ];
  return createExecutionEvidenceCore({
    executionKind: 'model',
    bindings: {
      candidateId: null,
      candidateSessionId: sessionId,
      candidateSha256: sha256Bytes(output),
      taskId: null,
      taskSha256: '1'.repeat(64),
      jobId: 'fixture-job',
      jobSha256: '2'.repeat(64),
      campaignId: 'fixture-campaign',
      campaignSha256: '3'.repeat(64),
      deploymentSha256: '4'.repeat(64),
      sourceSha256: '5'.repeat(64),
      ...bindings,
    },
    declaredEnvironment: {
      executionKind: 'host_process',
      role,
      modelRuntime: {
        provider,
        model,
        thinking: 'xhigh',
        sandbox: 'read-only',
        toolsAllowed: false,
      },
    },
    observedEnvironment,
    requestedArgv: command,
    executedArgv: command,
    executable: observeExecutableIdentity(process.execPath),
    cwd: root,
    startedAt,
    completedAt,
    exitCode: 0,
    signal: null,
    error: null,
    input: {
      name: 'prompt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from(prompt, 'utf8'),
    },
    stdout: ledger,
    stderr,
    outputFiles: [{
      name: 'model_output',
      path: 'output.json',
      mediaType: 'application/json',
      bytes: output,
    }],
    model: {
      provider,
      model,
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
      toolsUsed: [],
      usage,
      providerRequestId,
      providerSessionId,
      plannedSessionId: sessionId,
    },
  });
}

function executionEnvelope(trustPolicy, core, {
  executionId = 'execution-1',
  ledgerPreviousSha256 = null,
} = {}) {
  return {
    boundaryId: trustPolicy.boundaryId,
    executionId,
    ledgerPreviousSha256,
    executionEvidenceCore: core,
    executionEvidenceSha256: executionEvidenceSha256(core),
  };
}

function signAuthority({ privateKey, keyId, authorityId, attestationId, payload, schemaVersion }) {
  const core = {
    schemaVersion,
    attestationId,
    authorityId,
    payload,
  };
  return {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId,
      valueBase64: crypto.sign(
        null,
        Buffer.from(canonicalJson(core), 'utf8'),
        privateKey,
      ).toString('base64'),
    },
  };
}

function authorityKey(authorityId, capability) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return {
    privateKey,
    authority: {
      authorityId,
      capabilities: [capability],
      publicKeyPem,
      keyId: sha256Text(publicKey.export({ format: 'der', type: 'spki' })),
    },
  };
}

test('proof-runtime and replay authorities require distinct authority IDs and verification keys', () => {
  const shared = authorityKey('fixture-shared-proof-authority', 'proof_runtime');
  const sameAuthorityPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'fixture-same-proof-authority-policy',
    boundaryId: 'fixture-same-proof-authority-boundary',
    productionEnabled: false,
    authorities: [{
      ...shared.authority,
      capabilities: ['proof_runtime', 'proof_replay'],
    }],
    truthBoundary: 'Fixture-only policy proves fail-closed authority independence.',
  };
  const runtimeAttestation = signAuthority({
    privateKey: shared.privateKey,
    keyId: shared.authority.keyId,
    authorityId: shared.authority.authorityId,
    attestationId: 'fixture-shared-runtime-attestation',
    payload: { fixtureOnly: true, role: 'runtime' },
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  });
  const replayAttestation = signAuthority({
    privateKey: shared.privateKey,
    keyId: shared.authority.keyId,
    authorityId: shared.authority.authorityId,
    attestationId: 'fixture-shared-replay-attestation',
    payload: { fixtureOnly: true, role: 'replay' },
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  });
  assert.match(validateCapabilityAuthorityIndependence({
    trustPolicy: sameAuthorityPolicy,
    firstAttestation: runtimeAttestation,
    firstCapability: 'proof_runtime',
    secondAttestation: replayAttestation,
    secondCapability: 'proof_replay',
    requireProduction: false,
  }).errors.join('; '), /same authority ID|same verification-key digest/);

  const sameKeyDifferentIdsPolicy = {
    ...sameAuthorityPolicy,
    policyId: 'fixture-same-key-policy',
    authorities: [
      {
        ...shared.authority,
        authorityId: 'fixture-runtime-authority-a',
        capabilities: ['proof_runtime'],
      },
      {
        ...shared.authority,
        authorityId: 'fixture-replay-authority-b',
        capabilities: ['proof_replay'],
      },
    ],
  };
  const runtimeDifferentId = signAuthority({
    privateKey: shared.privateKey,
    keyId: shared.authority.keyId,
    authorityId: 'fixture-runtime-authority-a',
    attestationId: 'fixture-runtime-a',
    payload: { fixtureOnly: true, role: 'runtime' },
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  });
  const replayDifferentId = signAuthority({
    privateKey: shared.privateKey,
    keyId: shared.authority.keyId,
    authorityId: 'fixture-replay-authority-b',
    attestationId: 'fixture-replay-b',
    payload: { fixtureOnly: true, role: 'replay' },
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  });
  assert.match(validateCapabilityAuthorityIndependence({
    trustPolicy: sameKeyDifferentIdsPolicy,
    firstAttestation: runtimeDifferentId,
    firstCapability: 'proof_runtime',
    secondAttestation: replayDifferentId,
    secondCapability: 'proof_replay',
    requireProduction: false,
  }).errors.join('; '), /key reuse/);
});

test('canonical trusted execution rejects arbitrary, detached, changed, or missing evidence', () => {
  const { privateKey, trustPolicy, keyId } = authorityFixture();
  assert.equal(validatePhdTrustPolicy(trustPolicy).ok, true);
  assert.equal(validatePhdTrustPolicy(trustPolicy, { requireProduction: true }).ok, false);
  const prompt = 'Answer the exact fixture examination.';
  const output = Buffer.from('{"answers":[{"itemId":"one","answer":"1"}]}');
  const ledger = Buffer.from('{"type":"response.created","request_id":"req-1","session_id":"provider-session-1"}\n');
  const stderr = Buffer.alloc(0);
  const core = modelExecutionCore({
    role: 'exam',
    sessionId: 'planned-exam-1',
    prompt,
    output,
    ledger,
    startedAt: '2026-07-27T12:00:00.000Z',
    completedAt: '2026-07-27T12:00:01.000Z',
    bindings: {
      candidateId: 'candidate-1',
    },
  });
  const digest = executionEvidenceSha256(core);
  const attestation = signExecution(
    privateKey,
    keyId,
    executionEnvelope(trustPolicy, core),
  );
  const expected = {
    provider: 'openai-codex',
    model: 'gpt-test',
    role: 'exam',
    plannedSessionId: 'planned-exam-1',
    promptSha256: sha256Bytes(Buffer.from(prompt)),
    bindings: {
      candidateId: 'candidate-1',
      candidateSessionId: 'planned-exam-1',
      candidateSha256: sha256Bytes(output),
    },
    command: core.command,
    observedEnvironment: core.environment.observed,
    startedAt: core.process.startedAt,
    completedAt: core.process.completedAt,
    notBefore: '2026-07-27T11:59:59.000Z',
    notAfter: '2026-07-27T12:00:02.000Z',
  };
  const verify = ({
    signed = attestation,
    storedCore = core,
    storedDigest = digest,
    input = Buffer.from(prompt),
    outputBytes = output,
    stdout = ledger,
    stderrBytes = stderr,
    expectedRecord = expected,
  } = {}) => verifyTrustedExecutionEvidence({
    attestation: signed,
    trustPolicy,
    executionEvidenceCore: storedCore,
    executionEvidenceSha256: storedDigest,
    inputBytes: input,
    rawOutputBytes: outputBytes,
    rawEventLedgerBytes: stdout,
    rawStderrBytes: stderrBytes,
    expected: expectedRecord,
  });
  assert.equal(verify().ok, true);
  assert.match(verifyTrustedExecutionEvidence({
    attestation,
    trustPolicy: { ...trustPolicy, productionEnabled: true },
    executionEvidenceCore: core,
    executionEvidenceSha256: digest,
    inputBytes: Buffer.from(prompt),
    rawOutputBytes: output,
    rawEventLedgerBytes: ledger,
    rawStderrBytes: stderr,
    expected,
  }).errors.join('; '), /missing the independently approved executable identity/);
  assert.equal(verify({ outputBytes: Buffer.from('{"answers":[]}') }).ok, false);
  const descriptorCore = structuredClone(core);
  descriptorCore.command.executedArgv[0] = '/proc/self/fd/3';
  descriptorCore.command.executedArgvSha256 = sha256Text(canonicalJson(
    descriptorCore.command.executedArgv,
  ));
  descriptorCore.command.executable.resolvedPath = '/proc/self/fd/3';
  const descriptorDigest = executionEvidenceSha256(descriptorCore);
  const approvedExecutable = {
    path: descriptorCore.command.requestedArgv[0],
    bytes: descriptorCore.command.executable.bytes,
    sha256: descriptorCore.command.executable.sha256,
  };
  const signedDescriptor = signExecution(
    privateKey,
    keyId,
    executionEnvelope(trustPolicy, descriptorCore),
  );
  const descriptorVerification = verify({
    signed: signedDescriptor,
    storedCore: descriptorCore,
    storedDigest: descriptorDigest,
    expectedRecord: {
      ...expected,
      command: descriptorCore.command,
      approvedExecutable,
    },
  });
  assert.equal(descriptorVerification.ok, true, descriptorVerification.errors.join('; '));
  assert.match(
    verify({
      signed: signedDescriptor,
      storedCore: descriptorCore,
      storedDigest: descriptorDigest,
      expectedRecord: {
        ...expected,
        command: descriptorCore.command,
        approvedExecutable: { ...approvedExecutable, sha256: 'f'.repeat(64) },
      },
    }).errors.join('; '),
    /independently approved executable/,
  );

  const arbitraryDigestEnvelope = executionEnvelope(trustPolicy, core);
  arbitraryDigestEnvelope.executionEvidenceSha256 = 'f'.repeat(64);
  assert.equal(verify({
    signed: signExecution(privateKey, keyId, arbitraryDigestEnvelope),
    storedDigest: 'f'.repeat(64),
  }).ok, false);
  assert.equal(verify({ storedDigest: 'e'.repeat(64) }).ok, false);
  assert.equal(verify({ storedCore: null, storedDigest: null }).ok, false);

  const selfDeclared = structuredClone(attestation);
  selfDeclared.payload.executionEvidenceCore.model.providerSessionId = 'invented-session';
  assert.equal(verify({ signed: selfDeclared }).ok, false);

  const mutations = [
    (changed) => {
      changed.command.executedArgv[changed.command.executedArgv.length - 1] = 'different-input-source';
      changed.command.executedArgvSha256 = sha256Text(canonicalJson(
        changed.command.executedArgv,
      ));
    },
    (changed) => {
      changed.environment.observed.platform = 'changed-platform';
      changed.environment.observedSha256 = sha256Text(canonicalJson(
        changed.environment.observed,
      ));
    },
    (changed) => {
      changed.bindings.candidateId = 'candidate-2';
    },
    (changed) => {
      changed.outputs.files[0].bytes += 1;
    },
    (changed) => {
      changed.process.startedAt = '2026-07-27T11:59:57.000Z';
      changed.process.completedAt = '2026-07-27T11:59:58.000Z';
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(core);
    mutate(changed);
    if (!validateExecutionEvidenceCore(changed).ok) {
      assert.equal(validateExecutionEvidenceCore(changed).ok, false);
      continue;
    }
    const changedDigest = executionEvidenceSha256(changed);
    assert.equal(verify({
      signed: signExecution(
        privateKey,
        keyId,
        executionEnvelope(trustPolicy, changed),
      ),
      storedCore: changed,
      storedDigest: changedDigest,
    }).ok, false);
  }
  for (const injectedArgs of [
    ['--sandbox', 'read-only'],
    ['--dangerously-bypass-approvals-and-sandbox'],
  ]) {
    const changed = structuredClone(core);
    changed.command.requestedArgv.splice(-1, 0, ...injectedArgs);
    changed.command.executedArgv = [...changed.command.requestedArgv];
    changed.command.requestedArgvSha256 = sha256Text(canonicalJson(
      changed.command.requestedArgv,
    ));
    changed.command.executedArgvSha256 = sha256Text(canonicalJson(
      changed.command.executedArgv,
    ));
    const validation = validateExecutionEvidenceCore(changed);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('; '), /canonical worker command|security-critical option/);
  }

  const { notBefore: _notBefore, notAfter: _notAfter, ...missingWindow } = expected;
  assert.equal(verify({ expectedRecord: missingWindow }).ok, false);
});

test('production exam assembly uses authenticated provider time and binds proctor/grader receipts to it', () => {
  const executionKey = authorityKey('exam-execution-authority', 'execution');
  const proctorKey = authorityKey('exam-proctor-authority', 'proctor');
  const graderKey = authorityKey('exam-grader-authority', 'grader');
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'exam-timing-regression-policy',
    boundaryId: 'exam-timing-protected-boundary',
    productionEnabled: false,
    authorities: [executionKey.authority, proctorKey.authority, graderKey.authority],
    truthBoundary: 'Fixture-only authority keys exercise production exam timing mechanics.',
  };
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  const banks = buildSealedQualificationBanks({
    blueprint: runtime.blueprint,
    rubric: runtime.rubric,
    seed: 'exam-timing-regression',
  });
  const spec = runtime.blueprint.coreExams[0];
  const bank = banks[spec.examId];
  const exam = {
    examId: spec.examId,
    kind: 'core',
    passThreshold: spec.passThreshold,
    bankDigest: bank.bankDigest,
    keyDigest: bank.keyDigest,
    promptCommitmentDigest: sha256Text(canonicalJson(bank.items.map((item) => ({
      itemId: item.itemId,
      prompt: item.prompt,
      answerFormat: item.answerFormat,
    })))),
    commitmentRecordedAt: '2026-07-27T12:00:00.000Z',
    candidateSessionId: 'exam-candidate-session',
    proctorId: proctorKey.authority.authorityId,
    graderId: graderKey.authority.authorityId,
  };
  const campaign = {
    campaignId: 'exam-timing-regression',
    subjectId: 'exam-timing-subject',
    fixtureOnly: false,
    frozenAt: '2026-07-27T12:00:00.000Z',
    expiresAt: '2026-07-27T13:00:00.000Z',
    deployment: {
      productTree: '6'.repeat(40),
      runtimeSha256: '7'.repeat(64),
      closureSha256: '8'.repeat(64),
    },
    exams: [exam],
    trustPolicy,
    deployment: runtime.deployment,
    deploymentDigest: sha256Text(canonicalJson(runtime.deployment)),
    modelRuntime: {
      provider: 'openai-codex',
      model: 'gpt-test',
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
    },
  };
  const releasedAt = '2026-07-27T12:01:00.000Z';
  const descriptor = buildExamJobDescriptors({
    campaign,
    sealedBanks: { [exam.examId]: bank },
    releasedAtByExam: { [exam.examId]: releasedAt },
  })[0];
  const answers = bank.items.map((item) => ({
    itemId: item.itemId,
    answer: item.checker.expected,
  }));
  const outputBytes = Buffer.from(JSON.stringify({ answers }));
  const ledgerBytes = Buffer.from('{"type":"response.completed","request_id":"exam-request-1"}\n');
  const executionCore = modelExecutionCore({
    role: 'exam',
    sessionId: exam.candidateSessionId,
    prompt: descriptor.prompt,
    output: outputBytes,
    ledger: ledgerBytes,
    startedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:03:00.000Z',
    usage: { inputTokens: 100, outputTokens: 50 },
    providerRequestId: 'exam-request-1',
    providerSessionId: 'exam-provider-session-1',
    bindings: {
      candidateId: campaign.subjectId,
      taskId: exam.examId,
      taskSha256: sha256Text(canonicalJson(descriptor.task)),
      jobId: descriptor.jobId,
      campaignId: campaign.campaignId,
      campaignSha256: sha256Text(canonicalJson(campaign)),
      deploymentSha256: campaign.deploymentDigest,
      sourceSha256: executionSourceSha256(campaign.deployment),
    },
  });
  const executionEvidenceDigest = executionEvidenceSha256(executionCore);
  const executionPayload = {
    providerRequestId: 'exam-request-1',
    usage: { inputTokens: 100, outputTokens: 50 },
    promptSha256: sha256Text(descriptor.prompt),
    outputSha256: sha256Bytes(outputBytes),
    startedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:03:00.000Z',
  };
  const executionAttestation = signAuthority({
    privateKey: executionKey.privateKey,
    keyId: executionKey.authority.keyId,
    authorityId: executionKey.authority.authorityId,
    attestationId: 'exam-execution-attestation',
    payload: executionEnvelope(trustPolicy, executionCore, {
      executionId: 'exam-execution-1',
    }),
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
  });
  const executionDigest = sha256Text(canonicalJson(executionAttestation));
  const call = timedWorkerCall(campaign, {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    role: 'exam',
    plannedSessionId: exam.candidateSessionId,
    provider: campaign.modelRuntime.provider,
    model: campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: executionPayload.usage,
    exactPromptBytes: true,
    promptSha256: executionPayload.promptSha256,
    outputSha256: executionPayload.outputSha256,
    startedAt: executionPayload.startedAt,
    completedAt: executionPayload.completedAt,
    executionEvidenceCore: executionCore,
    executionEvidenceSha256: executionEvidenceDigest,
    attestation: executionAttestation,
  });
  const receiptTiming = {
    providerRequestId: executionPayload.providerRequestId,
    executionAttestationDigest: executionDigest,
    executionEvidenceSha256: executionEvidenceDigest,
    startedAt: executionPayload.startedAt,
    completedAt: executionPayload.completedAt,
  };
  const proctorReceipt = signAuthority({
    privateKey: proctorKey.privateKey,
    keyId: proctorKey.authority.keyId,
    authorityId: proctorKey.authority.authorityId,
    attestationId: 'exam-proctor-receipt',
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    payload: {
      campaignId: campaign.campaignId,
      examId: exam.examId,
      promptSha256: executionPayload.promptSha256,
      outputSha256: executionPayload.outputSha256,
      ...receiptTiming,
      noPriorAccessObserved: true,
      noToolsObserved: true,
    },
  });
  const graderReceipt = signAuthority({
    privateKey: graderKey.privateKey,
    keyId: graderKey.authority.keyId,
    authorityId: graderKey.authority.authorityId,
    attestationId: 'exam-grader-receipt',
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    payload: {
      campaignId: campaign.campaignId,
      examId: exam.examId,
      outputSha256: executionPayload.outputSha256,
      keyDigest: exam.keyDigest,
      score: 1,
      passed: true,
      ...receiptTiming,
    },
  });
  const assembly = {
    campaign,
    examId: exam.examId,
    sealedBank: bank,
    releasedAt,
    outputBytes,
    rawEventLedgerBytes: ledgerBytes,
    rawStderrBytes: Buffer.alloc(0),
    proctorReceipt,
    graderReceipt,
  };
  assert.equal(assembleExamAttempt({ ...assembly, modelCall: call }).claimedPassed, true);
  assert.throws(() => assembleExamAttempt({
    ...assembly,
    modelCall: timedWorkerCall(campaign, {
      ...call,
      startedAt: '2026-07-27T12:02:01.000Z',
    }),
  }), /wrapper attempt times/);
  const legacyProctorReceipt = signAuthority({
    privateKey: proctorKey.privateKey,
    keyId: proctorKey.authority.keyId,
    authorityId: proctorKey.authority.authorityId,
    attestationId: 'legacy-exam-proctor-receipt',
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    payload: {
      campaignId: campaign.campaignId,
      examId: exam.examId,
      promptSha256: executionPayload.promptSha256,
      outputSha256: executionPayload.outputSha256,
      providerRequestId: executionPayload.providerRequestId,
      noPriorAccessObserved: true,
      noToolsObserved: true,
    },
  });
  assert.throws(() => assembleExamAttempt({
    ...assembly,
    modelCall: call,
    proctorReceipt: legacyProctorReceipt,
  }), /proctor receipt/);
});

test('production reproduction rejects authenticated failed, incomplete, or output-divergent false greens', () => {
  const executionKey = authorityKey('research-execution-authority', 'execution');
  const reproductionKey = authorityKey('research-reproduction-authority', 'research_reproduction');
  const reviewKey = authorityKey('research-review-authority', 'research_review');
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'research-reproduction-regression-policy',
    boundaryId: 'research-reproduction-protected-boundary',
    productionEnabled: false,
    authorities: [
      executionKey.authority,
      reproductionKey.authority,
      reviewKey.authority,
    ],
    truthBoundary: 'Fixture-only authority keys exercise production research mechanics.',
  };
  const sourceFileBytes = Buffer.from('console.log("frozen reproduction");\n');
  const sourceBundle = {
    schemaVersion: 'cortex.learning_os.research_source_bundle.v1',
    files: [{
      path: 'reproduce.mjs',
      bytesBase64: sourceFileBytes.toString('base64'),
      sha256: sha256Bytes(sourceFileBytes),
      executable: false,
    }],
  };
  const sourceBytes = Buffer.from(canonicalJson(sourceBundle));
  const result = { reproduced: true, value: 42 };
  const resultBytes = Buffer.from(canonicalJson(result));
  const environment = {
    executionKind: 'container',
    containerRuntime: 'docker',
    imageReference: `fixture/research@sha256:${'4'.repeat(64)}`,
    imageDigest: `sha256:${'4'.repeat(64)}`,
    imageId: `sha256:${'5'.repeat(64)}`,
    lockDigest: '6'.repeat(64),
    immutable: true,
    networkDisabled: true,
  };
  const command = ['node', 'reproduce.mjs', '--result', 'artifacts/result.json'];
  const approvedResearchRuntime = approvedResearchRuntimeBinding();
  const campaign = {
    campaignId: 'research-reproduction-regression',
    subjectId: 'research-subject',
    fixtureOnly: false,
    frozenAt: '2026-07-27T12:00:00.000Z',
    expiresAt: '2026-07-27T13:00:00.000Z',
    deployment: {
      productTree: '6'.repeat(40),
      runtimeSha256: '7'.repeat(64),
      closureSha256: '8'.repeat(64),
    },
    modelRuntime: {
      provider: 'openai-codex',
      model: 'gpt-test',
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
    },
    roles: {
      researchCandidateSession: 'research-candidate-session',
      researchReviewRequestSession: 'research-review-request-session',
    },
    trustPolicy,
    deployment: {
      schemaVersion: 'cortex.learning_os.deployment_binding.v1',
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40),
      contentDigests: { graph: '7'.repeat(64) },
      approvedResearchRuntime,
    },
    researchProgram: {
      corpus: { ids: ['bounded-source'] },
      corpusDigest: '1'.repeat(64),
      environment,
      environmentDigest: sha256Text(canonicalJson(environment)),
      assumptions: { bounded: true },
      assumptionsDigest: '2'.repeat(64),
      boundedClaim: 'The exact frozen executable source produces the declared bounded result.',
      noveltyCeiling: 'bounded_corpus_only',
      sourceBundle,
      sourceBundleSha256: sha256Bytes(sourceBytes),
      reproduction: {
        command,
        outputPaths: ['artifacts/result.json'],
        resultPath: 'artifacts/result.json',
        timeoutSeconds: 1800,
      },
      formalization: { claimSemanticsSha256: '3'.repeat(64), templateSha256: '5'.repeat(64) },
    },
  };
  campaign.deploymentDigest = sha256Text(canonicalJson(campaign.deployment));
  const candidateDescriptor = buildResearchJobDescriptor({
    campaign,
    role: 'research_candidate',
  });
  const candidateOutput = {
    artifact: { claim: 'bounded executable result' },
    result,
    novelty: {
      status: 'bounded_corpus_only',
      scope: 'Only the declared frozen corpus.',
      globalNoveltyClaim: false,
    },
  };
  const candidateOutputBytes = Buffer.from(JSON.stringify(candidateOutput));
  const rawLedger = Buffer.from('{"type":"response.completed","request_id":"request-1"}\n');
  const candidateCore = modelExecutionCore({
    role: 'research_candidate',
    sessionId: campaign.roles.researchCandidateSession,
    prompt: candidateDescriptor.prompt,
    output: candidateOutputBytes,
    ledger: rawLedger,
    startedAt: '2026-07-27T12:01:00.000Z',
    completedAt: '2026-07-27T12:01:30.000Z',
    usage: { inputTokens: 20, outputTokens: 10 },
    providerRequestId: 'research-request-1',
    providerSessionId: 'research-provider-session-1',
    bindings: {
      taskId: null,
      taskSha256: sha256Text(canonicalJson(candidateDescriptor.task)),
      jobId: candidateDescriptor.jobId,
      campaignId: campaign.campaignId,
      campaignSha256: sha256Text(canonicalJson(campaign)),
      deploymentSha256: campaign.deploymentDigest,
      sourceSha256: executionSourceSha256(campaign.deployment),
    },
  });
  const candidateEvidenceDigest = executionEvidenceSha256(candidateCore);
  const candidateExecutionPayload = {
    providerRequestId: 'research-request-1',
    usage: { inputTokens: 20, outputTokens: 10 },
    promptSha256: sha256Text(candidateDescriptor.prompt),
    outputSha256: sha256Bytes(candidateOutputBytes),
    startedAt: '2026-07-27T12:01:00.000Z',
    completedAt: '2026-07-27T12:01:30.000Z',
  };
  const candidateAttestation = signAuthority({
    privateKey: executionKey.privateKey,
    keyId: executionKey.authority.keyId,
    authorityId: executionKey.authority.authorityId,
    attestationId: 'research-candidate-execution-attestation',
    payload: executionEnvelope(trustPolicy, candidateCore, {
      executionId: 'research-candidate-execution',
    }),
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
  });
  const candidateCall = timedWorkerCall(campaign, {
    schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
    role: 'research_candidate',
    plannedSessionId: campaign.roles.researchCandidateSession,
    provider: campaign.modelRuntime.provider,
    model: campaign.modelRuntime.model,
    thinking: 'xhigh',
    sandbox: 'read-only',
    toolsAllowed: false,
    toolsUsed: [],
    usage: candidateExecutionPayload.usage,
    exactPromptBytes: true,
    promptSha256: candidateExecutionPayload.promptSha256,
    outputSha256: candidateExecutionPayload.outputSha256,
    startedAt: candidateExecutionPayload.startedAt,
    completedAt: candidateExecutionPayload.completedAt,
    executionEvidenceCore: candidateCore,
    executionEvidenceSha256: candidateEvidenceDigest,
    attestation: candidateAttestation,
  });
  const artifactDigest = sha256Text(canonicalJson(candidateOutput.artifact));
  const resultDigest = sha256Text(canonicalJson(result));
  const candidateAttestationDigest = sha256Text(canonicalJson(candidateAttestation));
  const reviewRequestJob = {
    jobId: `${campaign.campaignId}.research-review-request`,
    campaignId: campaign.campaignId,
    role: 'research_review_request',
    sessionId: campaign.roles.researchReviewRequestSession,
    executor: 'authority_request_materialization',
    dependencies: [candidateDescriptor.jobId],
    task: {
      schemaVersion: 'cortex.learning_os.research_review_request_task.v1',
      campaignId: campaign.campaignId,
      candidateJobId: candidateDescriptor.jobId,
      candidateSessionId: campaign.roles.researchCandidateSession,
      candidatePromptSha256: sha256Text(candidateDescriptor.prompt),
      fixtureOnly: false,
      boundedClaim: campaign.researchProgram.boundedClaim,
      corpusDigest: campaign.researchProgram.corpusDigest,
      assumptionsDigest: campaign.researchProgram.assumptionsDigest,
      claimSemanticsSha256: campaign.researchProgram.formalization.claimSemanticsSha256,
    },
  };
  const reviewRequest = createResearchReviewAuthorityRequest({
    job: reviewRequestJob,
    candidateBinding: {
      jobId: candidateDescriptor.jobId,
      candidateSessionId: campaign.roles.researchCandidateSession,
      outputSha256: sha256Bytes(candidateOutputBytes),
      artifact: candidateOutput.artifact,
      artifactDigest,
      result,
      resultDigest,
      harvestedAuthority: 'worker_evidence_only',
    },
  });
  const reviewRequestBinding = createResearchReviewRequestBinding({
    requestBytes: serializeResearchReviewAuthorityRequest(reviewRequest),
    requestJobDigest: sha256Text(canonicalJson(reviewRequestJob)),
    requestStartedAt: '2026-07-27T12:02:00.000Z',
    requestCompletedAt: '2026-07-27T12:02:30.000Z',
  });
  const outputs = [{
    path: 'artifacts/result.json',
    bytes: resultBytes.length,
    contentBase64: resultBytes.toString('base64'),
    sha256: sha256Bytes(resultBytes),
  }];
  const stdoutBytes = Buffer.from('reproduced\n');
  const reproductionTask = {
    schemaVersion: 'cortex.learning_os.research_reproduction_task.v1',
    campaignId: campaign.campaignId,
    candidateJobId: candidateDescriptor.jobId,
    candidateSessionId: campaign.roles.researchCandidateSession,
    candidatePromptSha256: sha256Text(candidateDescriptor.prompt),
    fixtureOnly: false,
    approvedResearchRuntime,
    approvedResearchRuntimeSha256: sha256Text(canonicalJson(approvedResearchRuntime)),
    sourceBundle,
    sourceBundleSha256: sha256Bytes(sourceBytes),
    environment,
    environmentDigest: sha256Text(canonicalJson(environment)),
    command,
    commandDigest: sha256Text(canonicalJson(command)),
    outputPaths: ['artifacts/result.json'],
    resultPath: 'artifacts/result.json',
    timeoutSeconds: 1800,
  };
  const containerId = 'a'.repeat(64);
  const containerIdPath = path.join(path.dirname(root), 'container.cid');
  const requestedArgv = [
    approvedResearchRuntime.path,
    '--host',
    `unix://${approvedResearchRuntime.daemonClosure.socketPath}`,
    'run',
    '--cidfile', containerIdPath,
    '--runtime',
    approvedResearchRuntime.daemonClosure.derivedTopology.defaultRuntimeName,
    '--network=none',
    '--read-only',
    '--security-opt=no-new-privileges',
    '--security-opt=apparmor=docker-default',
    `--security-opt=seccomp=${
      approvedResearchRuntime.daemonClosure.derivedTopology.seccompProfilePath
    }`,
    '--log-driver=none',
    '--cap-drop=ALL',
    '--pids-limit=256',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--volume', `${root}:/workspace:rw`,
    '--workdir', '/workspace',
    environment.imageReference,
    ...command,
  ];
  const executedArgv = ['/proc/self/fd/4', ...requestedArgv.slice(1)];
  const isolation = {
    network: 'none',
    rootFilesystem: 'read_only',
    noNewPrivileges: true,
    capabilities: 'none',
    pidLimit: 256,
    temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
    workspaceMount: 'rw',
  };
  const imageInspectBytes = Buffer.from(canonicalJson({
    Id: environment.imageId,
    RepoDigests: [environment.imageReference],
  }));
  const containerInspectBytes = Buffer.from(canonicalJson({
    Id: containerId,
    Image: environment.imageId,
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      PidsLimit: 256,
      Runtime: approvedResearchRuntime.daemonClosure.derivedTopology.defaultRuntimeName,
      LogConfig: { Type: 'none', Config: {} },
      CapDrop: ['ALL'],
      CapAdd: [],
      Devices: [],
      SecurityOpt: [
        'apparmor=docker-default',
        'no-new-privileges',
        `seccomp=${
          approvedResearchRuntime.daemonClosure.derivedTopology.seccompProfilePath
        }`,
      ],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=64m' },
    },
    Config: { WorkingDir: '/workspace' },
    Mounts: [{
      Type: 'bind',
      Source: root,
      Destination: '/workspace',
      RW: true,
    }],
  }));
  const effectiveIsolation = {
    containerId,
    imageId: environment.imageId,
    network: 'none',
    rootFilesystem: 'read_only',
    noNewPrivileges: true,
    privileged: false,
    capabilities: 'none',
    addedCapabilities: 'none',
    devices: 'none',
    pidLimit: 256,
    temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
    workspaceMount: {
      type: 'bind',
      source: root,
      destination: '/workspace',
      readWrite: true,
    },
    workingDirectory: '/workspace',
  };
  const kernelEvidence = cycle8KernelEvidence({
    binding: approvedResearchRuntime,
    containerId,
    workspace: root,
  });
  const observedEnvironment = {
    executionKind: 'container',
    containerRuntime: 'docker',
    approvedResearchRuntimeSha256: reproductionTask.approvedResearchRuntimeSha256,
    runtimeClosureSha256: approvedResearchRuntime.runtimeClosureSha256,
    daemonClosureSha256: approvedResearchRuntime.daemonClosureSha256,
    daemonObservation: structuredClone(approvedResearchRuntime.daemonClosure),
    daemonSocketPath: approvedResearchRuntime.daemonClosure.socketPath,
    daemonMeasurements: [
      'before_image_inspect',
      'after_image_inspect',
      'before_run',
      'after_run',
      'after_cleanup',
    ].map((phase) => observedDaemonMeasurement(
      phase,
      approvedResearchRuntime.daemonClosure,
    )),
    imageReference: environment.imageReference,
    imageDigest: environment.imageDigest,
    imageId: environment.imageId,
    imageRepoDigests: [environment.imageReference],
    imageInspectBase64: imageInspectBytes.toString('base64'),
    imageInspectSha256: sha256Bytes(imageInspectBytes),
    containerInspectBase64: containerInspectBytes.toString('base64'),
    containerInspectSha256: sha256Bytes(containerInspectBytes),
    kernelEvidence,
    effectiveIsolation,
    runtimeCommands: {
      imageInspect: [
        approvedResearchRuntime.path,
        '--host',
        `unix://${approvedResearchRuntime.daemonClosure.socketPath}`,
        'image', 'inspect', '--format', '{{json .}}', environment.imageReference,
      ],
      run: requestedArgv,
      containerInspect: [
        approvedResearchRuntime.path,
        '--host',
        `unix://${approvedResearchRuntime.daemonClosure.socketPath}`,
        'container', 'inspect', '--format', '{{json .}}', containerId,
      ],
      remove: [
        approvedResearchRuntime.path,
        '--host',
        `unix://${approvedResearchRuntime.daemonClosure.socketPath}`,
        'rm', '--force', containerId,
      ],
    },
    runtimeLockDigest: environment.lockDigest,
    processEnvironment: { LANG: 'C', LC_ALL: 'C' },
    isolation,
  };
  const reproductionCore = createExecutionEvidenceCore({
    executionKind: 'process',
    bindings: {
      candidateId: null,
      candidateSessionId: campaign.roles.researchCandidateSession,
      candidateSha256: sha256Bytes(candidateOutputBytes),
      taskId: null,
      taskSha256: sha256Text(canonicalJson(reproductionTask)),
      jobId: `${campaign.campaignId}.research-reproduction`,
      jobSha256: '8'.repeat(64),
      campaignId: campaign.campaignId,
      campaignSha256: sha256Text(canonicalJson(campaign)),
      deploymentSha256: campaign.deploymentDigest,
      sourceSha256: sha256Bytes(sourceBytes),
    },
    declaredEnvironment: environment,
    observedEnvironment,
    requestedArgv,
    executedArgv,
    executable: {
      invoked: approvedResearchRuntime.path,
      resolvedPath: '/proc/self/fd/4',
      bytes: approvedResearchRuntime.bytes,
      sha256: approvedResearchRuntime.sha256,
    },
    cwd: root,
    startedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:02:30.000Z',
    exitCode: 0,
    signal: null,
    error: null,
    input: {
      name: 'source_bundle',
      mediaType: 'application/json',
      bytes: sourceBytes,
    },
    stdout: stdoutBytes,
    stderr: Buffer.alloc(0),
    outputFiles: [{
      name: 'output_1',
      path: outputs[0].path,
      mediaType: 'application/octet-stream',
      bytes: resultBytes,
    }],
  });
  const reproductionEvidenceDigest = executionEvidenceSha256(reproductionCore);
  const bundle = {
    schemaVersion: RESEARCH_REPRODUCTION_BUNDLE_SCHEMA,
    fixtureOnly: false,
    status: 'passed',
    exitCode: 0,
    sourceBundleBase64: sourceBytes.toString('base64'),
    sourceBundleSha256: sha256Bytes(sourceBytes),
    environment,
    environmentDigest: sha256Text(canonicalJson(environment)),
    command,
    commandDigest: sha256Text(canonicalJson(command)),
    approvedResearchRuntimeSha256: reproductionTask.approvedResearchRuntimeSha256,
    daemonClosureSha256: approvedResearchRuntime.daemonClosureSha256,
    observedEnvironmentSha256: sha256Text(canonicalJson(observedEnvironment)),
    executedArgvSha256: sha256Text(canonicalJson(executedArgv)),
    executableSha256: approvedResearchRuntime.sha256,
    isolationSha256: sha256Text(canonicalJson(isolation)),
    stdoutBase64: stdoutBytes.toString('base64'),
    stdoutSha256: sha256Bytes(stdoutBytes),
    stderrBase64: '',
    stderrSha256: sha256Bytes(Buffer.alloc(0)),
    outputs,
    resultOutputPath: outputs[0].path,
    resultBase64: resultBytes.toString('base64'),
    resultSha256: sha256Bytes(resultBytes),
    result,
    resultDigest,
    startedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:02:30.000Z',
    executionEvidenceCore: reproductionCore,
    executionEvidenceSha256: reproductionEvidenceDigest,
    authorityRequestBytesBase64: '',
    authorityRequestSha256: '',
    attestation: null,
  };
  const reproductionPayload = {
    schemaVersion: RESEARCH_REPRODUCTION_BUNDLE_SCHEMA,
    fixtureOnly: false,
    campaignId: campaign.campaignId,
    artifactDigest,
    sourceBundleSha256: bundle.sourceBundleSha256,
    environmentDigest: bundle.environmentDigest,
    commandDigest: bundle.commandDigest,
    approvedResearchRuntimeSha256: bundle.approvedResearchRuntimeSha256,
    daemonClosureSha256: bundle.daemonClosureSha256,
    observedEnvironmentSha256: bundle.observedEnvironmentSha256,
    executedArgvSha256: bundle.executedArgvSha256,
    executableSha256: bundle.executableSha256,
    isolationSha256: bundle.isolationSha256,
    stdoutSha256: bundle.stdoutSha256,
    stderrSha256: bundle.stderrSha256,
    outputsDigest: sha256Text(canonicalJson(outputs)),
    resultOutputPath: bundle.resultOutputPath,
    resultSha256: bundle.resultSha256,
    resultDigest,
    status: 'passed',
    exitCode: 0,
    startedAt: bundle.startedAt,
    completedAt: bundle.completedAt,
    executionEvidenceCore: bundle.executionEvidenceCore,
    executionEvidenceSha256: bundle.executionEvidenceSha256,
  };
  const requestedPayloadBytes = Buffer.from(canonicalJson(reproductionPayload));
  const authorityRequest = {
    schemaVersion: RESEARCH_REPRODUCTION_REQUEST_SCHEMA,
    requestedCapability: 'research_reproduction',
    unsigned: true,
    selfAttestation: false,
    status: 'ready_for_independent_authority',
    candidateBinding: {
      jobId: candidateDescriptor.jobId,
      candidateSessionId: campaign.roles.researchCandidateSession,
      outputSha256: sha256Bytes(candidateOutputBytes),
      artifact: candidateOutput.artifact,
      artifactDigest,
      result,
      resultDigest,
      harvestedAuthority: 'worker_evidence_only',
    },
    approvedResearchRuntime,
    approvedResearchRuntimeSha256: reproductionTask.approvedResearchRuntimeSha256,
    declaredEnvironment: environment,
    observedEnvironment,
    sourceBundleSha256: bundle.sourceBundleSha256,
    command,
    executedCommand: executedArgv,
    commandDigest: bundle.commandDigest,
    startedAt: bundle.startedAt,
    completedAt: bundle.completedAt,
    process: { exitCode: 0, signal: null, error: null },
    logs: {
      stdout: 'stdout.raw',
      stdoutSha256: bundle.stdoutSha256,
      stderr: 'stderr.raw',
      stderrSha256: bundle.stderrSha256,
    },
    outputs,
    resultPath: bundle.resultOutputPath,
    result,
    recomputedResultDigest: resultDigest,
    expectedResultDigest: resultDigest,
    outputError: null,
    executionEvidenceCore: bundle.executionEvidenceCore,
    executionEvidenceSha256: bundle.executionEvidenceSha256,
    requestedAttestationPayload: reproductionPayload,
    requestedAttestationPayloadBytesBase64: requestedPayloadBytes.toString('base64'),
    requestedAttestationPayloadSha256: sha256Bytes(requestedPayloadBytes),
    authorityAttestation: null,
    truthBoundary: 'This is inert execution evidence and an unsigned request. Only a separate trusted reproduction authority may attest it.',
  };
  const authorityRequestBytes = serializeResearchReproductionAuthorityRequest(authorityRequest);
  bundle.authorityRequestBytesBase64 = authorityRequestBytes.toString('base64');
  bundle.authorityRequestSha256 = sha256Bytes(authorityRequestBytes);
  const authorityResearchRuntime = cycle7ApprovedResearchRuntimeBinding({
    bytes: 456789,
    sha256: 'e'.repeat(64),
  });
  const authorityResearchRuntimeSha256 = sha256Text(canonicalJson(authorityResearchRuntime));
  const authorityReplayCore = structuredClone(reproductionCore);
  authorityReplayCore.bindings.jobId =
    `${campaign.campaignId}.research-reproduction-authority-replay`;
  authorityReplayCore.bindings.jobSha256 = bundle.authorityRequestSha256;
  const authorityReplayCwd = '/var/lib/cortex/authority-replay/workspace';
  const authorityContainerId = 'b'.repeat(64);
  const authorityCidPath = path.join(
    path.dirname(authorityReplayCwd),
    'container.cid',
  );
  const authorityRun = [
    authorityResearchRuntime.path,
    '--host',
    `unix://${authorityResearchRuntime.daemonClosure.socketPath}`,
    'run',
    '--cidfile', authorityCidPath,
    '--runtime',
    authorityResearchRuntime.daemonClosure.derivedTopology.defaultRuntimeName,
    '--network=none',
    '--read-only',
    '--security-opt=no-new-privileges',
    '--security-opt=apparmor=docker-default',
    `--security-opt=seccomp=${
      authorityResearchRuntime.daemonClosure.derivedTopology.seccompProfilePath
    }`,
    '--log-driver=none',
    '--cap-drop=ALL',
    '--pids-limit=256',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--volume', `${authorityReplayCwd}:/workspace:rw`,
    '--workdir', '/workspace',
    environment.imageReference,
    ...command,
  ];
  const authorityContainerInspect = JSON.parse(containerInspectBytes.toString('utf8'));
  authorityContainerInspect.Id = authorityContainerId;
  authorityContainerInspect.Mounts[0].Source = authorityReplayCwd;
  authorityContainerInspect.HostConfig.Runtime =
    authorityResearchRuntime.daemonClosure.derivedTopology.defaultRuntimeName;
  authorityContainerInspect.HostConfig.SecurityOpt = [
    'apparmor=docker-default',
    'no-new-privileges',
    `seccomp=${
      authorityResearchRuntime.daemonClosure.derivedTopology.seccompProfilePath
    }`,
  ];
  const authorityContainerInspectBytes = Buffer.from(
    canonicalJson(authorityContainerInspect),
  );
  authorityReplayCore.command.cwd = authorityReplayCwd;
  authorityReplayCore.command.requestedArgv = authorityRun;
  authorityReplayCore.command.requestedArgvSha256 =
    sha256Text(canonicalJson(authorityRun));
  authorityReplayCore.command.executedArgv = [
    '/proc/self/fd/4',
    ...authorityRun.slice(1),
  ];
  authorityReplayCore.command.executable = {
    invoked: authorityResearchRuntime.path,
    resolvedPath: '/proc/self/fd/4',
    bytes: authorityResearchRuntime.bytes,
    sha256: authorityResearchRuntime.sha256,
  };
  authorityReplayCore.command.executedArgvSha256 = sha256Text(canonicalJson(
    authorityReplayCore.command.executedArgv,
  ));
  const authorityObserved = authorityReplayCore.environment.observed;
  authorityObserved.approvedResearchRuntimeSha256 = authorityResearchRuntimeSha256;
  authorityObserved.runtimeClosureSha256 = authorityResearchRuntime.runtimeClosureSha256;
  authorityObserved.daemonClosureSha256 = authorityResearchRuntime.daemonClosureSha256;
  authorityObserved.daemonObservation = structuredClone(authorityResearchRuntime.daemonClosure);
  authorityObserved.daemonSocketPath = authorityResearchRuntime.daemonClosure.socketPath;
  authorityObserved.daemonMeasurements = [
    'before_image_inspect',
    'after_image_inspect',
    'before_run',
    'after_run',
    'after_cleanup',
  ].map((phase) => observedDaemonMeasurement(
    phase,
    authorityResearchRuntime.daemonClosure,
  ));
  authorityObserved.containerInspectBase64 =
    authorityContainerInspectBytes.toString('base64');
  authorityObserved.containerInspectSha256 =
    sha256Bytes(authorityContainerInspectBytes);
  authorityObserved.effectiveIsolation.containerId = authorityContainerId;
  authorityObserved.effectiveIsolation.workspaceMount.source = authorityReplayCwd;
  authorityObserved.kernelEvidence = cycle8KernelEvidence({
    binding: authorityResearchRuntime,
    containerId: authorityContainerId,
    workspace: authorityReplayCwd,
    pid: 6262,
    observedAt: '2026-07-27T12:03:10.000Z',
  });
  authorityObserved.runtimeCommands.run = authorityRun;
  authorityObserved.runtimeCommands.imageInspect = [
    authorityResearchRuntime.path,
    '--host',
    `unix://${authorityResearchRuntime.daemonClosure.socketPath}`,
    'image', 'inspect', '--format', '{{json .}}', environment.imageReference,
  ];
  authorityObserved.runtimeCommands.containerInspect = [
    authorityResearchRuntime.path,
    '--host',
    `unix://${authorityResearchRuntime.daemonClosure.socketPath}`,
    'container', 'inspect', '--format', '{{json .}}', authorityContainerId,
  ];
  authorityObserved.runtimeCommands.remove = [
    authorityResearchRuntime.path,
    '--host',
    `unix://${authorityResearchRuntime.daemonClosure.socketPath}`,
    'rm', '--force', authorityContainerId,
  ];
  authorityReplayCore.environment.observedSha256 =
    sha256Text(canonicalJson(authorityObserved));
  authorityReplayCore.process.startedAt = '2026-07-27T12:03:00.000Z';
  authorityReplayCore.process.completedAt = '2026-07-27T12:03:30.000Z';
  const authorityMeasurement = {
    schemaVersion: 'cortex.learning_os.research_reproduction_authority_measurement.v1',
    requestSha256: bundle.authorityRequestSha256,
    approvedResearchRuntimeSha256: authorityResearchRuntimeSha256,
    authorityResearchRuntime,
    authorityResearchRuntimeSha256,
    daemonClosureSha256: authorityResearchRuntime.daemonClosureSha256,
    daemonMeasurements: structuredClone(authorityObserved.daemonMeasurements),
    imageId: environment.imageId,
    imageInspectSha256: authorityObserved.imageInspectSha256,
    containerInspectSha256: authorityObserved.containerInspectSha256,
    effectiveIsolationSha256: sha256Text(canonicalJson(
      authorityObserved.effectiveIsolation,
    )),
    isolation: structuredClone(isolation),
    isolationSha256: sha256Text(canonicalJson(isolation)),
    replayExecutionEvidenceCore: authorityReplayCore,
    replayExecutionEvidenceSha256: executionEvidenceSha256(authorityReplayCore),
    replayOutputsDigest: sha256Text(canonicalJson(authorityReplayCore.outputs.files)),
    replayResultDigest: resultDigest,
  };
  bundle.attestation = signAuthority({
    privateKey: reproductionKey.privateKey,
    keyId: reproductionKey.authority.keyId,
    authorityId: reproductionKey.authority.authorityId,
    attestationId: 'research-reproduction-attestation',
    payload: {
      schemaVersion: 'cortex.learning_os.research_reproduction_authority_payload.v2',
      requestSha256: bundle.authorityRequestSha256,
      reproductionPayload,
      authorityMeasurement,
    },
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  });
  const reviewResult = {
    status: 'passed',
    adversarial: true,
    findings: [],
  };
  const signReview = ({
    binding = reviewRequestBinding,
    request = reviewRequest,
    result: signedResult = reviewResult,
    startedAt = '2026-07-27T12:03:00.000Z',
    completedAt = '2026-07-27T12:03:30.000Z',
    attestationId = 'research-review-attestation',
  } = {}) => signAuthority({
      privateKey: reviewKey.privateKey,
      keyId: reviewKey.authority.keyId,
      authorityId: reviewKey.authority.authorityId,
      attestationId,
      schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
      payload: {
      schemaVersion: 'cortex.learning_os.research_review_authority_payload.v2',
      requestSha256: binding.requestSha256,
      requestJobId: binding.requestJobId,
      requestJobDigest: binding.requestJobDigest,
      requestSessionId: binding.requestSessionId,
      campaignId: campaign.campaignId,
      candidateBinding: request.candidateBinding,
      boundedClaim: request.boundedClaim,
      corpusDigest: request.corpusDigest,
      assumptionsDigest: request.assumptionsDigest,
      artifactDigest,
      resultDigest,
      claimSemanticsSha256: campaign.researchProgram.formalization.claimSemanticsSha256,
      reviewResult: signedResult,
      reviewResultDigest: sha256Text(canonicalJson(signedResult)),
      findingsDigest: sha256Text(canonicalJson(signedResult.findings)),
      startedAt,
      completedAt,
      candidateExecutionAttestationDigest: candidateAttestationDigest,
      candidateStartedAt: candidateExecutionPayload.startedAt,
      candidateCompletedAt: candidateExecutionPayload.completedAt,
    },
  });
  const reviewAttestation = signReview();
  const assembled = assembleProductionResearchEvidence({
    campaign,
    candidateCall,
    candidateOutputBytes,
    candidateRawEventLedgerBytes: rawLedger,
    reproductionBundle: bundle,
    reviewAttestation,
    reviewRequestBinding,
  });
  assert.equal(assembled.reproduction.status, 'passed');
  assert.equal(validateProductionResearchAttestations({
    campaign,
    artifactDigest,
    result,
    resultDigest,
    candidateExecution: assembled.candidateExecution,
    reproductionBundle: assembled.reproduction,
    reviewAttestation: assembled.review.attestation,
    reviewRequestBinding: assembled.review.request,
  }).ok, true);

  const validateReview = (binding, attestation) => validateProductionResearchAttestations({
    campaign,
    artifactDigest,
    result,
    resultDigest,
    candidateExecution: assembled.candidateExecution,
    reproductionBundle: assembled.reproduction,
    reviewAttestation: attestation,
    reviewRequestBinding: binding,
  }).ok;
  const requestVariant = (mutate) => {
    const request = structuredClone(reviewRequest);
    mutate(request);
    const binding = createResearchReviewRequestBinding({
      requestBytes: serializeResearchReviewAuthorityRequest(request),
      requestJobDigest: request.requestJobSha256,
      requestStartedAt: reviewRequestBinding.requestStartedAt,
      requestCompletedAt: reviewRequestBinding.requestCompletedAt,
    });
    return { request, binding };
  };
  const reviewScopeSubstitutions = [
    ['request-job', (request) => {
      request.requestJobId = `${campaign.campaignId}.substituted-review-request`;
    }],
    ['request-session', (request) => {
      request.requestSessionId = 'substituted-review-request-session';
    }],
    ['candidate-session', (request) => {
      request.candidateBinding.candidateSessionId = 'substituted-candidate-session';
    }],
    ['candidate', (request) => {
      request.candidateBinding.artifact = { claim: 'substituted candidate' };
      request.candidateBinding.artifactDigest = sha256Text(canonicalJson(
        request.candidateBinding.artifact,
      ));
    }],
    ['bounded-claim', (request) => { request.boundedClaim = 'A weaker bounded claim.'; }],
    ['corpus', (request) => { request.corpusDigest = 'a'.repeat(64); }],
    ['assumptions', (request) => { request.assumptionsDigest = 'b'.repeat(64); }],
    ['claim-semantics', (request) => {
      request.claimSemanticsSha256 = 'd'.repeat(64);
    }],
  ];
  for (const [label, mutate] of reviewScopeSubstitutions) {
    const substituted = requestVariant(mutate);
    assert.equal(validateReview(
      substituted.binding,
      signReview({
        binding: substituted.binding,
        request: substituted.request,
        attestationId: `research-review-${label}`,
      }),
    ), false, label);
  }
  const newlineBinding = structuredClone(reviewRequestBinding);
  const newlineBytes = Buffer.concat([
    Buffer.from(newlineBinding.requestBytesBase64, 'base64'),
    Buffer.from('\n'),
  ]);
  newlineBinding.requestBytesBase64 = newlineBytes.toString('base64');
  newlineBinding.requestSha256 = sha256Bytes(newlineBytes);
  assert.equal(validateReview(newlineBinding, reviewAttestation), false, 'newline bytes');

  const reorderedBinding = structuredClone(reviewRequestBinding);
  const reorderedRequest = Object.fromEntries(Object.entries(reviewRequest).reverse());
  const reorderedBytes = Buffer.from(JSON.stringify(reorderedRequest));
  reorderedBinding.requestBytesBase64 = reorderedBytes.toString('base64');
  reorderedBinding.requestSha256 = sha256Bytes(reorderedBytes);
  assert.equal(validateReview(reorderedBinding, reviewAttestation), false, 'request bytes');

  const unknownBinding = structuredClone(reviewRequestBinding);
  const unknownBytes = Buffer.from(canonicalJson({ ...reviewRequest, unapproved: true }));
  unknownBinding.requestBytesBase64 = unknownBytes.toString('base64');
  unknownBinding.requestSha256 = sha256Bytes(unknownBytes);
  assert.equal(validateReview(unknownBinding, reviewAttestation), false, 'unknown field');

  const lateBinding = structuredClone(reviewRequestBinding);
  lateBinding.requestCompletedAt = '2026-07-27T12:03:01.000Z';
  assert.equal(validateReview(lateBinding, reviewAttestation), false, 'review timing');

  const crossRequest = requestVariant(
    (request) => { request.corpusDigest = 'c'.repeat(64); },
  );
  assert.equal(
    validateReview(crossRequest.binding, reviewAttestation),
    false,
    'cross-request attestation substitution',
  );

  for (const [label, mutate] of [
    ['authority-result-drift', (measurement) => {
      measurement.replayResultDigest = 'f'.repeat(64);
    }],
    ['authority-runtime-drift', (measurement) => {
      measurement.approvedResearchRuntimeSha256 = 'f'.repeat(64);
    }],
    ['authority-daemon-drift', (measurement) => {
      measurement.daemonMeasurements[3].socketInode = '999999';
    }],
    ['authority-not-distinct', (measurement) => {
      measurement.replayExecutionEvidenceCore = structuredClone(reproductionCore);
      measurement.replayExecutionEvidenceSha256 = reproductionEvidenceDigest;
    }],
    ['authority-overlapping-replay', (measurement) => {
      measurement.replayExecutionEvidenceCore.process.startedAt = bundle.startedAt;
      measurement.replayExecutionEvidenceCore.process.completedAt = bundle.completedAt;
      measurement.replayExecutionEvidenceSha256 = executionEvidenceSha256(
        measurement.replayExecutionEvidenceCore,
      );
    }],
    ['same-daemon-common-mode', (measurement) => {
      measurement.authorityResearchRuntime = structuredClone(approvedResearchRuntime);
      measurement.authorityResearchRuntimeSha256 =
        reproductionTask.approvedResearchRuntimeSha256;
      measurement.approvedResearchRuntimeSha256 =
        reproductionTask.approvedResearchRuntimeSha256;
      measurement.daemonClosureSha256 = approvedResearchRuntime.daemonClosureSha256;
    }],
  ]) {
    const substituted = structuredClone(assembled.reproduction);
    mutate(substituted.attestation.payload.authorityMeasurement);
    substituted.attestation = signAuthority({
      privateKey: reproductionKey.privateKey,
      keyId: reproductionKey.authority.keyId,
      authorityId: reproductionKey.authority.authorityId,
      attestationId: `research-${label}`,
      payload: substituted.attestation.payload,
      schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    });
    assert.equal(validateProductionResearchAttestations({
      campaign,
      artifactDigest,
      result,
      resultDigest,
      candidateExecution: assembled.candidateExecution,
      reproductionBundle: substituted,
      reviewAttestation: assembled.review.attestation,
      reviewRequestBinding,
    }).ok, false, label);
  }

  const independentlyReauthorize = (candidate) => {
    candidate.executionEvidenceCore.command.requestedArgvSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.command.requestedArgv,
    ));
    candidate.executionEvidenceCore.command.executedArgvSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.command.executedArgv,
    ));
    candidate.executionEvidenceCore.environment.observedSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.environment.observed,
    ));
    candidate.executionEvidenceSha256 = executionEvidenceSha256(
      candidate.executionEvidenceCore,
    );
    candidate.observedEnvironmentSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.environment.observed,
    ));
    candidate.executedArgvSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.command.executedArgv,
    ));
    candidate.executableSha256 = candidate.executionEvidenceCore.command.executable.sha256;
    candidate.isolationSha256 = sha256Text(canonicalJson(
      candidate.executionEvidenceCore.environment.observed.isolation,
    ));
    const payload = {
      schemaVersion: RESEARCH_REPRODUCTION_BUNDLE_SCHEMA,
      fixtureOnly: false,
      campaignId: campaign.campaignId,
      artifactDigest,
      sourceBundleSha256: candidate.sourceBundleSha256,
      environmentDigest: candidate.environmentDigest,
      commandDigest: candidate.commandDigest,
      approvedResearchRuntimeSha256: candidate.approvedResearchRuntimeSha256,
      daemonClosureSha256: candidate.daemonClosureSha256,
      observedEnvironmentSha256: candidate.observedEnvironmentSha256,
      executedArgvSha256: candidate.executedArgvSha256,
      executableSha256: candidate.executableSha256,
      isolationSha256: candidate.isolationSha256,
      stdoutSha256: candidate.stdoutSha256,
      stderrSha256: candidate.stderrSha256,
      outputsDigest: sha256Text(canonicalJson(candidate.outputs)),
      resultOutputPath: candidate.resultOutputPath,
      resultSha256: candidate.resultSha256,
      resultDigest: candidate.resultDigest,
      status: 'passed',
      exitCode: 0,
      startedAt: candidate.startedAt,
      completedAt: candidate.completedAt,
      executionEvidenceCore: candidate.executionEvidenceCore,
      executionEvidenceSha256: candidate.executionEvidenceSha256,
    };
    const payloadBytes = Buffer.from(canonicalJson(payload));
    const request = {
      schemaVersion: RESEARCH_REPRODUCTION_REQUEST_SCHEMA,
      requestedCapability: 'research_reproduction',
      unsigned: true,
      selfAttestation: false,
      status: 'ready_for_independent_authority',
      candidateBinding: {
        jobId: candidateDescriptor.jobId,
        candidateSessionId: campaign.roles.researchCandidateSession,
        outputSha256: sha256Bytes(candidateOutputBytes),
        artifact: candidateOutput.artifact,
        artifactDigest,
        result,
        resultDigest,
        harvestedAuthority: 'worker_evidence_only',
      },
      approvedResearchRuntime,
      approvedResearchRuntimeSha256: reproductionTask.approvedResearchRuntimeSha256,
      declaredEnvironment: environment,
      observedEnvironment: candidate.executionEvidenceCore.environment.observed,
      sourceBundleSha256: candidate.sourceBundleSha256,
      command,
      executedCommand: candidate.executionEvidenceCore.command.executedArgv,
      commandDigest: candidate.commandDigest,
      startedAt: candidate.startedAt,
      completedAt: candidate.completedAt,
      process: { exitCode: 0, signal: null, error: null },
      logs: {
        stdout: 'stdout.raw',
        stdoutSha256: candidate.stdoutSha256,
        stderr: 'stderr.raw',
        stderrSha256: candidate.stderrSha256,
      },
      outputs: candidate.outputs,
      resultPath: candidate.resultOutputPath,
      result,
      recomputedResultDigest: resultDigest,
      expectedResultDigest: resultDigest,
      outputError: null,
      executionEvidenceCore: candidate.executionEvidenceCore,
      executionEvidenceSha256: candidate.executionEvidenceSha256,
      requestedAttestationPayload: payload,
      requestedAttestationPayloadBytesBase64: payloadBytes.toString('base64'),
      requestedAttestationPayloadSha256: sha256Bytes(payloadBytes),
      authorityAttestation: null,
      truthBoundary: 'This is inert execution evidence and an unsigned request. Only a separate trusted reproduction authority may attest it.',
    };
    const requestBytes = serializeResearchReproductionAuthorityRequest(request);
    candidate.authorityRequestBytesBase64 = requestBytes.toString('base64');
    candidate.authorityRequestSha256 = sha256Bytes(requestBytes);
    candidate.attestation = signAuthority({
      privateKey: reproductionKey.privateKey,
      keyId: reproductionKey.authority.keyId,
      authorityId: reproductionKey.authority.authorityId,
      attestationId: 'research-reproduction-adversarial-attestation',
      payload: {
        schemaVersion: 'cortex.learning_os.research_reproduction_authority_payload.v2',
        requestSha256: candidate.authorityRequestSha256,
        reproductionPayload: payload,
        authorityMeasurement: bundle.attestation.payload.authorityMeasurement,
      },
      schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    });
  };
  const nodeIdentity = observeExecutableIdentity(process.execPath);
  for (const [label, mutate] of [
    ['node-as-runtime', (candidate) => {
      candidate.executionEvidenceCore.command.requestedArgv[0] = nodeIdentity.resolvedPath;
      candidate.executionEvidenceCore.command.executedArgv[0] = nodeIdentity.resolvedPath;
      candidate.executionEvidenceCore.command.executable = {
        ...nodeIdentity,
        invoked: nodeIdentity.resolvedPath,
      };
    }],
    ['fake-image-output', (candidate) => {
      candidate.executionEvidenceCore.environment.observed.imageId = `sha256:${'f'.repeat(64)}`;
      candidate.executionEvidenceCore.environment.observed.imageInspectSha256 = 'f'.repeat(64);
    }],
    ['malicious-socket', (candidate) => {
      candidate.executionEvidenceCore.command.requestedArgv[2] = 'unix:///tmp/fake.sock';
      candidate.executionEvidenceCore.command.executedArgv[2] = 'unix:///tmp/fake.sock';
      candidate.executionEvidenceCore.environment.observed.daemonSocketPath =
        '/tmp/fake.sock';
    }],
    ['ignored-isolation', (candidate) => {
      candidate.executionEvidenceCore.environment.observed.isolation.network = 'bridge';
      candidate.executionEvidenceCore.environment.observed.effectiveIsolation.network =
        'bridge';
      const inspected = JSON.parse(Buffer.from(
        candidate.executionEvidenceCore.environment.observed.containerInspectBase64,
        'base64',
      ).toString('utf8'));
      inspected.HostConfig.NetworkMode = 'bridge';
      const inspectedBytes = Buffer.from(canonicalJson(inspected));
      candidate.executionEvidenceCore.environment.observed.containerInspectBase64 =
        inspectedBytes.toString('base64');
      candidate.executionEvidenceCore.environment.observed.containerInspectSha256 =
        sha256Bytes(inspectedBytes);
    }],
    ['fake-inspect-ignored-kernel-isolation', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.network.interfaces = ['eth0', 'lo'];
      kernel.network.nonLoopbackIpv4Routes = [{
        interface: 'eth0',
        destination: '00000000',
        gateway: '0100007F',
      }];
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['kernel-seccomp-disabled', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.security.seccompMode = 0;
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['kernel-apparmor-policy-substitution', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.security.lsmPolicy.kernelPolicySha256 = 'f'.repeat(64);
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['kernel-helper-substitution', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.helpers[0].executable.sha256 = 'f'.repeat(64);
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['kernel-image-layer-substitution', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.rootfs.imageLayers[0].treeSha256 = '0'.repeat(64);
      kernel.rootfs.contentSha256 = sha256Text(canonicalJson(
        kernel.rootfs.imageLayers.map((layer) => layer.treeSha256),
      ));
      kernel.rootfs.generationSha256 = sha256Text(canonicalJson({
        root: kernel.mounts.root,
        layers: kernel.rootfs.imageLayers,
      }));
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['kernel-init-executable-substitution', (candidate) => {
      const kernel = candidate.executionEvidenceCore.environment.observed.kernelEvidence;
      kernel.init.executable.sha256 = '0'.repeat(64);
      const unsigned = { ...kernel };
      delete unsigned.evidenceSha256;
      kernel.evidenceSha256 = sha256Text(canonicalJson(unsigned));
    }],
    ['daemon-restart-before-inspect', (candidate) => {
      candidate.executionEvidenceCore.environment.observed.daemonMeasurements[0]
        .startTimeTicks = '999999';
    }],
    ['daemon-restart-between-inspect-and-run', (candidate) => {
      candidate.executionEvidenceCore.environment.observed.daemonMeasurements[2]
        .invocationId = 'f'.repeat(32);
    }],
    ['writable-path-substitution', (candidate) => {
      candidate.executionEvidenceCore.command.requestedArgv[0] = '/tmp/writable/docker';
      candidate.executionEvidenceCore.command.executable.invoked = '/tmp/writable/docker';
    }],
    ['hash-to-spawn-replacement', (candidate) => {
      candidate.executionEvidenceCore.command.executedArgv[0] = '/tmp/replaced/docker';
      candidate.executionEvidenceCore.command.executable.resolvedPath = '/tmp/replaced/docker';
    }],
  ]) {
    const substituted = structuredClone(bundle);
    mutate(substituted);
    independentlyReauthorize(substituted);
    assert.equal(
      validateExecutionEvidenceCore(substituted.executionEvidenceCore).ok,
      true,
      `${label} remains a structurally valid rehashed execution core`,
    );
    assert.equal(validateProductionResearchAttestations({
      campaign,
      artifactDigest,
      result,
      resultDigest,
      candidateExecution: assembled.candidateExecution,
      reproductionBundle: substituted,
      reviewAttestation,
      reviewRequestBinding,
    }).ok, false, label);
  }

  const requestSubstitutions = [
    ['newline-substitution', (candidate) => {
      const bytes = Buffer.concat([
        Buffer.from(candidate.authorityRequestBytesBase64, 'base64'),
        Buffer.from('\n'),
      ]);
      candidate.authorityRequestBytesBase64 = bytes.toString('base64');
      candidate.authorityRequestSha256 = sha256Bytes(bytes);
    }],
    ['field-order-substitution', (candidate) => {
      const request = JSON.parse(
        Buffer.from(candidate.authorityRequestBytesBase64, 'base64').toString('utf8'),
      );
      const reordered = Object.fromEntries(Object.entries(request).reverse());
      const bytes = Buffer.from(JSON.stringify(reordered));
      candidate.authorityRequestBytesBase64 = bytes.toString('base64');
      candidate.authorityRequestSha256 = sha256Bytes(bytes);
    }],
    ['unknown-field-substitution', (candidate) => {
      const request = JSON.parse(
        Buffer.from(candidate.authorityRequestBytesBase64, 'base64').toString('utf8'),
      );
      request.unapproved = true;
      const bytes = serializeResearchReproductionAuthorityRequest(request);
      candidate.authorityRequestBytesBase64 = bytes.toString('base64');
      candidate.authorityRequestSha256 = sha256Bytes(bytes);
    }],
    ['payload-substitution', (candidate) => {
      const request = JSON.parse(
        Buffer.from(candidate.authorityRequestBytesBase64, 'base64').toString('utf8'),
      );
      request.requestedAttestationPayload.artifactDigest = 'f'.repeat(64);
      const payloadBytes = Buffer.from(canonicalJson(request.requestedAttestationPayload));
      request.requestedAttestationPayloadBytesBase64 = payloadBytes.toString('base64');
      request.requestedAttestationPayloadSha256 = sha256Bytes(payloadBytes);
      const bytes = serializeResearchReproductionAuthorityRequest(request);
      candidate.authorityRequestBytesBase64 = bytes.toString('base64');
      candidate.authorityRequestSha256 = sha256Bytes(bytes);
    }],
    ['request-field-substitution', (candidate) => {
      const request = JSON.parse(
        Buffer.from(candidate.authorityRequestBytesBase64, 'base64').toString('utf8'),
      );
      request.commandDigest = 'f'.repeat(64);
      const bytes = serializeResearchReproductionAuthorityRequest(request);
      candidate.authorityRequestBytesBase64 = bytes.toString('base64');
      candidate.authorityRequestSha256 = sha256Bytes(bytes);
    }],
  ];
  for (const [label, mutate] of requestSubstitutions) {
    const substituted = structuredClone(bundle);
    mutate(substituted);
    substituted.attestation = signAuthority({
      privateKey: reproductionKey.privateKey,
      keyId: reproductionKey.authority.keyId,
      authorityId: reproductionKey.authority.authorityId,
      attestationId: `research-${label}`,
      payload: {
        schemaVersion: 'cortex.learning_os.research_reproduction_authority_payload.v2',
        requestSha256: substituted.authorityRequestSha256,
        reproductionPayload,
        authorityMeasurement: bundle.attestation.payload.authorityMeasurement,
      },
      schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
    });
    assert.equal(validateProductionResearchAttestations({
      campaign,
      artifactDigest,
      result,
      resultDigest,
      candidateExecution: assembled.candidateExecution,
      reproductionBundle: substituted,
      reviewAttestation,
      reviewRequestBinding,
    }).ok, false, label);
  }

  for (const mutate of [
    (candidate) => { candidate.status = 'failed'; },
    (candidate) => { candidate.exitCode = 1; },
    (candidate) => { delete candidate.sourceBundleBase64; },
    (candidate) => { candidate.executionEvidenceSha256 = 'f'.repeat(64); },
    (candidate) => { delete candidate.executionEvidenceCore; },
    (candidate) => { candidate.executionEvidenceCore.bindings.candidateId = 'other-candidate'; },
    (candidate) => { candidate.executionEvidenceCore.environment.observed.platform = 'other-platform'; },
    (candidate) => { candidate.executionEvidenceCore.process.completedAt = '2026-07-27T12:02:31.000Z'; },
    (candidate) => {
      candidate.outputs[0].contentBase64 = Buffer.from('{"reproduced":false}').toString('base64');
      candidate.outputs[0].sha256 = sha256Bytes(Buffer.from('{"reproduced":false}'));
    },
  ]) {
    const falseGreen = structuredClone(bundle);
    mutate(falseGreen);
    assert.throws(() => assembleProductionResearchEvidence({
      campaign,
      candidateCall,
      candidateOutputBytes,
      candidateRawEventLedgerBytes: rawLedger,
      reproductionBundle: falseGreen,
      reviewAttestation,
      reviewRequestBinding,
    }), /passed process outcome|incomplete|output bytes|output[/]result correspondence|attestation/);
    assert.equal(validateProductionResearchAttestations({
      campaign,
      artifactDigest,
      result,
      resultDigest,
      candidateExecution: assembled.candidateExecution,
      reproductionBundle: falseGreen,
      reviewAttestation,
      reviewRequestBinding,
    }).ok, false);
  }
});

test('generated qualification banks and the checked-in trust policy remain explicitly non-production', () => {
  const trustPolicy = read('policies/phd-production-trust.v1.json');
  assert.equal(validatePhdTrustPolicy(trustPolicy).ok, true);
  assert.equal(validatePhdTrustPolicy(trustPolicy, { requireProduction: true }).ok, false);
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  const banks = buildSealedQualificationBanks({
    blueprint: runtime.blueprint,
    rubric: runtime.rubric,
    seed: 'adversarial-bank-fixture',
  });
  assert.equal(Object.values(banks).every((bank) => (
    bank.fixtureOnly === true
    && bank.provenance === 'synthetic_generated_fixture'
  )), true);
  const firstSpec = runtime.blueprint.coreExams[0];
  const invalidProductionBank = validateProductionQualificationBank({
    bank: banks[firstSpec.examId],
    spec: firstSpec,
    kind: 'core',
    graph: runtime.graph,
    rubric: runtime.rubric,
    trustPolicy,
    declaredSpecializationTracks: [],
    usedFamilies: new Set(),
  });
  assert.equal(invalidProductionBank.ok, false);
  assert.match(invalidProductionBank.errors.join('; '), /identity|provenance|attestation|graduate/);
  assert.equal(runtime.productionTrustReady, false);
});

test('one production authority cannot collapse independent trust roles', () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyId = sha256Text(publicKey.export({ format: 'der', type: 'spki' }));
  const trustPolicy = {
    schemaVersion: 'cortex.learning_os.phd_trust_policy.v1',
    policyId: 'collapsed-authority-policy',
    boundaryId: 'collapsed-boundary',
    productionEnabled: true,
    authorities: [{
      authorityId: 'one-principal',
      keyId,
      publicKeyPem,
      capabilities: [
        'acquisition',
        'bank_authoring',
        'bank_review',
        'execution',
        'grader',
        'proctor',
        'proof_replay',
        'proof_runtime',
        'qualification_family_registry',
        'research_correspondence',
        'research_reproduction',
        'research_review',
      ],
    }],
  };
  const validation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /combines independent capabilities/);
});

test('production control boundary rejects fixture and substituted deployment bundles', () => {
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  for (const hostileFixtureOnly of [true, 0, 1, 'true', {}, []]) {
    const fixtureValidation = validateProductionControlBundle({
      canonicalProgram: runtime,
      bundle: {
        expectedDeployment: runtime.deployment,
        nested: [{ fixtureOnly: hostileFixtureOnly }],
      },
    });
    assert.equal(fixtureValidation.ok, false);
    assert.match(fixtureValidation.errors.join('\n'), /fixture-only evidence/);
  }
  const productionFixtureMode = validateProductionControlBundle({
    canonicalProgram: runtime,
    bundle: {
      expectedDeployment: runtime.deployment,
      nested: [{ fixtureOnly: false }],
    },
  });
  assert.doesNotMatch(productionFixtureMode.errors.join('\n'), /fixture-only evidence/);
  for (const hostileDryRun of [true, 1, 'true', {}, []]) {
    const dryRunValidation = validateProductionControlBundle({
      canonicalProgram: runtime,
      command: 'retention-resume',
      bundle: {
        expectedDeployment: runtime.deployment,
        dryRun: hostileDryRun,
      },
    });
    assert.equal(dryRunValidation.ok, false);
    assert.match(
      dryRunValidation.errors.join('\n'),
      /must omit dryRun or set it to exactly false/,
    );
  }
  const substituted = structuredClone(runtime.deployment);
  substituted.sourceCommit = 'c'.repeat(40);
  const deploymentValidation = validateProductionControlBundle({
    canonicalProgram: runtime,
    bundle: { expectedDeployment: substituted },
  });
  assert.equal(deploymentValidation.ok, false);
  assert.match(deploymentValidation.errors.join('\n'), /differs from exact committed deployment/);
});

test('production control policy routing is command-specific and alias-free', () => {
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  assert.equal(
    validateRetentionPolicy(runtime.retentionPolicy, { fixtureOnly: false }).ok,
    true,
  );
  assert.equal(
    validateRetentionPolicy(runtime.acquisitionPolicy, { fixtureOnly: false }).ok,
    false,
  );
  const boundary = (command, policyFields) => validateProductionControlBundle({
    canonicalProgram: runtime,
    command,
    bundle: {
      expectedDeployment: runtime.deployment,
      ...policyFields,
    },
  }).errors.join('; ');
  const assertExactPolicyRoute = (command, expectedPolicy, wrongPolicy) => {
    const accepted = boundary(command, { policy: expectedPolicy });
    assert.doesNotMatch(accepted, /requires one exact canonical policy field/);
    assert.doesNotMatch(accepted, /control bundle policy differs/);
    assert.doesNotMatch(accepted, /policy is ambiguous/);

    assert.match(
      boundary(command, {}),
      /requires one exact canonical policy field/,
    );
    assert.match(
      boundary(command, { policy: wrongPolicy }),
      /control bundle policy differs/,
    );
    for (const alias of ['acquisitionPolicy', 'retentionPolicy']) {
      assert.match(
        boundary(command, {
          policy: expectedPolicy,
          [alias]: expectedPolicy,
        }),
        new RegExp(`policy is ambiguous: use only policy; forbidden aliases: ${alias}`),
      );
    }
    assert.match(
      boundary(command, {
        acquisitionPolicy: runtime.acquisitionPolicy,
        retentionPolicy: runtime.retentionPolicy,
      }),
      /requires one exact canonical policy field.*policy is ambiguous/s,
    );
  };

  assertExactPolicyRoute(
    'acquisition-receipt',
    runtime.acquisitionPolicy,
    runtime.retentionPolicy,
  );
  for (const command of [
    'retention-task',
    'retention-release',
    'retention-grade',
    'retention-status',
    'retention-resume',
  ]) {
    assertExactPolicyRoute(
      command,
      runtime.retentionPolicy,
      runtime.acquisitionPolicy,
    );
  }
});

test('retention resume binds the exact campaign, due task, window, predecessor, and bank', () => {
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  const campaignBinding = {
    campaignId: 'retention-campaign-a',
    campaignDigest: 'a'.repeat(64),
  };
  const bank = {
    bankId: 'retention-bank-a',
    bankDigest: 'b'.repeat(64),
    bindings: { campaign: campaignBinding },
  };
  const previousWindowDigest = 'c'.repeat(64);
  const resumeAt = '2026-08-08T00:00:00.000Z';
  const task = {
    schemaVersion: 'cortex.learning_os.retention_window_task.v2',
    taskId: 'retention-task-window-2',
    subjectId: 'retention-subject',
    fixtureOnly: false,
    deploymentDigest: deploymentBindingDigest(runtime.deployment),
    acquisitionBinding: { stateDigest: 'd'.repeat(64) },
    assessmentCampaign: campaignBinding,
    windowIndex: 2,
    previousWindowDigest,
    notBefore: resumeAt,
    assessmentBankRecordDigest: sha256Text(canonicalJson(bank)),
    assessmentBankId: bank.bankId,
    sealedItemBankDigest: bank.bankDigest,
  };
  const wait = {
    fixtureOnly: false,
    subjectId: task.subjectId,
    campaignBinding,
    deploymentDigest: task.deploymentDigest,
    acquisitionStateDigest: task.acquisitionBinding.stateDigest,
    nextWindowIndex: 2,
    previousWindowDigest,
    resumeAt,
    sourceStatusDigest: 'e'.repeat(64),
    dueTaskDigest: sha256Text(canonicalJson(task)),
  };
  const bundle = {
    expectedDeployment: runtime.deployment,
    policy: runtime.retentionPolicy,
    fixtureOnly: false,
    campaignBinding,
    task,
    assessmentBank: bank,
  };
  const bindingErrors = (candidateBundle, candidateWait = wait) => (
    validateProductionControlBundle({
      canonicalProgram: runtime,
      command: 'retention-resume',
      retentionWait: candidateWait,
      bundle: candidateBundle,
    }).errors.filter((error) => error.startsWith('production retention resume'))
  );
  assert.deepEqual(bindingErrors(bundle), []);

  const crossCampaign = {
    campaignId: 'retention-campaign-b',
    campaignDigest: 'f'.repeat(64),
  };
  for (const candidate of [
    { ...bundle, campaignBinding: crossCampaign },
    {
      ...bundle,
      task: { ...task, assessmentCampaign: crossCampaign },
    },
    {
      ...bundle,
      assessmentBank: {
        ...bank,
        bindings: { campaign: crossCampaign },
      },
    },
  ]) {
    assert.match(
      bindingErrors(candidate).join('; '),
      /campaign differs across wait, bundle, task, or assessment bank/,
    );
  }
  const crossBank = structuredClone(bank);
  crossBank.bindings.campaign = crossCampaign;
  const crossTask = structuredClone(task);
  crossTask.assessmentCampaign = crossCampaign;
  crossTask.assessmentBankRecordDigest = sha256Text(canonicalJson(crossBank));
  const crossBundle = {
    ...bundle,
    campaignBinding: crossCampaign,
    task: crossTask,
    assessmentBank: crossBank,
  };
  assert.match(
    bindingErrors(crossBundle, {
      ...wait,
      dueTaskDigest: sha256Text(canonicalJson(crossTask)),
    }).join('; '),
    /campaign differs across wait, bundle, task, or assessment bank/,
  );

  const staleTask = { ...task, taskId: 'stale-retention-task-window-2' };
  assert.match(
    bindingErrors({ ...bundle, task: staleTask }).join('; '),
    /task digest differs from the signed wait/,
  );

  const substitutedBank = { ...bank, bankId: 'retention-bank-substituted' };
  assert.match(
    bindingErrors({ ...bundle, assessmentBank: substitutedBank }).join('; '),
    /assessment bank differs from the signed due task/,
  );

  const wrongWindowTask = {
    ...task,
    windowIndex: 1,
    previousWindowDigest: null,
  };
  assert.match(
    bindingErrors({ ...bundle, task: wrongWindowTask }, {
      ...wait,
      dueTaskDigest: sha256Text(canonicalJson(wrongWindowTask)),
    }).join('; '),
    /task window or predecessor differs from the signed wait/,
  );

  const wrongPredecessorTask = {
    ...task,
    previousWindowDigest: '0'.repeat(64),
  };
  assert.match(
    bindingErrors({ ...bundle, task: wrongPredecessorTask }, {
      ...wait,
      dueTaskDigest: sha256Text(canonicalJson(wrongPredecessorTask)),
    }).join('; '),
    /task window or predecessor differs from the signed wait/,
  );

  const laterTask = {
    ...task,
    notBefore: '2026-08-08T00:00:01.000Z',
  };
  assert.match(
    bindingErrors({ ...bundle, task: laterTask }, {
      ...wait,
      dueTaskDigest: sha256Text(canonicalJson(laterTask)),
    }).join('; '),
    /task due time differs from the signed wait/,
  );
});

test('production adaptive verifier exposes no caller-selectable fixture mode', () => {
  assert.throws(
    () => verifyAdaptiveArtifacts({ allowTestFixtures: true }),
    /no fixture acceptance mode/,
  );
});

test('metadata-only acquisition registry rows cannot stand in for signed bank bytes', () => {
  const runtime = loadCanonicalPhdProgram({
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    allowWorkingTreeFixtures: true,
  });
  const registry = runtime.graph.concepts.map((concept, index) => ({
    assessmentId: `assessment-${index}`,
    conceptId: concept.conceptId,
    theoremFamilyId: `concept-family-${index}`,
    assessmentClass: 'independently_authored_concept_specific',
    productionEligible: true,
    outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
  }));
  const validation = validateAcquisitionAssessmentRegistry(registry, runtime.graph);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /registry entry/);
});
