#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  assertApprovedModelExecutableAtPath,
  validateApprovedModelExecutableBinding,
} from './approved-model-executable.mjs';
import { deploymentBindingDigest } from './deployment-identity.mjs';
import { executionSourceSha256 } from './execution-evidence.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256File } from './hash.mjs';
import {
  materializeIndependentAssessmentItem,
  validateIndependentAssessmentBank,
} from './phd-assessment.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { buildExamPrompt, runCodexExam } from './model-answer-runner.mjs';
import { validateValidityPlan } from './validity-plan.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const planPath = path.resolve(value('--plan', ''));
const bankPath = path.resolve(value('--bank', ''));
const outputRoot = path.resolve(value('--artifact-root', ''));
const approvedExecutablePath = path.resolve(value('--approved-model-executable-binding', ''));
const executionPrivateKeyPath = path.resolve(value('--execution-private-key', ''));
const conceptId = value('--concept-id');
const codexCommand = value('--codex-command');
const timeoutSeconds = Number(value('--timeout-seconds', '1200'));
if (![value('--plan'), value('--bank'), value('--artifact-root'), value('--approved-model-executable-binding'), value('--execution-private-key'), conceptId, codexCommand].every(Boolean)) {
  throw new Error('validity worker requires --plan, --bank, --artifact-root, --approved-model-executable-binding, --execution-private-key, --concept-id, and --codex-command');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(conceptId)
    || !path.isAbsolute(codexCommand)
    || !Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 1800) {
  throw new Error('validity worker concept, executable, or timeout is invalid');
}
for (const [target, label, ownerOnly] of [
  [planPath, 'validity plan', false],
  [bankPath, 'validity bank', false],
  [approvedExecutablePath, 'approved executable binding', false],
  [executionPrivateKeyPath, 'execution authority private key', true],
]) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024 * 1024
      || (ownerOnly && (stat.mode & 0o077) !== 0)) {
    throw new Error(`${label} is unsafe or unavailable`);
  }
}
if (fs.existsSync(outputRoot)) throw new Error('validity session artifact root must be fresh');

function writeJson(name, record) {
  const target = path.join(outputRoot, name);
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return target;
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
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const bankBytes = fs.readFileSync(bankPath);
const bank = JSON.parse(bankBytes.toString('utf8'));
const approvedModelExecutable = JSON.parse(fs.readFileSync(approvedExecutablePath, 'utf8'));
const approvedValidation = validateApprovedModelExecutableBinding(approvedModelExecutable);
if (!approvedValidation.ok || approvedModelExecutable.path !== codexCommand) {
  throw new Error(`approved executable binding is invalid or differs from requested command: ${approvedValidation.errors.join('; ')}`);
}
assertApprovedModelExecutableAtPath(approvedModelExecutable);
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
const planValidation = validateValidityPlan(plan, {
  trustPolicy: program.trustPolicy,
  conceptIds: graphConceptIds,
  expectedSource: identity,
  expectedBank,
  expectedAcquisition: {
    revision: plan.acquisition?.revision,
    stateSha256: plan.acquisition?.stateSha256,
    acquiredOnceCount: plan.acquisition?.acquiredOnceCount,
  },
});
if (!planValidation.ok) {
  throw new Error(`validity plan failed proctor verification: ${planValidation.errors.join('; ')}`);
}
const now = Date.now();
if (now < Date.parse(plan.notBefore) || now > Date.parse(plan.expiresAt)) {
  throw new Error('validity plan is not currently releasable');
}
const session = plan.sessions.find((row) => row.conceptId === conceptId);
if (!session) throw new Error('validity plan does not schedule the requested concept');
const selectedItems = session.itemIds.map((itemId) => bank.items.find((item) => item.itemId === itemId));
if (selectedItems.some((item) => !item)
    || selectedItems.some((item) => item.conceptId !== conceptId)
    || canonicalJson(selectedItems.map((item) => item.contentDigest))
      !== canonicalJson(session.itemContentDigests)
    || canonicalJson(selectedItems.map((item) => item.assessmentRole).sort())
      !== canonicalJson(['validity-compositional', 'validity-direct'])) {
  throw new Error('validity plan item bytes or family roles were substituted');
}
const exam = {
  schemaVersion: 'cortex.learning_os.exam.v0',
  examId: `${session.jobId}.exam`,
  capsuleId: program.graph.capsuleId,
  version: '1.0.0',
  title: `Independent near-term validity — ${conceptId}`,
  passThreshold: plan.threshold.minimumScore,
  allowedTools: [],
  items: selectedItems.map((item) => materializeIndependentAssessmentItem(item, { bank })),
  truthBoundary: 'This two-family exam is a disjoint near-term validity probe. A worker response is candidate evidence only until trusted execution replay and independent deterministic grading.',
};
const executionBindings = {
  candidateId: null,
  taskId: conceptId,
  taskSha256: session.taskSha256,
  jobId: session.jobId,
  jobSha256: session.jobSha256,
  campaignId: plan.campaignId,
  campaignSha256: plan.planSha256,
  deploymentSha256: deploymentBindingDigest(program.deployment),
  sourceSha256: executionSourceSha256(program.deployment),
};
const executionPrivateKeyPem = fs.readFileSync(executionPrivateKeyPath, 'utf8');
const modelRun = runCodexExam({
  exam,
  sessionId: session.sessionId,
  runId: session.jobId,
  learningContext: null,
  evidenceRole: 'validity',
  timeoutSeconds,
  thinking: plan.modelRuntime.thinking,
  model: plan.modelRuntime.model,
  codexCommand,
  executionContext: {
    role: 'validity_candidate',
    bindings: executionBindings,
  },
  approvedModelExecutable,
  executionTrustPolicy: program.trustPolicy,
  executionPrivateKeyPem,
});
const expectedItemIds = [...session.itemIds].sort();
const observedItemIds = modelRun.answerSet.answers.map((row) => row.itemId).sort();
if (canonicalJson(observedItemIds) !== canonicalJson(expectedItemIds)
    || new Set(observedItemIds).size !== observedItemIds.length
    || modelRun.toolEvents.length !== 0) {
  throw new Error('validity candidate answer set is incomplete, duplicated, substituted, or used tools');
}
if (modelRun.prompt !== buildExamPrompt({ exam, learningContext: null })) {
  throw new Error('validity candidate prompt differs from the frozen exam');
}
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
writeJson('session.json', session);
writeJson('exam.json', exam);
fs.writeFileSync(path.join(outputRoot, 'model_prompt.txt'), modelRun.prompt, { mode: 0o600, flag: 'wx' });
writeJson('answer_set.json', modelRun.answerSet);
writeJson('model_call.json', modelRun.raw);
const receipt = {
  schemaVersion: 'cortex.learning_os.validity_worker_receipt.v1',
  status: 'candidate',
  placement: 'hetzner',
  campaignId: plan.campaignId,
  planSha256: plan.planSha256,
  conceptId,
  sessionId: session.sessionId,
  jobId: session.jobId,
  source: identity,
  bank: expectedBank,
  modelRuntime: structuredClone(plan.modelRuntime),
  startedAt: modelRun.answerSet.startedAt,
  completedAt: modelRun.answerSet.completedAt,
  providerUsage: structuredClone(modelRun.answerSet.answerSource.usage),
  executionEvidenceSha256: modelRun.raw.executionEvidenceSha256,
  truthBoundary: 'This remote worker receipt proves one candidate model execution was captured. It is ungraded and cannot mutate or qualify validity state.',
};
writeJson('worker_receipt.json', receipt);
const files = fs.readdirSync(outputRoot).sort().map((name) => {
  const target = path.join(outputRoot, name);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('validity artifact contains an unsafe entry');
  return { path: name, bytes: stat.size, sha256: sha256File(target) };
});
writeJson('artifact_manifest.json', {
  schemaVersion: 'cortex.learning_os.validity_session_manifest.v1',
  campaignId: plan.campaignId,
  conceptId,
  sessionId: session.sessionId,
  generatedAt: modelRun.answerSet.completedAt,
  files,
  truthBoundary: receipt.truthBoundary,
});
console.log(JSON.stringify({
  ok: true,
  artifactRoot: outputRoot,
  conceptId,
  sessionId: session.sessionId,
  executionEvidenceSha256: modelRun.raw.executionEvidenceSha256,
  providerUsage: modelRun.answerSet.answerSource.usage,
}, null, 2));
