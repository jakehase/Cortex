#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildAcquisitionStatus } from './acquisition-status.mjs';
import { deploymentBindingDigest } from './deployment-identity.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { readMasterySecret, verifyMasteryState } from './mastery-state.mjs';
import { validateIndependentAssessmentBank } from './phd-assessment.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  loadSignedTransferRegistry,
  readTransferRegistrySecret,
} from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';

const SCHEMA = 'cortex.learning_os.continuous_math_phase0_audit.v1';
const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const has = (flag) => args.includes(flag);
const now = value('--evaluated-at', new Date().toISOString());
if (!Number.isFinite(Date.parse(now))) throw new Error('--evaluated-at is invalid');
const stateRoot = path.resolve(value('--state-root', path.join(process.env.HOME || '/root', '.openclaw/cortex-learning-os')));
const artifactRootValue = value('--artifact-root');
if (!artifactRootValue) throw new Error('--artifact-root is required');
const artifactRoot = path.resolve(artifactRootValue);
const livePluginRoot = path.resolve(value('--live-plugin-root', '/root/clawd/plugins/cortex-learning-os-live'));
const remoteHost = value('--remote-host', 'jake@37.27.129.239');
const remoteRoot = value('--remote-root', '/home/jake/clawd-remote/cortex-learning-os');
const remoteCodex = value('--remote-codex', '/home/jake/.local/bin/codex');
const cohortSize = Number(value('--cohort-size', '24'));
if (!Number.isSafeInteger(cohortSize) || cohortSize < 1 || cohortSize > 100) throw new Error('--cohort-size must be 1..100');

function regularFile(target, label, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds size limit`);
  return stat;
}

function readJson(target, label = path.basename(target)) {
  regularFile(target, label);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function writeJson(name, record) {
  const target = path.join(artifactRoot, name);
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.[field] ?? 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizedErrorFamilies(errors) {
  const families = new Set();
  for (const error of errors || []) {
    const text = String(error).replace(/^[^:]+:\s*/, '');
    if (text.includes('trust, deployment, or campaign binding mismatch')) families.add('trust_deployment_or_campaign_binding_mismatch');
    else if (text.includes('attestation is invalid')) families.add('authority_attestation_invalid');
    else if (text.includes('digest mismatch')) families.add('digest_mismatch');
    else if (text.includes('graph, outcome, stage, or track binding mismatch')) families.add('curriculum_or_rubric_binding_mismatch');
    else families.add(text.slice(0, 180));
  }
  return [...families].sort();
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is forbidden in audited tree: ${target}`);
      if (entry.isDirectory()) walk(target, rel);
      else if (entry.isFile()) rows.push({ relativePath: rel, path: target });
      else throw new Error(`non-regular audited entry: ${target}`);
      if (rows.length > 10_000) throw new Error(`audited tree file count exceeded: ${root}`);
    }
  };
  walk(root);
  return rows;
}

function comparePluginTrees(sourceRoot, deployedRoot) {
  const source = listFiles(sourceRoot);
  const deployed = new Map(listFiles(deployedRoot).map((row) => [row.relativePath, row.path]));
  const files = source.map((row) => {
    const deployedPath = deployed.get(row.relativePath) || null;
    const sourceSha256 = sha256File(row.path);
    const deployedSha256 = deployedPath ? sha256File(deployedPath) : null;
    return {
      path: row.relativePath,
      sourceSha256,
      deployedSha256,
      matches: sourceSha256 === deployedSha256,
    };
  });
  const sourceNames = new Set(source.map((row) => row.relativePath));
  const extraDeployedFiles = [...deployed.keys()].filter((name) => !sourceNames.has(name)).sort();
  return {
    sourceRoot,
    deployedRoot,
    files,
    extraDeployedFiles,
    exact: files.length > 0 && files.every((row) => row.matches) && extraDeployedFiles.length === 0,
  };
}

function remoteProbe(command) {
  if (!/^[A-Za-z0-9._@-]+$/.test(remoteHost)) throw new Error('unsafe --remote-host');
  for (const candidate of [remoteRoot, remoteCodex]) {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(candidate) || candidate.includes('..')) throw new Error('unsafe remote path');
  }
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', remoteHost, command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

function selectDiverse(rows, limit) {
  const remaining = [...rows];
  const selected = [];
  const stageCounts = new Map();
  const trackCounts = new Map();
  while (selected.length < limit && remaining.length) {
    remaining.sort((left, right) => {
      const score = (row) => {
        const unseenStage = (stageCounts.get(row.stage) || 0) === 0 ? 1000 : 0;
        const unseenTracks = row.tracks.filter((track) => (trackCounts.get(track) || 0) === 0).length * 100;
        const balance = row.tracks.reduce((sum, track) => sum - (trackCounts.get(track) || 0), 0);
        return unseenStage + unseenTracks + balance;
      };
      return score(right) - score(left) || left.ordinal - right.ordinal;
    });
    const chosen = remaining.shift();
    selected.push(chosen);
    stageCounts.set(chosen.stage, (stageCounts.get(chosen.stage) || 0) + 1);
    for (const track of chosen.tracks) trackCounts.set(track, (trackCounts.get(track) || 0) + 1);
  }
  return selected;
}

function stagePlain(stage) {
  return ({
    proof_foundations: 'advanced undergraduate proof foundations',
    undergraduate_core: 'undergraduate core mathematics',
    graduate_core: 'first-year graduate mathematics',
    qualifying: 'PhD qualifying-exam level',
    specialization: 'graduate specialization',
    research: 'research-practice level',
  })[stage] || stage;
}

if (fs.existsSync(artifactRoot)) {
  const stat = fs.lstatSync(artifactRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(artifactRoot).length !== 0) {
    throw new Error('--artifact-root must be absent or an empty regular directory');
  }
} else {
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
}
fs.chmodSync(artifactRoot, 0o700);

const identity = currentCommittedIdentity({ requireClean: true });
const program = loadCanonicalPhdProgram({
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  productTree: identity.productTree,
});
const currentDeploymentDigest = deploymentBindingDigest(program.deployment);

const masteryPath = path.join(stateRoot, 'mastery.json');
const masterySecretPath = path.join(stateRoot, 'mastery.hmac');
const mastery = readJson(masteryPath, 'mastery state');
const masterySecret = readMasterySecret(masterySecretPath);
const masteryVerification = verifyMasteryState(mastery, masterySecret, {
  graph: program.graph,
  policy: program.acquisitionPolicy,
});
const acquisitionStatus = masteryVerification.ok
  ? buildAcquisitionStatus({ state: mastery, graph: program.graph })
  : null;

const bankRoot = path.join(stateRoot, 'assessment-banks');
const bankFiles = fs.existsSync(bankRoot)
  ? listFiles(bankRoot).filter((row) => row.relativePath.endsWith('.json'))
  : [];
const banks = bankFiles.map((row) => {
  const bank = readJson(row.path, `assessment bank ${row.relativePath}`);
  const validation = validateIndependentAssessmentBank(bank, {
    graph: program.graph,
    rubric: program.rubric,
    trustPolicy: program.trustPolicy,
    deployment: program.deployment,
    campaignBinding: bank?.bindings?.campaign,
  });
  const conceptIds = [...new Set((bank.items || []).map((item) => item.conceptId))].sort();
  return {
    path: row.path,
    record: bank,
    summary: {
      bankId: bank.bankId || null,
      purpose: bank.purpose || null,
      fixtureOnly: bank.fixtureOnly,
      assessmentClass: bank.assessmentClass || null,
      itemCount: Array.isArray(bank.items) ? bank.items.length : 0,
      conceptCount: conceptIds.length,
      conceptIds,
      roleCounts: countBy(bank.items || [], 'assessmentRole'),
      stageCounts: countBy(bank.items || [], 'stage'),
      bankDigest: bank.bankDigest || null,
      boundDeploymentDigest: bank.bindings?.deploymentDigest || null,
      currentDeploymentDigest,
      validForCurrentDeployment: validation.ok,
      errorCount: validation.errors.length,
      errorFamilies: normalizedErrorFamilies(validation.errors),
      authorAuthorityId: bank.authorAttestation?.authorityId || null,
      reviewerAuthorityId: bank.reviewerAttestation?.authorityId || null,
      truthBoundary: bank.truthBoundary || null,
    },
  };
});

const transferRegistryPath = path.join(stateRoot, 'transfer-registry.json');
const transferRegistrySecretPath = path.join(stateRoot, 'transfer-registry.hmac');
const transferRegistry = loadSignedTransferRegistry(
  transferRegistryPath,
  readTransferRegistrySecret(transferRegistrySecretPath),
  { allowExpiredEntries: true },
);
const transferEntriesByConcept = new Map();
for (const entry of transferRegistry.entries) {
  for (const conceptId of entry.conceptIds || []) {
    const values = transferEntriesByConcept.get(conceptId) || [];
    values.push(entry);
    transferEntriesByConcept.set(conceptId, values);
  }
}

const telemetryPath = path.join(stateRoot, 'transfer-telemetry.json');
const telemetry = fs.existsSync(telemetryPath) ? readJson(telemetryPath, 'transfer telemetry') : null;
const profileActivations = new Map();
for (const record of telemetry?.records || []) {
  for (const profileId of record.profileIds || []) {
    profileActivations.set(profileId, (profileActivations.get(profileId) || 0) + 1);
  }
}

const mappingByConcept = new Map(program.rubric.conceptMappings.map((row) => [row.conceptId, row]));
const currentValidBankConcepts = new Map();
for (const bank of banks.filter((row) => row.summary.validForCurrentDeployment)) {
  for (const item of bank.record.items || []) {
    const key = `${bank.record.purpose}:${item.conceptId}`;
    const values = currentValidBankConcepts.get(key) || [];
    values.push({ bankId: bank.record.bankId, role: item.assessmentRole, itemId: item.itemId });
    currentValidBankConcepts.set(key, values);
  }
}

const matrixRows = program.graph.concepts.map((concept, index) => {
  const mapping = mappingByConcept.get(concept.conceptId);
  const state = mastery.concepts?.[concept.conceptId] || null;
  const entries = transferEntriesByConcept.get(concept.conceptId) || [];
  const activationCount = entries.reduce((sum, entry) => sum + (profileActivations.get(entry.profileId) || 0), 0);
  const acquisitionItems = currentValidBankConcepts.get(`acquisition:${concept.conceptId}`) || [];
  const retentionItems = currentValidBankConcepts.get(`retention:${concept.conceptId}`) || [];
  const operatorAvailable = entries.some((entry) => entry.enabled === true
    && entry.qualificationState === 'operator_enabled'
    && entry.activationBasis === 'operator_direct');
  return {
    ordinal: index + 1,
    conceptId: concept.conceptId,
    title: concept.title,
    category: concept.category,
    stage: mapping?.stage || null,
    approximateDifficulty: stagePlain(mapping?.stage),
    tracks: mapping?.tracks || [],
    prerequisites: concept.prerequisites,
    acquisition: {
      state: state?.state || 'missing',
      attempts: state?.attempts ?? null,
      passes: state?.passes ?? null,
      failures: state?.failures ?? null,
      acquiredAt: state?.acquiredAt || null,
      evidenceDigest: state?.lastEvidenceDigest || null,
      runId: state?.lastRunId || null,
      currentDeploymentAssessmentItems: acquisitionItems.length,
    },
    validity: { state: 'not_started', evidenceDigest: null },
    retention: {
      r7: 'not_started',
      r30: 'not_started',
      r90: 'not_started',
      currentDeploymentAssessmentItems: retentionItems.length,
    },
    transfer: {
      profileIds: entries.map((entry) => entry.profileId).sort(),
      entryCount: entries.length,
      operatorAvailable,
      qualificationStates: [...new Set(entries.map((entry) => entry.qualificationState))].sort(),
      activationBases: [...new Set(entries.map((entry) => entry.activationBasis))].sort(),
    },
    utility: {
      state: 'not_evaluated',
      observedContentFreeActivations: activationCount,
    },
    everydayTier: operatorAvailable ? 'operator_available' : 'not_available',
    allowedClaim: state?.state === 'acquired' ? 'acquired_once' : 'unassessed_or_learning',
    disallowedClaims: ['validity_confirmed', 'retained', 'utility_qualified', 'model_weight_learning'],
  };
});

const aggregate = {
  total: matrixRows.length,
  unassessed: matrixRows.filter((row) => row.acquisition.state === 'unassessed').length,
  learning: matrixRows.filter((row) => ['learning', 'blocked_prerequisite'].includes(row.acquisition.state)).length,
  acquiredOnce: matrixRows.filter((row) => row.acquisition.state === 'acquired').length,
  validityConfirmed: 0,
  retentionR7: 0,
  retentionR30: 0,
  retentionR90: 0,
  utilityCandidates: 0,
  utilityQualified: 0,
  everydayPreferred: 0,
  operatorAvailable: matrixRows.filter((row) => row.everydayTier === 'operator_available').length,
  blocked: 0,
};

const validityPool = matrixRows.filter((row) => row.acquisition.state === 'acquired');
const validityCohort = selectDiverse(validityPool, cohortSize);
const acquisitionFrontier = new Set(acquisitionStatus?.frontier?.conceptIds || []);
const acquisitionCohort = selectDiverse(
  matrixRows.filter((row) => acquisitionFrontier.has(row.conceptId)
    && row.acquisition.currentDeploymentAssessmentItems > 0),
  cohortSize,
);
const utilityCohort = matrixRows
  .filter((row) => row.utility.observedContentFreeActivations > 0)
  .sort((a, b) => b.utility.observedContentFreeActivations - a.utility.observedContentFreeActivations || a.ordinal - b.ordinal)
  .slice(0, 8);

const pluginComparison = comparePluginTrees(
  path.resolve(CLOS_ROOT, '../plugins/cortex-learning-os-live'),
  livePluginRoot,
);
const remoteReadiness = has('--skip-remote')
  ? { checked: false, workspacePresent: null, codexPresent: null, ready: null }
  : {
    checked: true,
    workspacePresent: remoteProbe(`test -d ${remoteRoot}`),
    codexPresent: remoteProbe(`test -x ${remoteCodex}`),
  };
if (remoteReadiness.checked) remoteReadiness.ready = remoteReadiness.workspacePresent && remoteReadiness.codexPresent;

const retentionPaths = {
  status: path.join(stateRoot, 'phd/retention-status.json'),
  windows: path.join(stateRoot, 'phd/retention-windows.json'),
  banks: path.join(stateRoot, 'phd/retention-banks.json'),
};
const retentionFiles = Object.fromEntries(Object.entries(retentionPaths).map(([key, target]) => [key, {
  path: target,
  exists: fs.existsSync(target),
  sha256: fs.existsSync(target) ? sha256File(target) : null,
}]));

const readinessBlockers = [];
if (!program.ok || !program.productionTrustReady) readinessBlockers.push('canonical_program_or_production_trust_not_ready');
if (!masteryVerification.ok) readinessBlockers.push('signed_mastery_state_invalid');
if (matrixRows.length !== 264) readinessBlockers.push('curriculum_surface_matrix_not_264');
if (!pluginComparison.exact) readinessBlockers.push('live_plugin_source_drift');
if (remoteReadiness.checked && !remoteReadiness.ready) readinessBlockers.push('remote_execution_boundary_not_ready');
if ((acquisitionStatus?.frontier?.count || 0) === 0) readinessBlockers.push('current_264_concept_curriculum_frontier_exhausted');
if (!banks.some((row) => row.summary.purpose === 'acquisition' && row.summary.validForCurrentDeployment)) {
  readinessBlockers.push('current_deployment_independent_acquisition_bank_missing');
}
if (!banks.some((row) => row.summary.purpose === 'retention' && row.summary.validForCurrentDeployment)) {
  readinessBlockers.push('current_deployment_independent_retention_banks_missing');
}
readinessBlockers.push('independent_validity_bank_not_implemented');
if (utilityCohort.length === 0) readinessBlockers.push('no_matched_everyday_activation_evidence_since_telemetry_window');

const integrityBlockers = [];
if (!masteryVerification.ok) integrityBlockers.push(...masteryVerification.errors.map((error) => `mastery:${error}`));
if (matrixRows.length !== 264) integrityBlockers.push(`matrix:expected_264_observed_${matrixRows.length}`);
if (transferRegistry.entries.length !== 264 || transferEntriesByConcept.size !== 264) {
  integrityBlockers.push(`transfer_registry:expected_264_entries_and_concepts_observed_${transferRegistry.entries.length}_${transferEntriesByConcept.size}`);
}
if (!pluginComparison.exact) integrityBlockers.push('live_plugin:source_drift');

const runId = path.basename(artifactRoot);
const contract = {
  schemaVersion: SCHEMA,
  runId,
  evaluatedAt: now,
  objective: 'Read-only Phase-0 live truth audit for continuous mathematics acquisition, validity, retention, and everyday utility.',
  fidelity: 'production_read_only_audit',
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  productTree: identity.productTree,
  stateRoot,
  noModelCalls: true,
  noCanonicalMutation: true,
  stopCondition: 'phase_0_live_truth_audit_complete_or_precise_integrity_blocker',
};
const sourceFreeze = {
  schemaVersion: 'cortex.learning_os.continuous_math_source_freeze.v1',
  evaluatedAt: now,
  ...identity,
  canonicalProgramOk: program.ok,
  productionTrustReady: program.productionTrustReady,
  currentDeploymentDigest,
  pluginComparison,
};
const liveStateSnapshot = {
  schemaVersion: 'cortex.learning_os.continuous_math_live_state_snapshot.v1',
  evaluatedAt: now,
  acquisition: {
    signatureValid: masteryVerification.ok,
    signatureErrors: masteryVerification.errors,
    revision: mastery.revision,
    updatedAt: mastery.updatedAt,
    stateDigest: sha256Text(canonicalJson(mastery)),
    appliedRunCount: mastery.appliedRunIds?.length || 0,
    pendingRepairCount: mastery.pendingRepairs?.length || 0,
    status: acquisitionStatus,
  },
  transfer: {
    signatureValid: true,
    revision: transferRegistry.revision,
    enabled: transferRegistry.enabled,
    updatedAt: transferRegistry.updatedAt,
    entryCount: transferRegistry.entries.length,
    uniqueConceptCount: transferEntriesByConcept.size,
    qualificationStates: countBy(transferRegistry.entries, 'qualificationState'),
    activationBases: countBy(transferRegistry.entries, 'activationBasis'),
  },
  telemetry: telemetry ? {
    schemaVersion: telemetry.schemaVersion,
    mode: telemetry.mode,
    updatedAt: telemetry.updatedAt,
    counters: telemetry.counters,
    reasonCounts: telemetry.reasonCounts,
    retainedRecordCount: telemetry.records?.length || 0,
    matchedProfileCount: profileActivations.size,
  } : null,
  retentionFiles,
  remoteReadiness,
};
const bankInventory = {
  schemaVersion: 'cortex.learning_os.continuous_math_bank_inventory.v1',
  evaluatedAt: now,
  currentDeploymentDigest,
  bankCount: banks.length,
  validAcquisitionBankCount: banks.filter((row) => row.summary.purpose === 'acquisition' && row.summary.validForCurrentDeployment).length,
  validRetentionBankCount: banks.filter((row) => row.summary.purpose === 'retention' && row.summary.validForCurrentDeployment).length,
  banks: banks.map((row) => row.summary),
};
const surfaceMatrix = {
  schemaVersion: 'cortex.learning_os.continuous_math_surface_matrix.v1',
  matrixId: `continuous-math-${runId}`,
  evaluatedAt: now,
  curriculumId: program.graph.curriculumId,
  aggregate,
  rows: matrixRows,
  truthBoundary: 'Profile availability and acquired-once evidence do not establish validity, retention, utility, or model-weight learning.',
};
const cohortPlan = {
  schemaVersion: 'cortex.learning_os.continuous_math_next_cohort.v1',
  evaluatedAt: now,
  acquisition: {
    status: acquisitionCohort.length ? 'selected' : 'frontier_exhausted',
    conceptCount: acquisitionCohort.length,
    concepts: acquisitionCohort.map(({ conceptId, title, stage, approximateDifficulty, tracks, prerequisites }) => ({ conceptId, title, stage, approximateDifficulty, tracks, prerequisites })),
    blocker: acquisitionCohort.length ? null : 'No unassessed prerequisite-ready concept remains in the current 264-node curriculum; source-grounded graph expansion is required for additional new-math acquisition.',
  },
  validity: {
    status: validityCohort.length ? 'selected_bank_required' : 'not_selectable',
    conceptCount: validityCohort.length,
    concepts: validityCohort.map(({ conceptId, title, stage, approximateDifficulty, tracks }) => ({ conceptId, title, stage, approximateDifficulty, tracks })),
    blocker: 'A disjoint independently authored validity bank does not yet exist.',
  },
  retention: {
    status: 'selected_bank_required',
    conceptCount: Math.min(19, validityCohort.length),
    concepts: validityCohort.slice(0, 19).map(({ conceptId, title, stage, approximateDifficulty, tracks }) => ({ conceptId, title, stage, approximateDifficulty, tracks })),
    blocker: 'No current-deployment production retention bank exists; elapsed-time credit cannot begin from generated fixtures.',
  },
  utility: {
    status: utilityCohort.length ? 'candidate_only' : 'telemetry_insufficient',
    conceptCount: utilityCohort.length,
    concepts: utilityCohort.map(({ conceptId, title, utility }) => ({ conceptId, title, observedContentFreeActivations: utility.observedContentFreeActivations })),
    blocker: utilityCohort.length ? null : 'Content-free telemetry contains no matched active-profile selection evidence in the retained window.',
  },
};
const truthConflicts = {
  schemaVersion: 'cortex.learning_os.continuous_math_truth_conflicts.v1',
  evaluatedAt: now,
  count: 3,
  conflicts: [
    {
      id: 'acquired-once-vs-retention',
      observed: `${aggregate.acquiredOnce}/264 signed acquired-once records and ${aggregate.retentionR7}/264 R7 retention confirmations`,
      resolution: 'Keep acquisition and retention in separate ledgers; do not call acquired-once retained.',
    },
    {
      id: 'operator-availability-vs-utility',
      observed: `${aggregate.operatorAvailable}/264 operator-available profiles and ${aggregate.utilityQualified}/264 utility-qualified profiles`,
      resolution: 'Preserve operator availability label; require paired utility evidence for stronger ranking.',
    },
    {
      id: 'historical-bank-vs-current-deployment',
      observed: `${banks.length} live bank file(s), ${bankInventory.validAcquisitionBankCount} acquisition and ${bankInventory.validRetentionBankCount} retention bank(s) valid for current deployment digest`,
      resolution: 'Do not reuse stale deployment-bound banks as current evidence; commission/rebind only through independent author/reviewer authority.',
    },
  ],
};
const thresholdEvaluation = {
  schemaVersion: 'cortex.learning_os.continuous_math_phase0_thresholds.v1',
  evaluatedAt: now,
  gates: {
    canonicalProgramValid: program.ok,
    productionTrustReady: program.productionTrustReady,
    signedMasteryValid: masteryVerification.ok,
    exact264RowMatrix: matrixRows.length === 264,
    signed264EntryTransferRegistry: transferRegistry.entries.length === 264 && transferEntriesByConcept.size === 264,
    livePluginMatchesSource: pluginComparison.exact,
    remoteExecutionBoundaryReady: remoteReadiness.ready === true,
    providerModelCallsZero: true,
    canonicalStateMutationsZero: true,
  },
  phase0MechanicalGreen: integrityBlockers.length === 0,
  nextLearningExecutionReady: readinessBlockers.length === 0,
  readinessBlockers,
};
const blockerReport = {
  schemaVersion: 'cortex.learning_os.continuous_math_blocker_report.v1',
  evaluatedAt: now,
  status: integrityBlockers.length ? 'integrity_blocked' : 'readiness_blocked',
  integrityBlockers,
  readinessBlockers,
  nextActions: [
    'Create a source-grounded curriculum expansion proposal because the current 264-node acquisition frontier is exhausted.',
    'Commission independently authored and reviewed validity and retention banks bound to the exact current deployment.',
    'Preserve the existing acquired-once ledger; do not rerun the same bank merely to produce a new deployment binding.',
    'Collect content-free matched activations before selecting everyday utility task families.',
  ],
};
const completionSummary = {
  schemaVersion: 'cortex.learning_os.continuous_math_phase0_completion.v1',
  runId,
  evaluatedAt: now,
  status: integrityBlockers.length ? 'blocked' : readinessBlockers.length ? 'completed_readiness_blocked' : 'completed_ready',
  phase0MechanicalGreen: integrityBlockers.length === 0,
  nextLearningExecutionReady: readinessBlockers.length === 0,
  modelCalls: 0,
  canonicalStateMutations: 0,
  curriculum: {
    subjectSection: validityCohort[0]?.category || 'mathematics',
    currentConcept: validityCohort[0]?.title || null,
    approximateDifficulty: validityCohort[0]?.approximateDifficulty || null,
  },
  counts: aggregate,
  readinessBlockers,
  truthBoundary: 'Phase 0 is a read-only mechanical audit. It proves no new acquisition, validity, retention, utility, or model-weight learning.',
};

writeJson('contract.json', contract);
writeJson('source-freeze.json', sourceFreeze);
writeJson('live-state-snapshot.json', liveStateSnapshot);
writeJson('bank-inventory.json', bankInventory);
writeJson('curriculum-surface-matrix.json', surfaceMatrix);
writeJson('acquisition-state.json', { schemaVersion: acquisitionStatus?.schemaVersion || null, evaluatedAt: now, signatureValid: masteryVerification.ok, status: acquisitionStatus });
writeJson('validity-state.json', { schemaVersion: 'cortex.learning_os.validity_state.v1', evaluatedAt: now, confirmedCount: 0, status: 'not_started' });
writeJson('retention-state.json', { schemaVersion: 'cortex.learning_os.retention_lane_state.v1', evaluatedAt: now, r7Confirmed: 0, r30Confirmed: 0, r90Confirmed: 0, files: retentionFiles });
writeJson('utility-state.json', { schemaVersion: 'cortex.learning_os.utility_state.v1', evaluatedAt: now, candidateCount: utilityCohort.length, qualifiedCount: 0, telemetryMode: telemetry?.mode || null });
writeJson('everyday-tier-registry.json', { schemaVersion: 'cortex.learning_os.everyday_tier_registry.v1', evaluatedAt: now, counts: { operatorAvailable: aggregate.operatorAvailable, utilityQualified: 0, everydayPreferred: 0 } });
writeJson('cohort-plan.json', cohortPlan);
writeJson('remote-readiness.json', remoteReadiness);
writeJson('threshold-evaluation.json', thresholdEvaluation);
writeJson('truth-conflicts.json', truthConflicts);
writeJson('blocker-report.json', blockerReport);
writeJson('completion-summary.json', completionSummary);
fs.writeFileSync(path.join(artifactRoot, 'provider-call-ledger.jsonl'), '', { mode: 0o600, flag: 'wx' });

const manifestFiles = listFiles(artifactRoot)
  .filter((row) => row.relativePath !== 'manifest.json')
  .map((row) => ({ path: row.relativePath, bytes: fs.statSync(row.path).size, sha256: sha256File(row.path) }));
const manifest = {
  schemaVersion: 'cortex.learning_os.continuous_math_phase0_manifest.v1',
  runId,
  generatedAt: now,
  files: manifestFiles,
  aggregateSha256: sha256Text(canonicalJson(manifestFiles)),
};
writeJson('manifest.json', manifest);

console.log(JSON.stringify({
  ok: integrityBlockers.length === 0,
  runId,
  artifactRoot,
  phase0MechanicalGreen: integrityBlockers.length === 0,
  nextLearningExecutionReady: readinessBlockers.length === 0,
  counts: aggregate,
  selectedValidityConcepts: validityCohort.length,
  readinessBlockers,
  modelCalls: 0,
  canonicalStateMutations: 0,
}, null, 2));
if (integrityBlockers.length) process.exitCode = 1;
