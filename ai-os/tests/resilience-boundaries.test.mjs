import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AIOS_EVIDENCE_MAX_AGE_MS,
  createBoundVerifierEvidence,
  digestJson,
  validateBoundVerifierEvidence,
} from '../packages/aios-language/runtime/claim-evidence.mjs';
import {
  buildProviderAccessContract,
  executeCapabilityGatedProviderOperation,
  normalizeProviderPolicy,
  providerPolicyDigest,
  providerPolicyTrust,
} from '../packages/aios-language/runtime/provider-read-compute.mjs';
import { commandPromoteDefault, compactStatus, validatePromotionApproval } from '../../scripts/aios-adapter.mjs';

const aiOsRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.dirname(aiOsRoot);
const providerPolicy = JSON.parse(fs.readFileSync(path.join(aiOsRoot, 'kernel', 'policy', 'provider-read-compute.json'), 'utf8'));

function boundFixture({
  now = new Date('2030-01-01T00:10:00.000Z'),
  bootAt = new Date('2030-01-01T00:09:50.000Z'),
  completedAt = new Date('2030-01-01T00:09:55.000Z'),
  runAt = new Date('2030-01-01T00:09:56.000Z'),
  verifierContracts = ['status exists'],
  includeStatusResult = true,
  providerOperation = null,
} = {}) {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-bound-evidence-'));
  const tenantBoundary = { tenantId: 'test-tenant', boundaryHash: 'test-boundary-hash' };
  const declaredSyscalls = providerOperation
    ? [{ op: `provider.${providerOperation}`, args: { provider: 'cortex' } }]
    : includeStatusResult ? [{ op: 'kernel.artifact.status', args: {} }] : [];
  const job = {
    id: 'bounded-job',
    boundary: { tenantId: 'test-tenant', workspaceId: 'test-workspace' },
    verifierContracts,
    syscalls: declaredSyscalls,
  };
  const bootProof = {
    ok: true,
    packetType: 'aios.boot.proof',
    generatedAt: bootAt.toISOString(),
    route: 'test-route',
    operatorRequest: { operatorScope: { tenantId: 'test-tenant' } },
    artifactRoot,
    tenantBoundary,
    lifecycleSettings: {},
    providerContract: {},
    kernelContracts: {},
    artifactLayout: {},
    hostedBoot: {},
  };
  bootProof.proofHash = digestJson({
    route: bootProof.route,
    operatorRequest: bootProof.operatorRequest,
    artifactRoot,
    tenantBoundary,
    lifecycleSettings: bootProof.lifecycleSettings,
    providerContract: bootProof.providerContract,
    kernelContracts: bootProof.kernelContracts,
    artifactLayout: bootProof.artifactLayout,
    hostedBoot: bootProof.hostedBoot,
  });

  const lifecycle = [{ ordinal: 1, state: 'completed', at: completedAt.toISOString(), processId: 'test-process' }];
  let providerResultPath = null;
  let syscallResults = includeStatusResult
    ? [{ ordinal: 1, op: 'kernel.artifact.status', ok: true, output: { bootOk: true } }]
    : [];
  if (providerOperation) {
    const providerResult = { schemaVersion: 'aios.provider-result.v1', response: { status: 200, body: {} } };
    providerResultPath = path.join(artifactRoot, `${providerOperation}-result.json`);
    fs.writeFileSync(providerResultPath, `${JSON.stringify(providerResult, null, 2)}\n`);
    syscallResults = [{
      ordinal: 1,
      op: `provider.${providerOperation}`,
      ok: true,
      output: {
        resultPath: providerResultPath,
        resultHash: digestJson(providerResult),
        outputBoundary: 'internal-artifact-only',
        externalWrites: true,
        externalTransportEffect: 'network-post',
        resultStorageExternalWrites: false,
        remoteSideEffects: 'not_observable',
      },
    }];
  }
  const processRecord = {
    processId: 'test-process',
    job: { id: job.id, hash: digestJson(job) },
    state: 'completed',
    route: 'test-route',
    operatorRequest: { operatorScope: { tenantId: 'test-tenant' } },
    lifecycleSettings: {},
    providerContract: {},
    providerPolicy: { digest: providerPolicyDigest(providerPolicy) },
    lifecycle,
    syscallResults,
  };
  processRecord.recordHash = digestJson({
    processId: processRecord.processId,
    job: processRecord.job,
    state: processRecord.state,
    route: processRecord.route,
    operatorRequest: processRecord.operatorRequest,
    lifecycleSettings: processRecord.lifecycleSettings,
    providerContract: processRecord.providerContract,
    providerPolicy: processRecord.providerPolicy,
    lifecycle,
    syscallResults,
  });
  const processPath = path.join(artifactRoot, 'process.json');
  fs.writeFileSync(processPath, `${JSON.stringify(processRecord, null, 2)}\n`);

  const runProof = {
    ok: true,
    packetType: 'aios.run.proof',
    generatedAt: runAt.toISOString(),
    route: 'test-route',
    operatorRequest: { operatorScope: { tenantId: 'test-tenant' } },
    artifactRoot,
    process: { id: processRecord.processId, state: 'completed', recordPath: processPath, recordHash: processRecord.recordHash },
    job: processRecord.job,
    lifecycleSettings: {},
    providerContract: {},
    providerPolicy: processRecord.providerPolicy,
    kernelMediation: {},
    restartSafety: { recovered: false },
    analytics: {},
    processIndex: {},
    lifecycle,
    syscallResults,
  };
  runProof.proofHash = digestJson({
    packetType: 'aios.run.proof',
    route: runProof.route,
    operatorRequest: runProof.operatorRequest,
    artifactRoot,
    process: runProof.process,
    job: runProof.job,
    lifecycleSettings: runProof.lifecycleSettings,
    providerContract: runProof.providerContract,
    providerPolicy: runProof.providerPolicy,
    kernelMediation: runProof.kernelMediation,
    restartSafety: runProof.restartSafety,
    analytics: runProof.analytics,
    processIndex: runProof.processIndex,
    lifecycle,
    syscallResults,
  });
  return { artifactRoot, tenantBoundary, job, bootProof, runProof, providerPolicy, providerResultPath, now };
}

test('bound verifier accepts current exact evidence and rejects cross-job or self-attested evidence', () => {
  const fixture = boundFixture();
  try {
    const evidence = createBoundVerifierEvidence(fixture);
    assert.equal(evidence.ok, true);
    assert.ok(evidence.checks.some((entry) => entry.name === 'job_verifier_contract:status exists' && entry.ok === true));
    const accepted = validateBoundVerifierEvidence({ ...fixture, verifierEvidence: evidence });
    assert.equal(accepted.ok, true);

    const crossJob = validateBoundVerifierEvidence({
      ...fixture,
      job: { ...fixture.job, id: 'other-job' },
      verifierEvidence: evidence,
    });
    assert.equal(crossJob.ok, false);
    assert.ok(crossJob.errors.some((entry) => entry.code === 'AIOS_RUN_JOB_MISMATCH'));

    const selfAttested = validateBoundVerifierEvidence({
      ...fixture,
      verifierEvidence: {
        ok: true,
        status: 'green',
        packetType: 'aios.verifier.evidence',
        generatedAt: fixture.now.toISOString(),
        checks: [{ name: 'self-attested', ok: true }],
      },
    });
    assert.equal(selfAttested.ok, false);
    assert.ok(selfAttested.errors.some((entry) => entry.code === 'AIOS_VERIFIER_SCHEMA_INVALID'));
    assert.ok(selfAttested.errors.some((entry) => entry.code === 'AIOS_VERIFIER_CHECKS_MISMATCH'));
  } finally {
    fs.rmSync(fixture.artifactRoot, { recursive: true, force: true });
  }
});

test('fresh wrapper cannot qualify a stale reused process or stale boot proof', () => {
  const now = new Date('2030-01-01T00:30:00.000Z');
  const staleProcess = boundFixture({
    now,
    bootAt: new Date(now.getTime() - 10_000),
    completedAt: new Date(now.getTime() - AIOS_EVIDENCE_MAX_AGE_MS - 1),
    runAt: new Date(now.getTime() - 1_000),
  });
  const staleBoot = boundFixture({
    now,
    bootAt: new Date(now.getTime() - AIOS_EVIDENCE_MAX_AGE_MS - 1),
    completedAt: new Date(now.getTime() - 2_000),
    runAt: new Date(now.getTime() - 1_000),
  });
  try {
    const processEvidence = createBoundVerifierEvidence(staleProcess);
    assert.equal(processEvidence.ok, false);
    assert.ok(processEvidence.checks.some((entry) => entry.name === 'AIOS_RUN_PROCESS_COMPLETION_STALE'));
    const bootEvidence = createBoundVerifierEvidence(staleBoot);
    assert.equal(bootEvidence.ok, false);
    assert.ok(bootEvidence.checks.some((entry) => entry.name === 'AIOS_BOOT_EVIDENCE_STALE'));
  } finally {
    fs.rmSync(staleProcess.artifactRoot, { recursive: true, force: true });
    fs.rmSync(staleBoot.artifactRoot, { recursive: true, force: true });
  }
});

test('verifier contracts are required, supported narrowly, and fail closed', () => {
  const missing = boundFixture({ verifierContracts: [] });
  const unsupported = boundFixture({ verifierContracts: ['wishful assertion is true'] });
  const failed = boundFixture({ includeStatusResult: false });
  try {
    assert.ok(createBoundVerifierEvidence(missing).checks.some((entry) => entry.name === 'AIOS_JOB_VERIFIER_CONTRACT_REQUIRED'));
    assert.ok(createBoundVerifierEvidence(unsupported).checks.some((entry) => entry.name === 'AIOS_JOB_VERIFIER_CONTRACT_UNSUPPORTED'));
    assert.ok(createBoundVerifierEvidence(failed).checks.some((entry) => entry.name === 'AIOS_JOB_VERIFIER_CONTRACT_FAILED'));
  } finally {
    for (const fixture of [missing, unsupported, failed]) fs.rmSync(fixture.artifactRoot, { recursive: true, force: true });
  }
});

test('provider verifier contracts bind readable, hashed result artifacts and their effect boundary', () => {
  const fixture = boundFixture({
    verifierContracts: ['provider read artifact exists'],
    includeStatusResult: false,
    providerOperation: 'read',
  });
  try {
    const evidence = createBoundVerifierEvidence(fixture);
    assert.equal(evidence.ok, true);
    assert.ok(evidence.checks.some((entry) => entry.name === 'job_verifier_contract:provider read artifact exists' && entry.ok === true));
    fs.rmSync(fixture.providerResultPath);
    const missingArtifact = createBoundVerifierEvidence(fixture);
    assert.equal(missingArtifact.ok, false);
    assert.ok(missingArtifact.checks.some((entry) => entry.name === 'AIOS_JOB_VERIFIER_CONTRACT_FAILED'));
  } finally {
    fs.rmSync(fixture.artifactRoot, { recursive: true, force: true });
  }
});

test('stale frozen evidence is historical, not current readiness', () => {
  const frozenRoot = path.join(aiOsRoot, 'artifacts', 'language-adoption-20260711T211822Z', 'local-proof');
  const status = compactStatus(frozenRoot);
  assert.equal(status.ok, false);
  assert.notEqual(status.status, 'green');
  assert.equal(status.verifierEvidenceOk, false);
  assert.equal(status.claimBindingOk, false);
  assert.equal(status.freshness.run.stale, true);

  const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'config', 'ai-os-adapter', 'default.json'), 'utf8'));
  assert.equal(config.enabled, false);
  assert.equal(config.status, 'unqualified_template');
});

test('default promotion preserves active bytes until smoke, recovery, and explicit approval are green', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-promotion-gate-'));
  const active = path.join(temporary, 'active-default.json');
  const previous = Buffer.from('{"enabled":true,"artifactRoot":"prior"}\n');
  fs.writeFileSync(active, previous);
  let recoveries = 0;
  let approvals = 0;
  let commits = 0;
  const commitPromotion = () => {
    commits += 1;
    fs.writeFileSync(active, '{"enabled":true,"artifactRoot":"candidate"}\n');
    return { config: { truthBoundary: 'test-boundary' }, state: { status: 'green' } };
  };
  const greenSmoke = { ok: true, artifactRoot: '/tmp/staged', claimStatus: 'allowed', claimNextAction: { state: 'awaiting_operator_approval' } };
  const greenRecovery = { ok: true, status: 'green', recoveryReportPath: '/tmp/recovery.json', statusSummary: { verifierEvidenceOk: true, bootOk: true, runOk: true } };
  try {
    assert.throws(
      () => commandPromoteDefault({}, {
        smokeRunner: () => ({ ok: false, artifactRoot: '/tmp/staged' }),
        recoveryRunner: () => { recoveries += 1; return greenRecovery; },
        approvalValidator: () => { approvals += 1; return { ok: true }; },
        commitPromotion,
      }),
      /smoke checks are not green/,
    );
    assert.equal(recoveries, 0);
    assert.equal(approvals, 0);
    assert.deepEqual(fs.readFileSync(active), previous);

    assert.throws(
      () => commandPromoteDefault({}, {
        smokeRunner: () => greenSmoke,
        recoveryRunner: () => ({ ok: false, status: 'degraded' }),
        approvalValidator: () => { approvals += 1; return { ok: true }; },
        commitPromotion,
      }),
      /recovery checks are not green/,
    );
    assert.equal(approvals, 0);
    assert.deepEqual(fs.readFileSync(active), previous);

    assert.throws(
      () => commandPromoteDefault({}, {
        smokeRunner: () => greenSmoke,
        recoveryRunner: () => greenRecovery,
        approvalValidator: () => ({ ok: false, checks: [{ name: 'approval_packet_green', ok: false }] }),
        commitPromotion,
      }),
      /explicit operator approval is missing or invalid/,
    );
    assert.equal(commits, 0);
    assert.deepEqual(fs.readFileSync(active), previous);

    const promoted = commandPromoteDefault({}, {
      smokeRunner: () => greenSmoke,
      recoveryRunner: () => greenRecovery,
      approvalValidator: () => ({ ok: true, subject: 'claim:test' }),
      commitPromotion,
    });
    assert.equal(promoted.status, 'default_on');
    assert.equal(commits, 1);
    assert.notDeepEqual(fs.readFileSync(active), previous);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('promotion approval is fresh, principal-bound, hash-valid, and claim-specific', () => {
  const artifactRoot = fs.mkdtempSync(path.join(aiOsRoot, '.promotion-approval-test-'));
  const packets = path.join(artifactRoot, 'packets');
  fs.mkdirSync(packets, { recursive: true });
  const tenantBoundary = { tenantId: 'test', boundaryHash: 'tenant-boundary' };
  const claim = {
    packetType: 'aios.completion.claim',
    route: 'test-route',
    operatorRequest: {},
    generatedAt: new Date(Date.now() - 2_000).toISOString(),
    artifactRoot,
    subject: 'claim:approval-test',
    job: {},
    tenantBoundary,
    lifecycleSettings: {},
    providerContract: {},
    requiredArtifacts: {},
    evidenceBinding: {},
    verifierIdentity: {},
    claimScope: { kind: 'supported_job_verifier_contracts', contracts: ['status exists'] },
    claimStatus: 'allowed',
    approvalRequirement: 'required',
    nextAction: { state: 'awaiting_operator_approval' },
  };
  claim.claimHash = digestJson({
    packetType: claim.packetType,
    route: claim.route,
    operatorRequest: claim.operatorRequest,
    job: claim.job,
    artifactRoot,
    tenantBoundary,
    lifecycleSettings: claim.lifecycleSettings,
    providerContract: claim.providerContract,
    requiredArtifacts: claim.requiredArtifacts,
    evidenceBinding: claim.evidenceBinding,
    verifierIdentity: claim.verifierIdentity,
    claimScope: claim.claimScope,
    claimStatus: claim.claimStatus,
    approvalRequirement: claim.approvalRequirement,
  });
  const approval = {
    ok: true,
    packetType: 'aios.operator.approval',
    route: 'test-route',
    operatorRequest: {
      operatorScope: {
        tenantId: 'test',
        role: 'approver',
        operator: 'test-approver',
        roleAcceptedForCommand: true,
      },
    },
    generatedAt: new Date(Date.now() - 1_000).toISOString(),
    artifactRoot,
    tenantBoundary,
    providerContract: {},
    subject: claim.subject,
    decision: 'approve',
    reason: 'explicit test approval',
    approver: 'test-approver',
  };
  approval.approvalHash = digestJson({
    packetType: approval.packetType,
    route: approval.route,
    operatorRequest: approval.operatorRequest,
    tenantBoundary,
    providerContract: approval.providerContract,
    subject: approval.subject,
    decision: approval.decision,
    reason: approval.reason,
    approver: approval.approver,
  });
  try {
    fs.writeFileSync(path.join(packets, 'completion-claim.packet.json'), `${JSON.stringify(claim, null, 2)}\n`);
    fs.writeFileSync(path.join(packets, 'operator-approval.packet.json'), `${JSON.stringify(approval, null, 2)}\n`);
    assert.equal(validatePromotionApproval({ smoke: { artifactRoot } }).ok, true);

    approval.subject = 'claim:other';
    fs.writeFileSync(path.join(packets, 'operator-approval.packet.json'), `${JSON.stringify(approval, null, 2)}\n`);
    const mismatch = validatePromotionApproval({ smoke: { artifactRoot } });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.checks.find((entry) => entry.name === 'approval_subject_matches_claim').ok, false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('reviewed provider policy reports POST effects and rejects arbitrary unpinned routes', async () => {
  const trust = providerPolicyTrust(providerPolicy);
  assert.equal(trust.trusted, true);
  const access = buildProviderAccessContract({
    policy: providerPolicy,
    capabilities: [{ name: 'provider.cortex.read', scope: 'read', boundary: 'external' }],
    syscalls: [{ op: 'provider.read', args: { provider: 'cortex' } }],
  });
  assert.equal(access.ok, true);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-provider-effect-'));
  let request = null;
  try {
    const receipt = await executeCapabilityGatedProviderOperation({
      policy: providerPolicy,
      access,
      op: 'provider.read',
      args: { provider: 'cortex', query: 'bounded' },
      artifactRoot: temporary,
      processId: 'effect-test',
      ordinal: 1,
      fetchImpl: async (url, init) => {
        request = { url: String(url), method: init.method, body: init.body };
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
          arrayBuffer: async () => Buffer.from('{"results":[]}'),
        };
      },
    });
    assert.deepEqual(request, {
      url: 'http://127.0.0.1:8000/knowledge/search',
      method: 'POST',
      body: '{"query":"bounded"}',
    });
    assert.equal(receipt.externalWrites, true);
    assert.equal(receipt.externalTransportEffect, 'network-post');
    assert.equal(receipt.resultStorageExternalWrites, false);
    assert.equal(receipt.remoteSideEffects, 'not_observable');

    const arbitrary = normalizeProviderPolicy({
      schemaVersion: 'aios.provider-read-compute-policy.v1',
      enabled: true,
      providers: {
        arbitrary: {
          enabled: true,
          transport: 'http-json',
          baseUrl: 'https://example.invalid',
          operations: { read: { enabled: true, capability: 'provider.arbitrary.read', method: 'POST', path: '/mutate' } },
        },
      },
    });
    const arbitraryAccess = buildProviderAccessContract({
      policy: arbitrary,
      capabilities: [{ name: 'provider.arbitrary.read', scope: 'read', boundary: 'external' }],
      syscalls: [{ op: 'provider.read', args: { provider: 'arbitrary' } }],
    });
    assert.equal(arbitraryAccess.ok, false);
    assert.ok(arbitraryAccess.violations.some((entry) => entry.code === 'AIOS_PROVIDER_POLICY_NOT_TRUSTED'));
    await assert.rejects(
      executeCapabilityGatedProviderOperation({
        policy: arbitrary,
        access: arbitraryAccess,
        op: 'provider.read',
        args: { provider: 'arbitrary', query: 'could mutate' },
        artifactRoot: temporary,
        processId: 'blocked-test',
        ordinal: 2,
        fetchImpl: async () => { throw new Error('must not be called'); },
      }),
      (error) => error.code === 'AIOS_PROVIDER_POLICY_NOT_TRUSTED',
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
