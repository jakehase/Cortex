#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { validateRecord } from './contracts.mjs';
import { gradeExam } from './exam-runner.mjs';
import { sha256File } from './hash.mjs';
import { readJson } from './json.mjs';
import { buildMistakes, distillCandidate, selectRemediableFailure } from './learning-loop.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { evaluatePromotion } from './promotion.mjs';
import {
  ACTIVATION_PROFILES,
  LESSON_SCHEMA,
  canonicalJson,
  atomicWriteSignedRegistry,
  deduplicateLiveLessons,
  initializeRegistry,
  liveLessonSemanticKey,
  loadSignedRegistry,
  readRegistrySecret,
  validateLiveLesson,
} from '../../plugins/cortex-learning-os-live/registry.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const has = (flag) => args.includes(flag);
const stateRoot = path.resolve(value('--state-root', path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-learning-os')));
const registryPath = path.resolve(value('--registry', path.join(stateRoot, 'live-registry.json')));
const secretPath = path.resolve(value('--secret', path.join(stateRoot, 'registry.hmac')));

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, command, error: message, ...details }, null, 2));
  process.exitCode = 1;
}

function splitList(text) {
  return String(text || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function allGatesPass(report) {
  const gates = report?.gates;
  return gates && typeof gates === 'object' && !Array.isArray(gates)
    && Object.keys(gates).length > 0
    && Object.values(gates).every((value) => value === true);
}

function inferActivationProfiles(learningOutcome) {
  const itemId = String(learningOutcome?.baselineFailureItemId || '');
  if (/^mfs-\d+$/.test(itemId) || itemId === 'mfc-01') return ['exact_multiplication'];
  const mapping = {
    'mf-01': 'linear_equation',
    'mf-02': 'quadratic_roots',
    'mf-03': 'function_evaluation',
    'mf-04': 'inverse_function',
    'mf-05': 'geometric_series',
    'mf-06': 'absolute_value_equation',
    'mf-07': 'binomial_probability',
    'mf-08': 'complement_probability',
    'mf-24': 'combinations_permutations',
    'mfc-03': 'combinations_permutations',
    'mfc-08': 'linear_equation',
    'mfc-09': 'geometric_series',
    'mfc-10': 'function_evaluation',
    'mfc-14': 'combinations_permutations',
    'mfc-15': 'combinations_permutations',
  };
  return mapping[itemId] ? [mapping[itemId]] : [];
}

function verifyArtifactManifest(artifactRoot, manifest) {
  if (manifest?.schemaVersion !== 'cortex.learning_os.run_manifest.v0' || !Array.isArray(manifest.files)) {
    throw new Error('invalid artifact manifest');
  }
  if (manifest.files.length < 1 || manifest.files.length > 10_000) throw new Error('artifact manifest file count is outside the allowed range');
  const seen = new Set();
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(row.path) || path.isAbsolute(row.path) || row.path.split('/').includes('..')) {
      throw new Error('artifact manifest contains an unsafe path');
    }
    if (seen.has(row.path)) throw new Error(`duplicate manifest path: ${row.path}`);
    seen.add(row.path);
    if (typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) throw new Error(`invalid manifest digest: ${row.path}`);
    const filePath = path.resolve(artifactRoot, row.path);
    if (!filePath.startsWith(`${artifactRoot}${path.sep}`)) throw new Error(`manifest path escaped artifact root: ${row.path}`);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`manifest path is not a regular file: ${row.path}`);
    if (sha256File(filePath) !== row.sha256) throw new Error(`manifest digest mismatch: ${row.path}`);
  }
  return seen;
}

function positiveUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false;
  return Object.entries(usage).some(([key, amount]) => /(?:input|output|total|token)/i.test(key) && Number(amount) > 0);
}

function independentlyVerifyLearningLoop(artifactRoot, { trusted, report, summary, learningOutcome }) {
  const capsule = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/capsule.json'));
  const phases = {};
  for (const phase of ['baseline', 'correction', 'promotion-retest', 'heldout-retest']) {
    const phaseRoot = path.join(artifactRoot, phase);
    const exam = readJson(path.join(phaseRoot, 'exam.json'));
    const answers = readJson(path.join(phaseRoot, 'answers.json'));
    const attempts = readJson(path.join(phaseRoot, 'attempts.json'));
    const verifiers = readJson(path.join(phaseRoot, 'verifier_results.json'));
    const score = readJson(path.join(phaseRoot, 'score_summary.json'));
    if (!Array.isArray(answers.toolsUsed) || answers.toolsUsed.length !== 0) throw new Error(`${phase} answer set observed tool use`);
    if (!['codex_exec_ephemeral', 'openclaw_agent'].includes(answers.answerSource?.kind)) throw new Error(`${phase} answer source is not an approved model path`);
    if (answers.answerSource?.provider !== 'openai-codex' || typeof answers.answerSource?.model !== 'string' || !answers.answerSource.model) {
      throw new Error(`${phase} answer source provenance is incomplete`);
    }
    if (!positiveUsage(answers.answerSource?.usage)) throw new Error(`${phase} answer source has no positive provider-observed usage`);
    const replay = gradeExam({ capsule, exam, answerSet: answers, runId: score.runId, now: score.generatedAt });
    if (canonicalJson(replay.attempts) !== canonicalJson(attempts)) throw new Error(`${phase} attempt replay mismatch`);
    if (canonicalJson(replay.verifierResults) !== canonicalJson(verifiers)) throw new Error(`${phase} verifier replay mismatch`);
    if (canonicalJson(replay.summary) !== canonicalJson(score)) throw new Error(`${phase} score replay mismatch`);
    phases[phase] = { exam, answers, attempts, verifiers, score };
  }
  const selected = selectRemediableFailure({ exam: phases.baseline.exam, verifierResults: phases.baseline.verifiers });
  if (!selected || selected.item.itemId !== learningOutcome.baselineFailureItemId) throw new Error('recorded baseline failure is not independently remediable');
  if (canonicalJson(phases.correction.exam.items) !== canonicalJson([selected.item.remediation.correctionItem])) throw new Error('correction exam does not match frozen remediation item');
  if (canonicalJson(phases['promotion-retest'].exam.items) !== canonicalJson([selected.item.remediation.promotionRetestItem])) throw new Error('promotion retest does not match frozen remediation item');
  if (canonicalJson(phases['heldout-retest'].exam.items) !== canonicalJson([selected.item.remediation.heldoutRetestItem])) throw new Error('held-out retest does not match frozen remediation item');
  if (!phases.correction.score.passed || !phases['promotion-retest'].score.passed || !phases['heldout-retest'].score.passed) {
    throw new Error('one or more independently replayed post-baseline gates failed');
  }
  const mistakes = buildMistakes({ exam: phases.baseline.exam, attempts: phases.baseline.attempts, verifierResults: phases.baseline.verifiers });
  const storedMistakes = readJson(path.join(artifactRoot, 'mistakes.json'));
  if (canonicalJson(mistakes) !== canonicalJson(storedMistakes)) throw new Error('mistake reconstruction mismatch');
  const mistake = mistakes.find((row) => row.itemId === selected.item.itemId);
  const candidate = readJson(path.join(artifactRoot, 'lesson_candidate.json'));
  const promotionEvidence = [...phases.correction.verifiers, ...phases['promotion-retest'].verifiers];
  const replayCandidate = distillCandidate({
    capsule,
    mistake,
    lessonTemplate: selected.item.remediation.lessonTemplate,
    supportingResults: promotionEvidence,
    now: candidate.createdAt,
  });
  if (canonicalJson(replayCandidate) !== canonicalJson(candidate)) throw new Error('candidate reconstruction mismatch');
  const replayPromotion = evaluatePromotion({ capsule, candidate, verifierResults: promotionEvidence, now: report.evaluatedAt });
  if (!replayPromotion.promoted) throw new Error('independent promotion recomputation did not pass');
  if (canonicalJson(replayPromotion.promotionProof) !== canonicalJson(report)) throw new Error('promotion report recomputation mismatch');
  if (canonicalJson(replayPromotion.trustedLesson) !== canonicalJson(trusted)) throw new Error('trusted lesson recomputation mismatch');
  if (summary.heldoutRetestPassed !== true || learningOutcome.heldoutRetestItemId !== phases['heldout-retest'].verifiers[0]?.itemId) {
    throw new Error('held-out result linkage mismatch');
  }
  return { baselineFailureItemId: selected.item.itemId };
}

function buildLiveEntry(artifactRoot, profiles) {
  const trustedPath = path.join(artifactRoot, 'trusted_lesson.json');
  const reportPath = path.join(artifactRoot, 'promotion_report.json');
  const summaryPath = path.join(artifactRoot, 'run_summary.json');
  const manifestPath = path.join(artifactRoot, 'artifact_manifest.json');
  const learningOutcomePath = path.join(artifactRoot, 'learning_outcome.json');
  for (const target of [trustedPath, reportPath, summaryPath, manifestPath, learningOutcomePath]) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`required artifact is not a regular file: ${path.basename(target)}`);
  }
  const trusted = readJson(trustedPath);
  const report = readJson(reportPath);
  const summary = readJson(summaryPath);
  const manifest = readJson(manifestPath);
  const learningOutcome = readJson(learningOutcomePath);
  const files = verifyArtifactManifest(artifactRoot, manifest);
  for (const required of ['trusted_lesson.json', 'promotion_report.json', 'run_summary.json', 'learning_outcome.json']) {
    if (!files.has(required)) throw new Error(`artifact manifest omits ${required}`);
  }

  const lessonValidation = validateRecord(trusted);
  const reportValidation = validateRecord(report);
  if (!lessonValidation.ok) throw new Error(`trusted lesson schema invalid: ${lessonValidation.errors.join('; ')}`);
  if (!reportValidation.ok) throw new Error(`promotion report schema invalid: ${reportValidation.errors.join('; ')}`);
  if (!report.promoted || !allGatesPass(report)) throw new Error('promotion report is not a full gate pass');
  if (trusted.candidateId !== report.candidateId || trusted.capsuleId !== report.capsuleId) throw new Error('trusted lesson does not match promotion report');
  if (trusted.promotionProof?.digest !== report.digest) throw new Error('trusted lesson promotion digest does not match report');
  if (trusted.promotionProof?.promoted !== true || !allGatesPass(trusted.promotionProof)) throw new Error('embedded promotion proof is not a full gate pass');
  if (summary.status !== 'green' || summary.learningLoopCompleted !== true || summary.promotedLessonId !== trusted.lessonId) {
    throw new Error('run summary does not prove a completed green learning loop for this lesson');
  }
  independentlyVerifyLearningLoop(artifactRoot, { trusted, report, summary, learningOutcome });
  const allowedCapsules = new Set(splitList(value('--allowed-capsules', 'math-foundations-v0')));
  if (!allowedCapsules.has(trusted.capsuleId)) throw new Error(`capsule is not approved for live math retrieval: ${trusted.capsuleId}`);
  if (Date.parse(trusted.retestAfter) <= Date.now()) throw new Error('trusted lesson is expired');
  const resolvedProfiles = profiles.length === 1 && profiles[0] === 'auto'
    ? inferActivationProfiles(learningOutcome)
    : profiles;
  if (resolvedProfiles.length < 1) throw new Error(`no approved live activation profile maps to baseline failure item: ${String(learningOutcome?.baselineFailureItemId || 'unknown')}`);
  if (resolvedProfiles.some((profile) => !ACTIVATION_PROFILES.has(profile))) throw new Error('one or more activation profiles are invalid');

  const entry = {
    schemaVersion: LESSON_SCHEMA,
    lessonId: trusted.lessonId,
    capsuleId: trusted.capsuleId,
    domain: 'math',
    conceptIds: trusted.conceptIds,
    rule: trusted.rule,
    contraindications: trusted.contraindications,
    promotionProofDigest: report.digest,
    promotedAt: trusted.promotedAt,
    retestAfter: trusted.retestAfter,
    activationProfiles: [...new Set(resolvedProfiles)],
    enabled: true,
    source: {
      runId: summary.runId,
      trustedLessonSha256: sha256File(trustedPath),
      promotionReportSha256: sha256File(reportPath),
      artifactManifestSha256: sha256File(manifestPath),
    },
  };
  const liveValidation = validateLiveLesson(entry);
  if (!liveValidation.ok) throw new Error(`live lesson invalid: ${liveValidation.errors.join('; ')}`);
  return entry;
}

function contentFreeStatus(registry) {
  const now = Date.now();
  return {
    ok: true,
    schemaVersion: registry.schemaVersion,
    registryPath,
    keyId: registry.signature.keyId,
    signatureValid: true,
    revision: registry.revision,
    enabled: registry.enabled,
    updatedAt: registry.updatedAt,
    lessonCount: registry.lessons.length,
    activeLessonCount: registry.lessons.filter((lesson) => lesson.enabled && Date.parse(lesson.retestAfter) > now).length,
    lessons: registry.lessons.map((lesson) => ({
      lessonId: lesson.lessonId,
      capsuleId: lesson.capsuleId,
      domain: lesson.domain,
      conceptIds: lesson.conceptIds,
      activationProfiles: lesson.activationProfiles,
      enabled: lesson.enabled,
      promotedAt: lesson.promotedAt,
      retestAfter: lesson.retestAfter,
      expired: Date.parse(lesson.retestAfter) <= now,
      promotionProofDigest: lesson.promotionProofDigest,
      runId: lesson.source.runId,
    })),
    truthBoundary: 'Status proves signed-registry integrity and lesson activation state; it does not prove that any particular answer improved.',
  };
}

try {
  if (command === 'init') {
    const { registry } = initializeRegistry({ registryPath, secretPath, force: has('--force') });
    console.log(JSON.stringify({ ...contentFreeStatus(registry), initialized: true, secretPath }, null, 2));
  } else {
    const secret = readRegistrySecret(secretPath);
    const registry = loadSignedRegistry(registryPath, secret, { allowExpiredLessons: true });
    if (command === 'status' || command === 'verify') {
      console.log(JSON.stringify(contentFreeStatus(registry), null, 2));
    } else if (command === 'install') {
      const artifactRoot = path.resolve(value('--artifact-root', ''));
      if (!value('--artifact-root')) throw new Error('--artifact-root is required');
      const profiles = splitList(value('--profiles', ''));
      const entry = buildLiveEntry(artifactRoot, profiles);
      const now = new Date().toISOString();
      const deduplicated = deduplicateLiveLessons([
        ...registry.lessons.filter((lesson) => lesson.lessonId !== entry.lessonId),
        entry,
      ]);
      const semanticKey = liveLessonSemanticKey(entry);
      const activeEntry = deduplicated.lessons.find((lesson) => liveLessonSemanticKey(lesson) === semanticKey);
      if (!activeEntry) throw new Error('installed lesson was lost during semantic deduplication');
      const updated = atomicWriteSignedRegistry(registryPath, {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: now,
        lessons: deduplicated.lessons,
      }, secret);
      console.log(JSON.stringify({
        ...contentFreeStatus(updated),
        installedLessonId: activeEntry.lessonId,
        candidateLessonId: entry.lessonId,
        semanticKey,
        deduplicatedLessonIds: deduplicated.removedLessonIds,
      }, null, 2));
    } else if (command === 'deduplicate') {
      const deduplicated = deduplicateLiveLessons(registry.lessons);
      if (deduplicated.removedLessonIds.length === 0) {
        console.log(JSON.stringify({ ...contentFreeStatus(registry), deduplicatedLessonIds: [], changed: false }, null, 2));
      } else {
        const updated = atomicWriteSignedRegistry(registryPath, {
          ...registry,
          revision: registry.revision + 1,
          updatedAt: new Date().toISOString(),
          lessons: deduplicated.lessons,
        }, secret);
        console.log(JSON.stringify({
          ...contentFreeStatus(updated),
          deduplicatedLessonIds: deduplicated.removedLessonIds,
          changed: true,
        }, null, 2));
      }
    } else if (command === 'disable' || command === 'enable') {
      const lessonId = value('--lesson-id');
      if (!lessonId) throw new Error('--lesson-id is required');
      let found = false;
      const lessons = registry.lessons.map((lesson) => {
        if (lesson.lessonId !== lessonId) return lesson;
        found = true;
        return { ...lesson, enabled: command === 'enable' };
      });
      if (!found) throw new Error(`lesson not found: ${lessonId}`);
      const updated = atomicWriteSignedRegistry(registryPath, {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: new Date().toISOString(),
        lessons,
      }, secret);
      console.log(JSON.stringify({ ...contentFreeStatus(updated), changedLessonId: lessonId, lessonEnabled: command === 'enable' }, null, 2));
    } else if (command === 'registry-enable' || command === 'registry-disable') {
      const updated = atomicWriteSignedRegistry(registryPath, {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: new Date().toISOString(),
        enabled: command === 'registry-enable',
      }, secret);
      console.log(JSON.stringify({ ...contentFreeStatus(updated), registryEnabled: updated.enabled }, null, 2));
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  }
} catch (error) {
  fail(error.message, { registryPath, secretPath });
}
