#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { validateApprovedModelExecutableBinding } from './approved-model-executable.mjs';
import { CONTINUOUS_MATH_VALIDITY_MODEL_RUNTIME } from './continuous-math-validity-runtime.mjs';
import { deploymentBindingDigest } from './deployment-identity.mjs';
import { executionSourceSha256 } from './execution-evidence.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256Bytes, sha256File, sha256Text } from './hash.mjs';
import {
  executeIndependentAssessmentItem,
  materializeIndependentAssessmentItem,
  validateIndependentAssessmentBank,
} from './phd-assessment.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import {
  buildExamPrompt,
  extractJson,
  observedToolEvents,
} from './model-answer-runner.mjs';
import { verifyTrustedExecutionEvidence } from './phd-trust.mjs';
import { validateValidityPlan } from './validity-plan.mjs';
import {
  signValidityState,
  validateValidityState,
} from './validity-state.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const planPath = path.resolve(value('--plan', ''));
const bankPath = path.resolve(value('--bank', ''));
const remoteStatePath = path.resolve(value('--remote-state', ''));
const incomingRoot = path.resolve(value('--incoming-root', ''));
const outputRoot = path.resolve(value('--out-root', ''));
const approvedExecutablePath = path.resolve(value('--approved-model-executable-binding', ''));
const graderPrivateKeyPath = path.resolve(value('--grader-private-key', ''));
if (![value('--plan'), value('--bank'), value('--remote-state'), value('--incoming-root'), value('--out-root'), value('--approved-model-executable-binding'), value('--grader-private-key')].every(Boolean)) {
  throw new Error('validity verifier requires --plan, --bank, --remote-state, --incoming-root, --out-root, --approved-model-executable-binding, and --grader-private-key');
}
if (fs.existsSync(outputRoot)) throw new Error('validity verification output root must be fresh');
for (const [target, label, ownerOnly] of [
  [planPath, 'validity plan', false],
  [bankPath, 'validity bank', false],
  [remoteStatePath, 'remote supervisor state', false],
  [approvedExecutablePath, 'approved executable binding', false],
  [graderPrivateKeyPath, 'grader private key', true],
]) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 128 * 1024 * 1024
      || (ownerOnly && (stat.mode & 0o077) !== 0)) {
    throw new Error(`${label} is unsafe or unavailable`);
  }
}
const incomingStat = fs.lstatSync(incomingRoot);
if (!incomingStat.isDirectory() || incomingStat.isSymbolicLink()) {
  throw new Error('validity incoming artifact root is unsafe or unavailable');
}

function readJson(target, maximumBytes = 128 * 1024 * 1024) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`unsafe required JSON: ${target}`);
  }
  const result = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`JSON object required: ${target}`);
  }
  return result;
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function writeJson(target, record) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
function safeRelative(relative) {
  if (typeof relative !== 'string' || relative.length < 1 || relative.length > 4096
      || path.posix.isAbsolute(relative) || !/^[A-Za-z0-9._/-]+$/.test(relative)
      || relative.split('/').includes('..')) {
    throw new Error('unsafe validity artifact relative path');
  }
  return relative;
}
function positiveUsage(usage) {
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    && Object.entries(usage).some(([name, observed]) => (
      /(?:input|output|total|token)/i.test(name) && Number(observed) > 0
    ));
}
function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`validity artifact contains a symlink: ${target}`);
    return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
  });
}
function verifyManifest(root, expectedConceptId, expectedSessionId) {
  const manifestPath = path.join(root, 'artifact_manifest.json');
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 'cortex.learning_os.validity_session_manifest.v1'
      || manifest.conceptId !== expectedConceptId
      || manifest.sessionId !== expectedSessionId
      || !Array.isArray(manifest.files) || manifest.files.length !== 6) {
    throw new Error('validity session manifest identity or file count is invalid');
  }
  const expectedNames = [
    'answer_set.json',
    'exam.json',
    'model_call.json',
    'model_prompt.txt',
    'session.json',
    'worker_receipt.json',
  ];
  const names = manifest.files.map((record) => safeRelative(record.path)).sort();
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    throw new Error('validity session manifest file set is incomplete or unexpected');
  }
  for (const record of manifest.files) {
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 1
        || !/^[0-9a-f]{64}$/.test(String(record.sha256 || ''))) {
      throw new Error(`validity session manifest row is invalid: ${record.path}`);
    }
    const target = path.resolve(root, record.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('validity manifest path escaped session root');
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.bytes
        || sha256File(target) !== record.sha256) {
      throw new Error(`validity session artifact mutation: ${record.path}`);
    }
  }
  const actual = listFiles(root).map((target) => path.relative(root, target))
    .filter((relative) => relative !== 'artifact_manifest.json').sort();
  if (canonicalJson(actual) !== canonicalJson(expectedNames)) {
    throw new Error('validity session manifest does not exactly cover artifact files');
  }
  return { manifest, manifestSha256: sha256File(manifestPath) };
}

const identity = currentCommittedIdentity({ requireClean: true });
const program = loadCanonicalPhdProgram({
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  productTree: identity.productTree,
});
if (!program.ok || !program.productionTrustReady) {
  throw new Error(`canonical program is not production-ready: ${program.errors.join('; ')}`);
}
const plan = readJson(planPath);
const bank = readJson(bankPath);
const remoteState = readJson(remoteStatePath);
const approvedModelExecutable = readJson(approvedExecutablePath);
const approvedValidation = validateApprovedModelExecutableBinding(approvedModelExecutable);
if (!approvedValidation.ok) {
  throw new Error(`approved executable binding is invalid: ${approvedValidation.errors.join('; ')}`);
}
const bankValidation = validateIndependentAssessmentBank(bank, {
  graph: program.graph,
  rubric: program.rubric,
  trustPolicy: program.trustPolicy,
  deployment: program.deployment,
  campaignBinding: bank.bindings?.campaign,
});
if (!bankValidation.ok || bank.purpose !== 'validity') {
  throw new Error(`validity bank failed production validation: ${bankValidation.errors.join('; ')}`);
}
const graphConceptIds = program.graph.concepts.map((concept) => concept.conceptId);
const expectedBank = {
  bankId: bank.bankId,
  bankDigest: bank.bankDigest,
  bankSha256: sha256File(bankPath),
  campaign: structuredClone(bank.bindings.campaign),
};
const expectedAcquisition = {
  revision: plan.acquisition?.revision,
  stateSha256: plan.acquisition?.stateSha256,
  acquiredOnceCount: plan.acquisition?.acquiredOnceCount,
};
const planValidation = validateValidityPlan(plan, {
  trustPolicy: program.trustPolicy,
  conceptIds: graphConceptIds,
  expectedSource: identity,
  expectedBank,
  expectedAcquisition,
});
if (!planValidation.ok) {
  throw new Error(`validity plan failed proctor verification: ${planValidation.errors.join('; ')}`);
}
const expectedModelRuntime = structuredClone(CONTINUOUS_MATH_VALIDITY_MODEL_RUNTIME);
if (canonicalJson(plan.modelRuntime) !== canonicalJson(expectedModelRuntime)) {
  throw new Error('validity plan model runtime differs from the frozen production runtime');
}
if (remoteState.schemaVersion !== 'cortex.learning_os.remote_validity_supervisor.v1'
    || remoteState.status !== 'completed'
    || remoteState.campaignId !== plan.campaignId
    || remoteState.planSha256 !== plan.planSha256
    || canonicalJson(remoteState.source) !== canonicalJson(identity)
    || !Array.isArray(remoteState.results)
    || remoteState.results.length !== graphConceptIds.length
    || new Set(remoteState.results.map((row) => row?.conceptId)).size !== graphConceptIds.length) {
  throw new Error('remote validity supervisor did not terminate with one identity-bound result per concept');
}

const itemById = new Map(bank.items.map((item) => [item.itemId, item]));
const acquisitionByConcept = new Map(plan.acquisition.concepts.map((row) => [row.conceptId, row]));
const sessionByConcept = new Map(plan.sessions.map((row) => [row.conceptId, row]));
const remoteByConcept = new Map(remoteState.results.map((row) => [row.conceptId, row]));
const rows = [];
const gradeRecords = [];
for (const conceptId of graphConceptIds) {
  const acquisition = acquisitionByConcept.get(conceptId);
  const session = sessionByConcept.get(conceptId);
  const remote = remoteByConcept.get(conceptId);
  const blockedRow = (reason) => ({
    conceptId,
    acquisitionState: 'acquired_once',
    acquisitionEvidenceDigest: acquisition.evidenceDigest,
    validityState: 'validity_blocked',
    requiredItemCount: 2,
    passedItemCount: 0,
    failedItemCount: 0,
    errorItemCount: 0,
    score: 0,
    sessionId: session.sessionId,
    completedAt: remote?.completedAt && Number.isFinite(Date.parse(remote.completedAt))
      ? new Date(Date.parse(remote.completedAt)).toISOString()
      : null,
    itemResults: [],
    blockedReasons: [String(reason || 'validity execution was blocked').slice(0, 3000)],
  });
  if (!remote || remote.status !== 'candidate') {
    rows.push(blockedRow(remote?.reason || 'remote supervisor supplied no candidate artifact'));
    continue;
  }
  try {
    const relative = safeRelative(remote.artifactRelativePath);
    const root = path.resolve(incomingRoot, relative);
    if (!root.startsWith(`${incomingRoot}${path.sep}`)) throw new Error('remote artifact path escaped incoming root');
    const { manifestSha256 } = verifyManifest(root, conceptId, session.sessionId);
    const storedSession = readJson(path.join(root, 'session.json'));
    const exam = readJson(path.join(root, 'exam.json'));
    const answerSet = readJson(path.join(root, 'answer_set.json'));
    const modelCall = readJson(path.join(root, 'model_call.json'));
    const receipt = readJson(path.join(root, 'worker_receipt.json'));
    const promptBytes = fs.readFileSync(path.join(root, 'model_prompt.txt'));
    const prompt = promptBytes.toString('utf8');
    const items = session.itemIds.map((itemId) => itemById.get(itemId));
    const expectedExam = {
      schemaVersion: 'cortex.learning_os.exam.v0',
      examId: `${session.jobId}.exam`,
      capsuleId: program.graph.capsuleId,
      version: '1.0.0',
      title: `Independent near-term validity — ${conceptId}`,
      passThreshold: plan.threshold.minimumScore,
      allowedTools: [],
      items: items.map((item) => materializeIndependentAssessmentItem(item, { bank })),
      truthBoundary: 'This two-family exam is a disjoint near-term validity probe. A worker response is candidate evidence only until trusted execution replay and independent deterministic grading.',
    };
    if (canonicalJson(storedSession) !== canonicalJson(session)
        || canonicalJson(exam) !== canonicalJson(expectedExam)
        || prompt !== buildExamPrompt({ exam: expectedExam, learningContext: null })) {
      throw new Error('validity session plan, exam, or exact prompt was substituted');
    }
    if (!exactKeys(receipt, [
      'bank',
      'campaignId',
      'completedAt',
      'conceptId',
      'executionEvidenceSha256',
      'jobId',
      'modelRuntime',
      'placement',
      'planSha256',
      'providerUsage',
      'schemaVersion',
      'sessionId',
      'source',
      'startedAt',
      'status',
      'truthBoundary',
    ])
        || receipt.schemaVersion !== 'cortex.learning_os.validity_worker_receipt.v1'
        || receipt.status !== 'candidate'
        || receipt.placement !== 'hetzner'
        || receipt.campaignId !== plan.campaignId
        || receipt.planSha256 !== plan.planSha256
        || receipt.conceptId !== conceptId
        || receipt.sessionId !== session.sessionId
        || receipt.jobId !== session.jobId
        || canonicalJson(receipt.source) !== canonicalJson(identity)
        || canonicalJson(receipt.bank) !== canonicalJson(expectedBank)
        || canonicalJson(receipt.modelRuntime) !== canonicalJson(expectedModelRuntime)
        || receipt.executionEvidenceSha256 !== modelCall.executionEvidenceSha256) {
      throw new Error('validity worker receipt is invalid or detached');
    }
    if (answerSet.schemaVersion !== 'cortex.learning_os.answer_set.v0'
        || answerSet.runId !== session.jobId
        || answerSet.evidenceRole !== 'validity'
        || answerSet.answerSource?.kind !== 'codex_exec_ephemeral'
        || answerSet.answerSource?.provider !== plan.modelRuntime.provider
        || answerSet.answerSource?.model !== plan.modelRuntime.model
        || answerSet.answerSource?.sessionId !== session.sessionId
        || !positiveUsage(answerSet.answerSource?.usage)
        || !Array.isArray(answerSet.toolsUsed) || answerSet.toolsUsed.length !== 0
        || answerSet.startedAt !== modelCall.startedAt
        || answerSet.completedAt !== modelCall.completedAt) {
      throw new Error('validity candidate answer provenance is invalid');
    }
    const expectedItemIds = [...session.itemIds].sort();
    const observedItemIds = (answerSet.answers || []).map((row) => row?.itemId).sort();
    if (canonicalJson(observedItemIds) !== canonicalJson(expectedItemIds)
        || new Set(observedItemIds).size !== observedItemIds.length
        || observedToolEvents(modelCall.events || []).length !== 0) {
      throw new Error('validity answer set is incomplete, duplicated, or used tools');
    }
    const parsedOutput = extractJson(modelCall.finalText);
    if (canonicalJson(parsedOutput.answers) !== canonicalJson(answerSet.answers)) {
      throw new Error('validity answer set differs from the canonical model output');
    }
    const expectedBindings = {
      candidateId: null,
      candidateSessionId: session.sessionId,
      candidateSha256: sha256Bytes(Buffer.from(modelCall.finalText, 'utf8')),
      taskId: conceptId,
      taskSha256: session.taskSha256,
      jobId: session.jobId,
      jobSha256: session.jobSha256,
      campaignId: plan.campaignId,
      campaignSha256: plan.planSha256,
      deploymentSha256: deploymentBindingDigest(program.deployment),
      sourceSha256: executionSourceSha256(program.deployment),
    };
    const trusted = verifyTrustedExecutionEvidence({
      attestation: modelCall.executionAttestation,
      trustPolicy: program.trustPolicy,
      executionEvidenceCore: modelCall.executionEvidenceCore,
      executionEvidenceSha256: modelCall.executionEvidenceSha256,
      inputBytes: promptBytes,
      rawOutputBytes: Buffer.from(modelCall.finalText, 'utf8'),
      rawEventLedgerBytes: Buffer.from(modelCall.stdoutBase64 || '', 'base64'),
      rawStderrBytes: Buffer.from(modelCall.stderrBase64 || '', 'base64'),
      expected: {
        modelRuntime: expectedModelRuntime,
        role: 'validity_candidate',
        plannedSessionId: session.sessionId,
        promptSha256: sha256Bytes(promptBytes),
        bindings: expectedBindings,
        startedAt: answerSet.startedAt,
        completedAt: answerSet.completedAt,
        notBefore: plan.notBefore,
        notAfter: plan.expiresAt,
        approvedExecutable: approvedModelExecutable,
      },
    });
    if (!trusted.ok) {
      throw new Error(`trusted execution replay failed: ${trusted.errors.join('; ')}`);
    }
    const answers = new Map(answerSet.answers.map((answer) => [answer.itemId, answer.answer]));
    const itemResults = items.map((item) => {
      const answer = answers.get(item.itemId);
      const execution = executeIndependentAssessmentItem({
        item,
        answer,
        bank,
        graph: program.graph,
        rubric: program.rubric,
        trustPolicy: program.trustPolicy,
        deployment: program.deployment,
        campaignBinding: bank.bindings.campaign,
      });
      const evidence = {
        conceptId,
        itemId: item.itemId,
        assessmentRole: item.assessmentRole,
        itemContentDigest: item.contentDigest,
        checkerSpecificationSha256: item.checker.specificationSha256,
        answerSha256: sha256Text(typeof answer === 'string' ? answer : canonicalJson(answer)),
        status: execution.grading.status,
        score: execution.grading.passed ? 1 : 0,
        executionEvidenceSha256: modelCall.executionEvidenceSha256,
        artifactManifestSha256: manifestSha256,
      };
      return {
        itemId: item.itemId,
        assessmentRole: item.assessmentRole,
        semanticFamilyId: item.semanticFamilyId,
        itemContentDigest: item.contentDigest,
        status: execution.grading.status,
        score: execution.grading.passed ? 1 : 0,
        observedAnswerSha256: evidence.answerSha256,
        verifierEvidenceSha256: sha256Text(canonicalJson(evidence)),
        executionEvidenceSha256: modelCall.executionEvidenceSha256,
      };
    });
    const passed = itemResults.filter((item) => item.status === 'passed').length;
    const failed = itemResults.filter((item) => item.status === 'failed').length;
    const errored = itemResults.filter((item) => item.status === 'error').length;
    const score = Number((passed / 2).toFixed(6));
    const compositionalPassed = itemResults.some((item) => (
      item.assessmentRole === 'validity-compositional' && item.status === 'passed'
    ));
    const confirmed = itemResults.length === 2 && passed === 2 && failed === 0 && errored === 0
      && score >= plan.threshold.minimumScore && compositionalPassed;
    const row = {
      conceptId,
      acquisitionState: 'acquired_once',
      acquisitionEvidenceDigest: acquisition.evidenceDigest,
      validityState: confirmed ? 'validity_confirmed' : 'validity_failed',
      requiredItemCount: 2,
      passedItemCount: passed,
      failedItemCount: failed,
      errorItemCount: errored,
      score,
      sessionId: session.sessionId,
      completedAt: answerSet.completedAt,
      itemResults,
      blockedReasons: [],
    };
    rows.push(row);
    gradeRecords.push({
      schemaVersion: 'cortex.learning_os.validity_concept_grade.v1',
      campaignId: plan.campaignId,
      planSha256: plan.planSha256,
      bankDigest: bank.bankDigest,
      source: identity,
      ...row,
      artifactRelativePath: relative,
      artifactManifestSha256: manifestSha256,
      truthBoundary: 'This concept grade is included in the grader-attested aggregate validity state. It is near-term validity evidence only and grants no retention, utility, or model-weight claim.',
    });
  } catch (error) {
    rows.push(blockedRow(`independent replay blocked: ${error.message}`));
  }
}
const counts = {
  conceptCount: rows.length,
  acquiredOnce: rows.filter((row) => row.acquisitionState === 'acquired_once').length,
  validityPending: rows.filter((row) => row.validityState === 'validity_pending').length,
  validityConfirmed: rows.filter((row) => row.validityState === 'validity_confirmed').length,
  validityFailed: rows.filter((row) => row.validityState === 'validity_failed').length,
  validityBlocked: rows.filter((row) => row.validityState === 'validity_blocked').length,
};
const unsignedState = {
  schemaVersion: 'cortex.learning_os.validity_state.v1',
  campaignId: plan.campaignId,
  generatedAt: new Date().toISOString(),
  source: identity,
  bank: expectedBank,
  acquisition: expectedAcquisition,
  threshold: structuredClone(plan.threshold),
  concepts: rows,
  counts,
  truthBoundary: 'This signed ledger preserves 288/288 historical acquired-once records and independently reports near-term validity as confirmed, failed, or blocked. A validity failure does not erase acquisition. No row grants elapsed retention, everyday utility, broad mastery, or model-weight learning.',
  stateSha256: null,
  graderAttestation: null,
};
const signedState = signValidityState(unsignedState, {
  trustPolicy: program.trustPolicy,
  privateKeyPem: fs.readFileSync(graderPrivateKeyPath, 'utf8'),
  conceptIds: graphConceptIds,
  expectedSource: identity,
  expectedBank,
  expectedAcquisition,
});
const finalValidation = validateValidityState(signedState, {
  trustPolicy: program.trustPolicy,
  conceptIds: graphConceptIds,
  expectedSource: identity,
  expectedBank,
  expectedAcquisition,
});
if (!finalValidation.ok) {
  throw new Error(`final signed validity state failed self-verification: ${finalValidation.errors.join('; ')}`);
}
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
const gradesRoot = path.join(outputRoot, 'grades');
fs.mkdirSync(gradesRoot, { mode: 0o700 });
for (const grade of gradeRecords) {
  writeJson(path.join(gradesRoot, `${grade.conceptId}.json`), grade);
}
writeJson(path.join(outputRoot, 'validity-state.json'), signedState);
const summary = {
  schemaVersion: 'cortex.learning_os.validity_completion_summary.v1',
  status: counts.validityBlocked === 0 ? 'completed' : 'completed_with_blocked_concepts',
  campaignId: plan.campaignId,
  completedAt: signedState.generatedAt,
  source: identity,
  bank: expectedBank,
  acquisition: expectedAcquisition,
  counts,
  graderAuthorityId: signedState.graderAttestation.authorityId,
  stateSha256: signedState.stateSha256,
  allowedClaims: [
    `${counts.acquiredOnce}/288 acquired once`,
    `${counts.validityConfirmed}/288 near-term validity-confirmed`,
    `${counts.validityFailed}/288 near-term validity-failed`,
    `${counts.validityBlocked}/288 near-term validity-blocked`,
  ],
  disallowedClaims: [
    'retention confirmed',
    'utility qualified',
    'full mathematical mastery',
    'model weights changed',
  ],
  retentionR7Confirmed: 0,
  utilityQualified: 0,
  modelWeightLearningClaim: false,
  truthBoundary: signedState.truthBoundary,
};
writeJson(path.join(outputRoot, 'completion-summary.json'), summary);
const files = listFiles(outputRoot)
  .filter((target) => path.basename(target) !== 'integrity-manifest.json')
  .map((target) => {
    const stat = fs.lstatSync(target);
    return {
      path: path.relative(outputRoot, target),
      bytes: stat.size,
      sha256: sha256File(target),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
writeJson(path.join(outputRoot, 'integrity-manifest.json'), {
  schemaVersion: 'cortex.learning_os.validity_integrity_manifest.v1',
  campaignId: plan.campaignId,
  generatedAt: signedState.generatedAt,
  files,
  stateSha256: signedState.stateSha256,
  truthBoundary: 'This manifest binds the returned control-plane verification artifacts. It does not elevate their declared evidence layer.',
});
console.log(JSON.stringify({
  ok: true,
  outputRoot,
  counts,
  stateSha256: signedState.stateSha256,
  graderAuthorityId: signedState.graderAttestation.authorityId,
  summaryPath: path.join(outputRoot, 'completion-summary.json'),
}, null, 2));
