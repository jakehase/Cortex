import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLOS_ROOT } from '../src/paths.mjs';
import { validateRecord } from '../src/contracts.mjs';
import { checkAnswer } from '../src/checkers.mjs';
import { gradeExam } from '../src/exam-runner.mjs';
import { buildMistakes, distillCandidate, selectRemediableFailure } from '../src/learning-loop.mjs';
import { evaluatePromotion } from '../src/promotion.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, rel), 'utf8'));
const capsule = read('capsules/math-foundations/capsule.json');
const curriculum = read('capsules/math-foundations/curriculum.graph.json');
const baseline = read('exams/math-foundations/baseline.exam.json');
const challenge = read('exams/math-foundations/reliability-challenge.exam.json');

function oneItemExam(examId, item) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0', examId, capsuleId: capsule.capsuleId,
    version: '0.1.0', title: examId, passThreshold: 1, allowedTools: [], items: [item],
    truthBoundary: 'One-item deterministic test fixture.'
  };
}

function answers(item, answer, evidenceRole) {
  return {
    answers: [{ itemId: item.itemId, answer }], answerSource: { kind: 'test_fixture' },
    toolsUsed: [], evidenceRole, startedAt: '2026-07-25T05:00:00.000Z', completedAt: '2026-07-25T05:00:01.000Z'
  };
}

test('math-foundations capsule has a valid 30-item exam and a connected 30+ concept curriculum', () => {
  assert.equal(validateRecord(capsule).ok, true);
  assert.equal(validateRecord(curriculum).ok, true);
  assert.equal(validateRecord(baseline).ok, true);
  assert.equal(curriculum.concepts.length >= 30, true);
  assert.equal(baseline.items.length >= 20 && baseline.items.length <= 30, true);
  const concepts = new Set(curriculum.concepts.map((row) => row.conceptId));
  for (const concept of curriculum.concepts) {
    for (const prerequisite of concept.prerequisites) assert.equal(concepts.has(prerequisite), true, prerequisite);
  }
  for (const item of baseline.items) {
    for (const conceptId of item.conceptIds) assert.equal(concepts.has(conceptId), true, `${item.itemId}:${conceptId}`);
    assert.ok(item.remediation?.correctionItem);
    assert.ok(item.remediation?.promotionRetestItem);
    assert.ok(item.remediation?.heldoutRetestItem);
  }
  const trustedPath = path.join(CLOS_ROOT, 'capsules/math-foundations/trusted_lessons.json');
  if (fs.existsSync(trustedPath)) {
    const trusted = JSON.parse(fs.readFileSync(trustedPath, 'utf8'));
    assert.equal(trusted.length > 0, true);
    for (const lesson of trusted) assert.equal(validateRecord(lesson).ok, true);
    assert.equal(typeof capsule.lastQualifiedRun, 'string');
  }
});

test('challenge verifier fixtures preserve known derangement values', () => {
  const item = challenge.items.find((row) => row.itemId === 'mfc-15');
  assert.equal(item.checker.expected, 1334961);
  assert.equal(item.remediation.correctionItem.checker.expected, 265);
  assert.equal(item.remediation.promotionRetestItem.checker.expected, 14833);
  assert.equal(item.remediation.heldoutRetestItem.checker.expected, 133496);
});

test('deterministic checkers handle fractions, tolerance, and unordered sets', () => {
  assert.equal(checkAnswer('1/3', { mode: 'numeric_tolerance', expected: 1 / 3, tolerance: 1e-9 }).passed, true);
  assert.equal(checkAnswer('3, -1/2', { mode: 'set_equality', expected: ['-0.5', '3'] }).passed, true);
  assert.equal(checkAnswer('B', { mode: 'multiple_choice', expected: 'b' }).passed, true);
  assert.equal(checkAnswer('0.30', { mode: 'exact_number', expected: 0.3 }).passed, true);
  assert.equal(checkAnswer('144,437,219,165,251,850,484', { mode: 'exact_integer_string', expected: '144437219165251850484' }).passed, true);
  assert.equal(checkAnswer('144437219165251850485', { mode: 'exact_integer_string', expected: '144437219165251850484' }).passed, false);
});

test('a failing attempt can become a promoted lesson only after correction and independent retest', () => {
  const sourceItem = baseline.items[0];
  const baselineExam = oneItemExam('math-foundations-baseline-v0', sourceItem);
  const failed = gradeExam({ capsule, exam: baselineExam, answerSet: answers(sourceItem, '0', 'baseline'), runId: 'failed-baseline' });
  const selected = selectRemediableFailure({ exam: baselineExam, verifierResults: failed.verifierResults });
  assert.equal(selected.item.itemId, sourceItem.itemId);
  const mistakes = buildMistakes({ exam: baselineExam, attempts: failed.attempts, verifierResults: failed.verifierResults });
  assert.equal(mistakes.length, 1);

  const correctionItem = sourceItem.remediation.correctionItem;
  const retestItem = sourceItem.remediation.promotionRetestItem;
  const correction = gradeExam({
    capsule,
    exam: oneItemExam('math-foundations-correction-v0', correctionItem),
    answerSet: answers(correctionItem, correctionItem.checker.expected, 'correction'),
    runId: 'correction'
  });
  const retest = gradeExam({
    capsule,
    exam: oneItemExam('math-foundations-promotion-retest-v0', retestItem),
    answerSet: answers(retestItem, retestItem.checker.expected, 'retest'),
    runId: 'retest'
  });
  const evidence = [...correction.verifierResults, ...retest.verifierResults];
  const candidate = distillCandidate({ capsule, mistake: mistakes[0], lessonTemplate: sourceItem.remediation.lessonTemplate, supportingResults: evidence });
  const beforeRetest = evaluatePromotion({ capsule, candidate: { ...candidate, supportingEvidenceIds: [evidence[0].verifierResultId], sourceExamIds: [evidence[0].examId], requiredRetestIds: [retestItem.itemId] }, verifierResults: evidence });
  assert.equal(beforeRetest.promoted, false);
  const promotion = evaluatePromotion({ capsule, candidate, verifierResults: evidence, now: '2026-07-25T05:10:00.000Z' });
  assert.equal(promotion.promoted, true);
  assert.equal(validateRecord(promotion.trustedLesson).ok, true);
});
