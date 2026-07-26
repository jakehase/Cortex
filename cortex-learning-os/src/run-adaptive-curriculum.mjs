#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { loadAdaptivePolicy } from './adaptive-policy.mjs';
import { runAdaptiveSession } from './adaptive-session.mjs';
import { readJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { runCodexExam } from './model-answer-runner.mjs';
import { runCodexCandidate } from './model-candidate.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const planPath = path.resolve(value('--plan', ''));
const artifactRoot = path.resolve(value('--artifact-root', ''));
const codexCommand = value('--codex-command', 'codex');
const model = value('--model', 'gpt-5.6-sol');
const thinking = value('--thinking', 'low');
const sourceCommit = value('--source-commit', process.env.CLOS_SOURCE_COMMIT || '');
if (!value('--plan') || !value('--artifact-root')) throw new Error('--plan and --artifact-root are required');
if (!fs.existsSync(planPath)) throw new Error('adaptive plan does not exist');
const plan = readJson(planPath);
if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('adaptive plan is unreadable or invalid JSON');
if (model !== plan.modelRuntime?.model || thinking !== plan.modelRuntime?.thinking) throw new Error('runtime model/reasoning differs from the signed adaptive plan');
const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
const capsule = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/capsule.json'));
const { policy } = loadAdaptivePolicy();
const fixedTemplates = ['baseline.exam.json', 'reliability-challenge.exam.json', 'exact-arithmetic-stress.exam.json']
  .flatMap((name) => readJson(path.join(CLOS_ROOT, 'exams/math-foundations', name))?.items || [])
  .map((item) => item.remediation?.lessonTemplate?.rule)
  .filter(Boolean);

const summary = runAdaptiveSession({
  plan,
  graph,
  policy,
  capsule,
  artifactRoot,
  sourceCommit,
  fixedTemplates,
  callExam: (options) => runCodexExam({ ...options, codexCommand, model, thinking, timeoutSeconds: 240 }),
  callCandidate: (options) => runCodexCandidate({ ...options, codexCommand, model, thinking, timeoutSeconds: 240 }),
});
console.log(JSON.stringify({ ok: summary.status !== 'structured_blocker', artifactRoot, summary }, null, 2));
if (summary.status === 'structured_blocker') process.exitCode = 4;
