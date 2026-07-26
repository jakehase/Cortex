#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCodexExam } from './model-answer-runner.mjs';
import { writeJson } from './json.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const output = path.resolve(value('--out') || `/tmp/clos-novel-math-canary-${Date.now()}.json`);
const model = value('--model') || 'gpt-5.6-sol';
const thinking = value('--thinking') || 'low';
const codexCommand = value('--codex-command') || 'codex';
const timeoutSeconds = Number(value('--timeout') || 240);
const canaryId = `novel-math-canary-${crypto.randomBytes(8).toString('hex')}`;
const expected = '(09,13)';
const exam = {
  schemaVersion: 'cortex.learning_os.exam.v0',
  examId: `${canaryId}-exam`,
  capsuleId: `${canaryId}-capsule`,
  version: '0.1.0',
  title: 'Novel-math execution-plane canary',
  passThreshold: 1,
  allowedTools: [],
  items: [{
    itemId: 'canary-item',
    prompt: 'In private invented system Rhovek-CANARY, evaluate ρ(7,4). Return only (NN,NN).',
    conceptIds: ['rhovek-canary'],
    answerFormat: '(NN,NN)',
    checker: { mode: 'exact_string', expected, caseSensitive: true }
  }],
  truthBoundary: 'Execution-plane canary only; not benchmark efficacy evidence.'
};
const context = 'Rhovek-CANARY is private and invented. Define ρ(a,b)=((5a+3b+8) mod 23,(2b+6a+1) mod 19). Normalize to nonnegative residues and return (NN,NN), zero-padded.';
const arms = [
  { arm: 'no_pack', learningContext: null },
  { arm: 'pack', learningContext: context }
];
const results = [];
try {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  for (const row of arms) {
    const run = runCodexExam({
      exam,
      sessionId: `${canaryId}-${row.arm}`,
      runId: `${canaryId}-${row.arm}`,
      learningContext: row.learningContext,
      evidenceRole: `canary_${row.arm}`,
      timeoutSeconds,
      thinking,
      model,
      codexCommand
    });
    const answer = run.answerSet.answers.length === 1 && run.answerSet.answers[0].itemId === 'canary-item'
      ? String(run.answerSet.answers[0].answer).trim()
      : null;
    const rawPath = output.replace(/\.json$/, `-${row.arm}-model-call.json`);
    writeJson(rawPath, run.raw);
    results.push({
      arm: row.arm,
      valid: answer !== null && run.toolEvents.length === 0,
      passed: answer === expected,
      answer,
      expected,
      observedToolEventCount: run.toolEvents.length,
      provider: run.answerSet.answerSource.provider,
      model: run.answerSet.answerSource.model,
      usage: run.answerSet.answerSource.usage,
      startedAt: run.answerSet.startedAt,
      completedAt: run.answerSet.completedAt,
      rawPath
    });
  }
  const noPack = results.find((row) => row.arm === 'no_pack');
  const pack = results.find((row) => row.arm === 'pack');
  const canaryPass = results.every((row) => row.valid) && !noPack.passed && pack.passed;
  const report = {
    schemaVersion: 'cortex.learning_os.novel_math_canary.v0',
    canaryId,
    generatedAt: new Date().toISOString(),
    canaryPass,
    results,
    truthBoundary: canaryPass
      ? 'The remote worker was tool-free, had no-context headroom, and applied one supplied invented rule. This is runtime readiness only, not benchmark efficacy.'
      : 'The execution-plane canary failed; do not launch the expensive benchmark until the runtime issue is resolved.'
  };
  writeJson(output, report);
  console.log(JSON.stringify(report, null, 2));
  if (!canaryPass) process.exitCode = 1;
} catch (error) {
  const report = {
    schemaVersion: 'cortex.learning_os.novel_math_canary.v0',
    canaryId,
    generatedAt: new Date().toISOString(),
    canaryPass: false,
    error: error.message,
    results,
    truthBoundary: 'The execution-plane canary failed mechanically; do not launch the expensive benchmark.'
  };
  writeJson(output, report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
