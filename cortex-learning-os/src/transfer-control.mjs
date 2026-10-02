#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  TRANSFER_ENTRY_SCHEMA,
  atomicWriteSignedTransferRegistry,
  initializeTransferRegistry,
  loadSignedTransferRegistry,
  readTransferRegistrySecret,
  verifyTransferRegistry,
} from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';
import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { loadAdaptivePolicy } from './adaptive-policy.mjs';
import { readJson } from './json.mjs';
import { readMasterySecret, verifyMasteryState } from './mastery-state.mjs';
import { CLOS_ROOT } from './paths.mjs';
import {
  DEFAULT_TRANSFER_RUNTIME,
  buildTransferQualificationPlan,
  replayTransferQualification,
} from './transfer-qualification.mjs';
import { loadAllTransferProfiles, loadTransferProfile } from './transfer-profiles.mjs';
import {
  applyTransferQualification,
  atomicWriteTransferState,
  initializeTransferStore,
  readTransferStateSecret,
  setTransferProfileState,
  verifyTransferState,
} from './transfer-state.mjs';
import { generateTransferTasks } from './transfer-tasks.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const stateRoot = path.resolve(value('--state-root', path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-learning-os')));
const transferStatePath = path.resolve(value('--transfer-state', path.join(stateRoot, 'transfer-state.json')));
const transferSecretPath = path.resolve(value('--transfer-secret', path.join(stateRoot, 'transfer-state.hmac')));
const transferRegistryPath = path.resolve(value('--transfer-registry', path.join(stateRoot, 'transfer-registry.json')));
const transferRegistrySecretPath = path.resolve(value('--transfer-registry-secret', path.join(stateRoot, 'transfer-registry.hmac')));
const transferTelemetryPath = path.resolve(value('--transfer-telemetry', path.join(stateRoot, 'transfer-telemetry.json')));
const masteryPath = path.resolve(value('--mastery', path.join(stateRoot, 'mastery.json')));
const masterySecretPath = path.resolve(value('--mastery-secret', path.join(stateRoot, 'mastery.hmac')));

function fail(error) {
  console.error(JSON.stringify({ ok: false, command, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
}

function inputs() {
  const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
  const policy = readJson(path.join(CLOS_ROOT, 'policies/coding-transfer-v0.9.json'));
  const profiles = loadAllTransferProfiles({ graph });
  return { graph, policy, profiles };
}

function existingTransferStore(common) {
  const secret = readTransferStateSecret(transferSecretPath);
  const state = JSON.parse(fs.readFileSync(transferStatePath, 'utf8'));
  const verification = verifyTransferState(state, secret, common);
  if (!verification.ok) throw new Error(`transfer state verification failed: ${verification.errors.join('; ')}`);
  return { state, secret };
}

function profileFor(valueId, common) {
  const profile = loadTransferProfile(valueId, { graph: common.graph });
  if (!common.profiles.some((row) => row.profileId === profile.profileId)) throw new Error('profile is not declared');
  return profile;
}

function sameProfileMatcherContract(entry, profile) {
  return entry.profileId === profile.profileId && entry.matcherId === profile.semanticMatcherId;
}

function contentFreeTransferStatus() {
  try {
    const telemetry = JSON.parse(fs.readFileSync(transferTelemetryPath, 'utf8'));
    return {
      observed: Number(telemetry?.counters?.observed || 0),
      shadowSelected: Number(telemetry?.counters?.shadowSelected || 0),
      activeApplied: Number(telemetry?.counters?.applied || 0),
      reasonCounts: telemetry?.reasonCounts && typeof telemetry.reasonCounts === 'object' ? telemetry.reasonCounts : {},
    };
  } catch {
    return { observed: 0, shadowSelected: 0, activeApplied: 0, reasonCounts: {} };
  }
}

function masteryStatus() {
  if (!fs.existsSync(masteryPath) || !fs.existsSync(masterySecretPath)) return { initialized: false, claim: 'not-inspected' };
  const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
  const { policy } = loadAdaptivePolicy();
  const state = JSON.parse(fs.readFileSync(masteryPath, 'utf8'));
  const verification = verifyMasteryState(state, readMasterySecret(masterySecretPath), { graph, policy });
  const counts = {};
  for (const item of Object.values(state.concepts || {})) counts[item.state] = Number(counts[item.state] || 0) + 1;
  return { initialized: true, signatureValid: verification.ok, revision: state.revision, counts, claim: 'mathematical-mastery-state-only' };
}

function registryStatus() {
  if (!fs.existsSync(transferRegistryPath) || !fs.existsSync(transferRegistrySecretPath)) return { initialized: false, qualifiedEntries: 0, activeEntries: 0 };
  const secret = readTransferRegistrySecret(transferRegistrySecretPath);
  const registry = loadSignedTransferRegistry(transferRegistryPath, secret, { allowExpiredEntries: true });
  const now = Date.now();
  const qualified = registry.entries.filter((entry) => entry.qualificationState === 'qualified');
  return {
    initialized: true,
    signatureValid: true,
    revision: registry.revision,
    enabled: registry.enabled,
    qualifiedEntries: qualified.length,
    proposalEntries: registry.entries.length - qualified.length,
    activeEntries: registry.enabled ? qualified.filter((entry) => entry.enabled && Date.parse(entry.expiresAt) > now).length : 0,
    entries: registry.entries.map((entry) => ({
      entryId: entry.entryId,
      profileId: entry.profileId,
      matcherId: entry.matcherId,
      qualificationState: entry.qualificationState,
      activationBasis: entry.activationBasis || (entry.qualificationState === 'qualified' ? 'independent_qualification' : null),
      enabled: entry.enabled,
      expiresAt: entry.expiresAt,
      evidenceDigest: entry.evidenceDigest,
    })),
  };
}

function status(common) {
  let transfer = { initialized: false, counts: {}, claim: 'No signed coding-transfer state exists.' };
  if (fs.existsSync(transferStatePath) && fs.existsSync(transferSecretPath)) {
    const { state } = existingTransferStore(common);
    const counts = {};
    const effectiveCounts = {};
    for (const item of Object.values(state.concepts)) {
      counts[item.state] = Number(counts[item.state] || 0) + 1;
      const effective = item.state === 'qualified' && item.expiresAt && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : item.state;
      effectiveCounts[effective] = Number(effectiveCounts[effective] || 0) + 1;
    }
    transfer = {
      initialized: true,
      signatureValid: true,
      revision: state.revision,
      counts,
      effectiveCounts,
      appliedRunReceipts: state.appliedRunReceipts.map((row) => ({ ...row })),
    };
  }
  const qualifiedReceipts = (transfer.appliedRunReceipts || []).filter((row) => row.outcome === 'qualified');
  return {
    ok: true,
    command,
    truthLayers: {
      mathematicalMastery: masteryStatus(),
      codingTransferState: transfer,
      transferRegistryQualificationActivation: registryStatus(),
      transferRuntimeObservations: contentFreeTransferStatus(),
      empiricalTransferBenefit: {
        measured: qualifiedReceipts.length > 0,
        qualifiedRunCount: qualifiedReceipts.length,
        claim: qualifiedReceipts.length
          ? 'One or more bounded paired qualification runs passed their exact declared gates; this is not broad coding benefit.'
          : 'No bounded transfer qualification run has passed, so no empirical transfer-benefit claim exists.',
      },
    },
  };
}

function entryFromQualifiedState(profile, state) {
  const records = profile.mathConceptIds.map((conceptId) => state.concepts[conceptId]);
  if (records.some((record) => record.state !== 'qualified')
      || new Set(records.map((record) => record.qualificationRunId)).size !== 1
      || new Set(records.map((record) => record.artifactManifestDigest)).size !== 1
      || new Set(records.map((record) => record.evidenceDigest)).size !== 1) throw new Error('profile does not have a coherent qualified transfer state');
  const record = records[0];
  if (Date.parse(record.expiresAt) <= Date.now()) throw new Error('qualified transfer state is expired');
  return {
    schemaVersion: TRANSFER_ENTRY_SCHEMA,
    entryId: `transfer_${profile.profileId}_${record.evidenceDigest.slice(0, 20)}`,
    profileId: profile.profileId,
    profileVersion: profile.version,
    conceptIds: [...profile.mathConceptIds],
    matcherId: profile.semanticMatcherId,
    enabled: true,
    qualificationState: 'qualified',
    qualificationRunId: record.qualificationRunId,
    artifactManifestDigest: record.artifactManifestDigest,
    evidenceDigest: record.evidenceDigest,
    profileDigest: profile.source.profileDigest,
    qualifiedAt: record.qualifiedAt,
    expiresAt: record.expiresAt,
    allowedAgentIds: ['main'],
    context: {
      applicabilityReason: profile.activationConditions.join(', '),
      assumptions: profile.requiredAssumptions.map(({ code, description }) => ({ code, description })),
      contraindications: profile.contraindications.map(({ code, description }) => `${code}: ${description}`),
      computationalFormulation: profile.computationalFormulation,
      implementationPatterns: [...profile.implementationPatterns],
      verificationOracle: `${profile.verification.oracleId}: ${profile.verification.strategy}`,
      complexityRisk: profile.risks.complexity,
      numericalRisk: profile.risks.numerical,
      truthBoundary: profile.truthBoundary,
    },
  };
}

try {
  const common = inputs();
  if (command === 'init') {
    const transfer = initializeTransferStore({
      statePath: transferStatePath,
      secretPath: transferSecretPath,
      ...common,
    });
    const registry = initializeTransferRegistry({
      registryPath: transferRegistryPath,
      secretPath: transferRegistrySecretPath,
    });
    console.log(JSON.stringify({
      ok: true,
      command,
      transferRevision: transfer.state.revision,
      concepts: Object.keys(transfer.state.concepts).length,
      declaredUnassessed: Object.values(transfer.state.concepts).filter((row) => row.state === 'unassessed').length,
      explicitNoQualifiedTransfer: Object.values(transfer.state.concepts).filter((row) => row.state === 'no_qualified_transfer').length,
      registryRevision: registry.registry.revision,
      qualifiedEntries: registry.registry.entries.filter((entry) => entry.qualificationState === 'qualified').length,
      proposalEntries: registry.registry.entries.filter((entry) => entry.qualificationState !== 'qualified').length,
    }, null, 2));
  } else if (command === 'status') {
    console.log(JSON.stringify(status(common), null, 2));
  } else if (command === 'verify') {
    const transfer = existingTransferStore(common);
    const transferVerification = verifyTransferState(transfer.state, transfer.secret, common);
    const registrySecret = readTransferRegistrySecret(transferRegistrySecretPath);
    const registry = JSON.parse(fs.readFileSync(transferRegistryPath, 'utf8'));
    const registryVerification = verifyTransferRegistry(registry, registrySecret, { allowExpiredEntries: true });
    console.log(JSON.stringify({ ok: transferVerification.ok && registryVerification.ok, command, transferState: transferVerification, transferRegistry: registryVerification }, null, 2));
    if (!transferVerification.ok || !registryVerification.ok) process.exitCode = 1;
  } else if (command === 'plan') {
    const profileId = value('--profile');
    const runId = value('--run-id');
    const out = path.resolve(value('--out'));
    const profile = profileFor(profileId, common);
    const runtime = {
      ...DEFAULT_TRANSFER_RUNTIME,
      model: value('--model', DEFAULT_TRANSFER_RUNTIME.model),
      reasoningEffort: value('--reasoning', DEFAULT_TRANSFER_RUNTIME.reasoningEffort),
    };
    const { secret } = existingTransferStore(common);
    const tasks = generateTransferTasks(profile, { seed: runId });
    const plan = buildTransferQualificationPlan({
      runId,
      profile,
      policy: common.policy,
      tasks,
      sourceCommit: profile.source.baseCommit,
      signingSecret: secret,
      runtime,
    });
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    fs.chmodSync(out, 0o700);
    fs.writeFileSync(path.join(out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(out, 'tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, command, runId, profileId, runtime, taskCount: tasks.length, planDigest: plan.controlPlaneSignature.digest, inert: true }, null, 2));
  } else if (command === 'apply') {
    const artifactRoot = path.resolve(value('--artifacts'));
    const { state, secret } = existingTransferStore(common);
    const plan = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'plan.json'), 'utf8'));
    const profile = profileFor(plan.profileId, common);
    const tasks = generateTransferTasks(profile, { seed: plan.runId });
    const report = replayTransferQualification({
      artifactRoot,
      profile,
      policy: common.policy,
      tasks,
      signingSecret: secret,
    });
    const next = applyTransferQualification({ state, report, profile, ...common });
    const signed = atomicWriteTransferState(transferStatePath, next, secret, common);
    const reportRoot = path.join(stateRoot, 'transfer-reports');
    fs.mkdirSync(reportRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(reportRoot, 0o700);
    const reportPath = path.join(reportRoot, `${report.runId}.json`);
    if (fs.existsSync(reportPath) && canonicalJson(JSON.parse(fs.readFileSync(reportPath, 'utf8'))) !== canonicalJson(report)) throw new Error('transfer report substitution under reused run ID');
    if (!fs.existsSync(reportPath)) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, command, runId: report.runId, outcome: report.outcome, transferRevision: signed.revision, liveRegistryChanged: false, reportPath }, null, 2));
  } else if (command === 'promote') {
    const profile = profileFor(value('--profile'), common);
    const { state } = existingTransferStore(common);
    const entry = entryFromQualifiedState(profile, state);
    const { registry, secret } = initializeTransferRegistry({ registryPath: transferRegistryPath, secretPath: transferRegistrySecretPath });
    const entries = [
      ...registry.entries.filter((row) => !sameProfileMatcherContract(row, profile)),
      entry,
    ].sort((a, b) => a.profileId.localeCompare(b.profileId) || a.matcherId.localeCompare(b.matcherId));
    const signed = atomicWriteSignedTransferRegistry(transferRegistryPath, {
      ...registry,
      revision: registry.revision + 1,
      updatedAt: new Date().toISOString(),
      entries,
    }, secret);
    console.log(JSON.stringify({ ok: true, command, profileId: profile.profileId, entryId: entry.entryId, registryRevision: signed.revision }, null, 2));
  } else if (['enable', 'disable'].includes(command)) {
    const profile = profileFor(value('--profile'), common);
    const profileId = profile.profileId;
    const secret = readTransferRegistrySecret(transferRegistrySecretPath);
    const registry = loadSignedTransferRegistry(transferRegistryPath, secret, { allowExpiredEntries: true });
    if (!registry.entries.some((entry) => sameProfileMatcherContract(entry, profile))) throw new Error('transfer registry profile/matcher contract not found');
    const entries = registry.entries.map((entry) => sameProfileMatcherContract(entry, profile) ? { ...entry, enabled: command === 'enable' } : entry);
    const signed = atomicWriteSignedTransferRegistry(transferRegistryPath, { ...registry, revision: registry.revision + 1, updatedAt: new Date().toISOString(), entries }, secret);
    console.log(JSON.stringify({ ok: true, command, profileId, registryRevision: signed.revision }, null, 2));
  } else if (['registry-enable', 'registry-disable'].includes(command)) {
    const secret = readTransferRegistrySecret(transferRegistrySecretPath);
    const registry = loadSignedTransferRegistry(transferRegistryPath, secret, { allowExpiredEntries: true });
    const signed = atomicWriteSignedTransferRegistry(transferRegistryPath, {
      ...registry,
      revision: registry.revision + 1,
      updatedAt: new Date().toISOString(),
      enabled: command === 'registry-enable',
    }, secret);
    console.log(JSON.stringify({ ok: true, command, enabled: signed.enabled, registryRevision: signed.revision }, null, 2));
  } else if (['revoke', 'expire'].includes(command)) {
    const profile = profileFor(value('--profile'), common);
    const currentStore = existingTransferStore(common);
    if (command === 'expire') {
      const expiries = profile.mathConceptIds.map((conceptId) => currentStore.state.concepts[conceptId].expiresAt);
      if (expiries.some((expiry) => !expiry || Date.parse(expiry) > Date.now())) throw new Error('profile qualification has not expired');
    }
    if (fs.existsSync(transferRegistryPath)) {
      const registrySecret = readTransferRegistrySecret(transferRegistrySecretPath);
      const registry = loadSignedTransferRegistry(transferRegistryPath, registrySecret, { allowExpiredEntries: true });
      const entries = registry.entries.map((entry) => sameProfileMatcherContract(entry, profile) ? { ...entry, enabled: false } : entry);
      atomicWriteSignedTransferRegistry(transferRegistryPath, { ...registry, revision: registry.revision + 1, updatedAt: new Date().toISOString(), entries }, registrySecret);
    }
    const nextState = command === 'expire' ? 'expired' : 'revoked';
    const reasonCode = command === 'expire' ? 'qualification-expired' : 'operator-revoked';
    const next = setTransferProfileState({ state: currentStore.state, profile, nextState, reasonCode });
    const signed = atomicWriteTransferState(transferStatePath, next, currentStore.secret, common);
    console.log(JSON.stringify({ ok: true, command, profileId: profile.profileId, transferRevision: signed.revision, registryEntryDisabled: true }, null, 2));
  } else if (command === 'registry') {
    console.log(JSON.stringify({ ok: true, command, registry: registryStatus() }, null, 2));
  } else {
    throw new Error(`unknown transfer command: ${command}`);
  }
} catch (error) {
  fail(error);
}
