#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { validateIndependentAssessmentBank } from './phd-assessment.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { readMasterySecret, verifyMasteryState } from './mastery-state.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { signValidityPlan } from './validity-plan.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const outputValue = value('--out');
const bankValue = value('--bank');
const campaignId = value('--campaign-id');
const stateRoot = path.resolve(value(
  '--state-root',
  path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-learning-os'),
));
const masteryPath = path.resolve(value('--mastery', path.join(stateRoot, 'mastery.json')));
const masterySecretPath = path.resolve(value('--mastery-secret', path.join(stateRoot, 'mastery.hmac')));
const proctorPrivateKeyPath = path.resolve(value('--proctor-private-key', ''));
const thinking = value('--thinking', 'ultra');
if (!outputValue || !bankValue || !campaignId || !value('--proctor-private-key')) {
  throw new Error('usage: continuous-math-validity-plan.mjs --out <fresh-file> --bank <signed-bank> --campaign-id <id> --proctor-private-key <owner-only-key> [--state-root <root>] [--thinking ultra]');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(campaignId)) throw new Error('invalid validity campaign identity');
if (!['xhigh', 'ultra'].includes(thinking)) throw new Error('validity reasoning must be xhigh or ultra');
const outputPath = path.resolve(outputValue);
const bankPath = path.resolve(bankValue);
if (fs.existsSync(outputPath)) throw new Error('validity plan output must be fresh');
for (const [target, label, ownerOnly] of [
  [bankPath, 'validity bank', false],
  [masteryPath, 'signed acquisition state', false],
  [masterySecretPath, 'acquisition state secret', true],
  [proctorPrivateKeyPath, 'proctor private key', true],
]) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || (ownerOnly && (stat.mode & 0o077) !== 0)) {
    throw new Error(`${label} must be ${ownerOnly ? 'owner-only ' : ''}regular non-symlink material`);
  }
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
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const bankValidation = validateIndependentAssessmentBank(bank, {
  graph: program.graph,
  rubric: program.rubric,
  trustPolicy: program.trustPolicy,
  deployment: program.deployment,
  campaignBinding: bank.bindings?.campaign,
});
if (!bankValidation.ok || bank.purpose !== 'validity' || bank.items.length !== 576) {
  throw new Error(`full validity bank is invalid: ${bankValidation.errors.join('; ')}`);
}
const itemConceptIds = new Set(bank.items.map((item) => item.conceptId));
const graphConceptIds = program.graph.concepts.map((concept) => concept.conceptId);
if (itemConceptIds.size !== 288 || graphConceptIds.some((conceptId) => !itemConceptIds.has(conceptId))) {
  throw new Error('validity bank does not exactly cover the 288-concept curriculum');
}
for (const conceptId of graphConceptIds) {
  const items = bank.items.filter((item) => item.conceptId === conceptId);
  if (items.length !== 2
      || canonicalJson(items.map((item) => item.assessmentRole).sort())
        !== canonicalJson(['validity-compositional', 'validity-direct'])
      || new Set(items.map((item) => item.semanticFamilyId)).size !== 2) {
    throw new Error(`validity bank family coverage is invalid: ${conceptId}`);
  }
}
const mastery = JSON.parse(fs.readFileSync(masteryPath, 'utf8'));
const masterySecret = readMasterySecret(masterySecretPath);
const masteryVerification = verifyMasteryState(mastery, masterySecret, {
  graph: program.graph,
  policy: program.acquisitionPolicy,
});
if (!masteryVerification.ok) {
  throw new Error(`signed acquisition state is invalid: ${masteryVerification.errors.join('; ')}`);
}
const acquired = graphConceptIds.map((conceptId) => {
  const row = mastery.concepts[conceptId];
  if (row?.state !== 'acquired'
      || !/^[0-9a-f]{64}$/.test(String(row.lastEvidenceDigest || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(row.lastRunId || ''))
      || !Number.isFinite(Date.parse(String(row.acquiredAt || '')))) {
    throw new Error(`concept lacks signed acquired-once evidence: ${conceptId}`);
  }
  return {
    conceptId,
    acquiredAt: new Date(Date.parse(row.acquiredAt)).toISOString(),
    evidenceDigest: row.lastEvidenceDigest,
    runId: row.lastRunId,
  };
});
const source = identity;
const bankBinding = {
  bankId: bank.bankId,
  bankDigest: bank.bankDigest,
  bankSha256: sha256Bytes(fs.readFileSync(bankPath)),
  campaign: structuredClone(bank.bindings.campaign),
};
const acquisition = {
  revision: mastery.revision,
  stateSha256: sha256Text(canonicalJson(mastery)),
  acquiredOnceCount: acquired.length,
  concepts: acquired,
};
const threshold = {
  requiredRoles: ['validity-direct', 'validity-compositional'],
  minimumScore: 0.8,
  requireAllFamilies: true,
  requireCompositionalPass: true,
  undeclaredToolsAllowed: false,
};
const generatedAt = new Date().toISOString();
const planCore = {
  schemaVersion: 'cortex.learning_os.validity_plan.v1',
  campaignId,
  generatedAt,
  notBefore: new Date(Date.parse(generatedAt) - 300_000).toISOString(),
  expiresAt: new Date(Date.parse(generatedAt) + 86_400_000).toISOString(),
  source,
  bank: bankBinding,
  acquisition,
  modelRuntime: {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thinking,
    sandbox: 'read-only',
    toolsAllowed: false,
  },
  threshold,
  sessions: graphConceptIds.map((conceptId) => {
    const items = bank.items.filter((item) => item.conceptId === conceptId)
      .sort((left, right) => left.assessmentRole.localeCompare(right.assessmentRole));
    const task = {
      conceptId,
      itemIds: items.map((item) => item.itemId),
      itemContentDigests: items.map((item) => item.contentDigest),
      bankDigest: bank.bankDigest,
      acquisitionEvidenceDigest: mastery.concepts[conceptId].lastEvidenceDigest,
    };
    const taskSha256 = sha256Text(canonicalJson(task));
    const jobId = `${campaignId}.concept-${String(graphConceptIds.indexOf(conceptId) + 1).padStart(3, '0')}`;
    return {
      conceptId,
      sessionId: `${jobId}.candidate`,
      itemIds: task.itemIds,
      itemContentDigests: task.itemContentDigests,
      taskSha256,
      jobId,
      jobSha256: sha256Text(canonicalJson({ campaignId, jobId, taskSha256, sourceCommit: source.sourceCommit })),
    };
  }),
  truthBoundary: 'This proctor-signed plan schedules one fresh no-tools candidate session per acquired-once concept against two independently authored disjoint validity families. It does not grant validity before trusted execution replay and independent deterministic grading; it grants no retention, utility, or model-weight claim.',
  planSha256: null,
  proctorAttestation: null,
};
const expectedAcquisition = {
  revision: acquisition.revision,
  stateSha256: acquisition.stateSha256,
  acquiredOnceCount: acquisition.acquiredOnceCount,
};
const signedPlan = signValidityPlan(planCore, {
  trustPolicy: program.trustPolicy,
  privateKeyPem: fs.readFileSync(proctorPrivateKeyPath, 'utf8'),
  conceptIds: graphConceptIds,
  expectedSource: source,
  expectedBank: bankBinding,
  expectedAcquisition,
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(signedPlan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({
  ok: true,
  outputPath,
  campaignId,
  source,
  bank: bankBinding,
  acquisition: expectedAcquisition,
  sessionCount: signedPlan.sessions.length,
  planSha256: signedPlan.planSha256,
  proctorAuthorityId: signedPlan.proctorAttestation.authorityId,
}, null, 2));
