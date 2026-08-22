import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkAnswer } from './checkers.mjs';
import { SCHEMAS, validateRecord } from './contracts.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { writeJson } from './json.mjs';

function id(prefix, value) {
  return `${prefix}_${sha256Text(value).slice(0, 16)}`;
}

export function gradeExam({ capsule, exam, answerSet, runId, now = new Date().toISOString(), evidencePrefix = '.' } = {}) {
  const contractErrors = [validateRecord(capsule), validateRecord(exam)].flatMap((result) => result.errors || []);
  if (contractErrors.length) throw new Error(`invalid exam inputs: ${contractErrors.join('; ')}`);
  if (exam.capsuleId !== capsule.capsuleId) throw new Error('exam capsuleId does not match capsule');
  const answers = new Map((answerSet?.answers || []).map((row) => [row.itemId, row.answer]));
  const answerSource = answerSet?.answerSource || { kind: 'unknown' };
  const attempts = [];
  const verifierResults = [];
  for (const item of exam.items) {
    const answer = answers.has(item.itemId) ? answers.get(item.itemId) : '';
    const attemptId = id('attempt', `${runId}:${exam.examId}:${item.itemId}`);
    const attempt = {
      schemaVersion: SCHEMAS.attempt,
      attemptId,
      runId,
      capsuleId: capsule.capsuleId,
      examId: exam.examId,
      itemId: item.itemId,
      conceptIds: item.conceptIds,
      promptDigest: sha256Text(item.prompt),
      answer,
      answerSource,
      toolsUsed: answerSet?.toolsUsed || [],
      startedAt: answerSet?.startedAt || now,
      completedAt: answerSet?.completedAt || now
    };
    const checked = checkAnswer(answer, item.checker);
    const verifierResultId = id('verify', `${attemptId}:${JSON.stringify(item.checker)}`);
    const verifier = {
      schemaVersion: SCHEMAS.verifierResult,
      verifierResultId,
      attemptId,
      examId: exam.examId,
      itemId: item.itemId,
      conceptIds: item.conceptIds,
      verifierId: `deterministic:${item.checker.mode}:v0`,
      status: answer === '' ? 'error' : checked.status,
      score: checked.passed ? 1 : 0,
      reproducible: true,
      observed: checked.observed,
      failureReason: answer === '' ? 'missing answer' : checked.reason,
      evidenceRole: answerSet?.evidenceRole || 'exam',
      evidence: [`${evidencePrefix}/verifier_results.json#${verifierResultId}`]
    };
    const validation = [validateRecord(attempt), validateRecord(verifier)].flatMap((result) => result.errors || []);
    if (validation.length) throw new Error(`generated invalid records for ${item.itemId}: ${validation.join('; ')}`);
    attempts.push(attempt);
    verifierResults.push(verifier);
  }
  const earned = verifierResults.reduce((sum, result) => sum + result.score, 0);
  const score = verifierResults.length ? earned / verifierResults.length : 0;
  return {
    attempts,
    verifierResults,
    summary: {
      schemaVersion: 'cortex.learning_os.exam_run_summary.v0',
      runId,
      capsuleId: capsule.capsuleId,
      examId: exam.examId,
      generatedAt: now,
      itemCount: exam.items.length,
      passedItemCount: earned,
      failedItemCount: verifierResults.filter((result) => result.status === 'failed').length,
      errorItemCount: verifierResults.filter((result) => result.status === 'error').length,
      score: Number(score.toFixed(6)),
      passThreshold: exam.passThreshold,
      passed: score >= exam.passThreshold && verifierResults.every((result) => result.status !== 'error'),
      truthBoundary: 'This score applies only to the named deterministic exam and recorded answer set.'
    }
  };
}

export function writeExamRun({ capsule, exam, answerSet, runId, outputDir, now = new Date().toISOString(), command = null } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const graded = gradeExam({ capsule, exam, answerSet, runId, now });
  const files = {
    exam: writeJson(path.join(outputDir, 'exam.json'), exam),
    answers: writeJson(path.join(outputDir, 'answers.json'), answerSet),
    attempts: writeJson(path.join(outputDir, 'attempts.json'), graded.attempts),
    verifiers: writeJson(path.join(outputDir, 'verifier_results.json'), graded.verifierResults),
    summary: writeJson(path.join(outputDir, 'score_summary.json'), graded.summary)
  };
  const manifest = {
    schemaVersion: SCHEMAS.runManifest,
    runId,
    generatedAt: now,
    files: Object.values(files).map((file) => ({ path: path.relative(outputDir, file), sha256: sha256File(file) })),
    commands: command ? [command] : [],
    truthBoundary: graded.summary.truthBoundary
  };
  files.manifest = writeJson(path.join(outputDir, 'artifact_manifest.json'), manifest);
  return { ...graded, files, manifest };
}
