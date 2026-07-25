#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeExamRun } from './exam-runner.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const capsulePath = value('--capsule');
const examPath = value('--exam');
const answersPath = value('--answers');
const out = value('--out');
const runId = value('--run-id') || `exam-${Date.now()}`;
const now = value('--now') || new Date().toISOString();
if (!capsulePath || !examPath || !answersPath || !out) {
  console.error('usage: run-exam.mjs --capsule FILE --exam FILE --answers FILE --out DIR [--run-id ID] [--now ISO]');
  process.exit(2);
}
const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const result = writeExamRun({
  capsule: read(capsulePath),
  exam: read(examPath),
  answerSet: read(answersPath),
  runId,
  outputDir: path.resolve(out),
  now,
  command: process.argv.map((part) => JSON.stringify(part)).join(' ')
});
console.log(JSON.stringify({ ok: true, summary: result.summary, files: result.files }, null, 2));
if (!result.summary.passed) process.exitCode = 1;
