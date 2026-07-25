import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLOS_ROOT } from '../src/paths.mjs';
import { SCHEMAS, validateRecord } from '../src/contracts.mjs';
import { evaluatePromotion } from '../src/promotion.mjs';
import { buildCapabilityReport, buildRetrievalPack } from '../src/retrieval-pack.mjs';

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, 'fixtures/valid', name), 'utf8'));
const capsule = fixture('capsule.json');
const candidate = fixture('lesson-candidate.json');
const result = (id, examId, itemId, evidenceRole = 'correction') => ({
  schemaVersion: SCHEMAS.verifierResult,
  verifierResultId: id,
  attemptId: `attempt-${id}`,
  examId,
  itemId,
  verifierId: 'deterministic',
  status: 'passed',
  score: 1,
  reproducible: true,
  evidenceRole,
  evidence: [`artifacts/${examId}.json`]
});
const passingResults = () => [
  result('verify-algebra-1', 'algebra-baseline', 'algebra-correction-item'),
  result('verify-probability-1', 'probability-baseline', 'probability-retest-item', 'retest')
];

test('fixtures enforce valid and invalid Learning Capsule records', () => {
  assert.equal(validateRecord(capsule).ok, true);
  assert.equal(validateRecord(JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, 'fixtures/invalid/untrusted-lesson.json'), 'utf8'))).ok, false);
  const run = spawnSync(process.execPath, ['src/validate-fixtures.mjs'], { cwd: CLOS_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).ok, true);
});

test('promotion fails closed without enough independent evidence', () => {
  const promotion = evaluatePromotion({ capsule, candidate, verifierResults: passingResults().slice(0, 1) });
  assert.equal(promotion.promoted, false);
  assert.equal(promotion.trustedLesson, null);
});

test('promotion fails closed when evidence does not cover distinct declared exams', () => {
  const duplicateExamResults = [
    result('verify-algebra-1', 'algebra-baseline', 'algebra-correction-item'),
    result('verify-probability-1', 'algebra-baseline', 'probability-retest-item', 'retest')
  ];
  const promotion = evaluatePromotion({ capsule, candidate, verifierResults: duplicateExamResults });
  assert.equal(promotion.promoted, false);
  assert.equal(promotion.promotionProof.gates.distinctExamCoverage, false);
});

test('promotion fails closed without a passed declared retest', () => {
  const noRetest = passingResults().map((row) => ({ ...row, evidenceRole: 'correction' }));
  const promotion = evaluatePromotion({ capsule, candidate, verifierResults: noRetest });
  assert.equal(promotion.promoted, false);
  assert.equal(promotion.promotionProof.gates.requiredRetestPassed, false);
});

test('promotion creates a replayable trusted lesson only after every gate passes', () => {
  const promotion = evaluatePromotion({ capsule, candidate, verifierResults: passingResults(), now: '2026-07-09T19:00:00.000Z' });
  assert.equal(promotion.promoted, true);
  assert.equal(validateRecord(promotion.trustedLesson).ok, true);
  assert.equal(validateRecord(promotion.promotionProof).ok, true);
  assert.equal(promotion.trustedLesson.promotionProof.gates.contradictionFree, true);
});

test('retrieval packs omit candidates, enforce token bounds, and capability reports reject mastery', () => {
  const trustedLesson = evaluatePromotion({ capsule, candidate, verifierResults: passingResults(), now: '2026-07-09T19:00:00.000Z' }).trustedLesson;
  const pack = buildRetrievalPack({ capsule, task: 'factor an algebraic expression', conceptIds: ['algebra-factoring'], trustedLessons: [trustedLesson], candidateLessons: [candidate], now: '2026-07-10T00:00:00.000Z', maxTokens: 400 });
  assert.deepEqual(pack.trustedLessonIds, [trustedLesson.lessonId]);
  assert.equal(pack.omittedUntrustedCount, 1);
  assert.equal(pack.estimatedTokens <= pack.maxTokens, true);
  const report = buildCapabilityReport({ capsule, examRuns: [{ examId: 'algebra-baseline', runId: 'one', score: 1, passed: true, itemCount: 1 }] });
  assert.equal(report.rejectedClaims.includes('general_domain_mastery'), true);
});

test('promotion CLI writes replayable proof, trusted lesson, retrieval pack, and bounded capability report', () => {
  const out = fs.mkdtempSync(path.join(CLOS_ROOT, 'artifacts/test-promotion-'));
  const run = spawnSync(process.execPath, [
    'src/run-promotion.mjs',
    '--capsule', 'fixtures/valid/capsule.json',
    '--candidate', 'fixtures/valid/lesson-candidate.json',
    '--verifiers', 'fixtures/valid/verifier-results.json',
    '--task', 'factor an algebraic expression safely',
    '--out', out,
    '--now', '2026-07-09T19:00:00.000Z'
  ], { cwd: CLOS_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.promoted, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'capability_report.json'))).rejectedClaims.includes('general_domain_mastery'), true);
  for (const name of ['promotion_proof.json', 'trusted_lesson.json', 'retrieval_pack.json', 'capability_report.json', 'artifact_manifest.json']) {
    assert.equal(fs.existsSync(path.join(out, name)), true, name);
  }
  fs.rmSync(out, { recursive: true, force: true });
});
