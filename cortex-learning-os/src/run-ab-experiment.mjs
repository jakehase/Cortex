#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildPairedExperiment, analyzePairedExperiment } from './ab-experiment.mjs';
import { runCodexExam } from './model-answer-runner.mjs';
import { writeExamRun } from './exam-runner.mjs';
import { buildRetrievalPack } from './retrieval-pack.mjs';
import { sha256File } from './hash.mjs';
import { readJson, writeJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const has = (flag) => args.includes(flag);
const compactTimestamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const experimentId = value('--experiment-id') || `math-foundations-ab-${compactTimestamp()}`;
const seedArgument = value('--seed');
const pairCountArgument = value('--pairs');
const modelArgument = value('--model');
const thinkingArgument = value('--thinking');
let seed = seedArgument || crypto.randomBytes(24).toString('hex');
let pairCount = Number(pairCountArgument || 27);
let model = modelArgument || 'gpt-5.6-sol';
let thinking = thinkingArgument || 'low';
const timeoutSeconds = Number(value('--timeout') || 240);
const artifactRoot = path.resolve(value('--artifact-root') || path.join(CLOS_ROOT, 'artifacts', experimentId));
const planOnly = has('--plan-only');
const resume = has('--resume');
const command = process.argv.map((part) => JSON.stringify(part)).join(' ');
const experimentPath = path.join(artifactRoot, 'experiment.json');
const statePath = path.join(artifactRoot, 'campaign_state.json');
const trialsRoot = path.join(artifactRoot, 'trials');
const capsule = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/capsule.json'));
const trustedLessons = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/trusted_lessons.json'), []);

function state(status, extra = {}) {
  const payload = {
    schemaVersion: 'cortex.learning_os.ab_campaign_state.v0',
    experimentId,
    status,
    updatedAt: new Date().toISOString(),
    artifactRoot,
    terminal: ['completed', 'blocked'].includes(status),
    ...extra
  };
  writeJson(statePath, payload);
  return payload;
}

function oneItemExam(item) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0',
    examId: `${experimentId}-${item.itemId}-v0`,
    capsuleId: capsule.capsuleId,
    version: '0.1.0',
    title: 'Math Foundations Randomized Paired A/B Item',
    passThreshold: 1,
    allowedTools: [],
    items: [item],
    truthBoundary: 'This one-item exam is one member of a preregistered paired exact-multiplication experiment.'
  };
}

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function completedTrial(trialDir) {
  const result = readJson(path.join(trialDir, 'trial_result.json'));
  return result?.schemaVersion === 'cortex.learning_os.ab_trial_result.v0' ? result : null;
}

fs.mkdirSync(trialsRoot, { recursive: true });
let experiment;
if (fs.existsSync(experimentPath)) {
  if (!resume && !planOnly) throw new Error(`artifact root already contains an experiment; use --resume to continue without rerunning completed trials: ${artifactRoot}`);
  experiment = readJson(experimentPath);
  if (experiment.experimentId !== experimentId) throw new Error('existing experimentId does not match --experiment-id');
  const mismatches = [
    seedArgument && experiment.seed !== seedArgument ? '--seed' : null,
    pairCountArgument && experiment.design?.pairCount !== pairCount ? '--pairs' : null,
    modelArgument && experiment.runtime?.model !== modelArgument ? '--model' : null,
    thinkingArgument && experiment.runtime?.thinking !== thinkingArgument ? '--thinking' : null
  ].filter(Boolean);
  if (mismatches.length) throw new Error(`resume arguments conflict with frozen experiment: ${mismatches.join(', ')}`);
  seed = experiment.seed;
  pairCount = experiment.design.pairCount;
  model = experiment.runtime.model;
  thinking = experiment.runtime.thinking;
} else {
  experiment = buildPairedExperiment({ experimentId, seed, pairCount, model, thinking });
  writeJson(experimentPath, experiment);
}

if (planOnly) {
  state('preregistered', { phase: 'plan_only', completedTrials: 0, totalTrials: experiment.schedule.length });
  console.log(JSON.stringify({ ok: true, planOnly: true, artifactRoot, experimentPath, experiment }, null, 2));
  process.exit(0);
}

const itemByPair = new Map(experiment.items.map((item) => [item.pairId, item]));
const results = [];
try {
  for (const scheduled of experiment.schedule) {
    const trialId = `${experimentId}-trial-${String(scheduled.ordinal).padStart(3, '0')}`;
    const trialDir = path.join(trialsRoot, `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.pairId}-${scheduled.arm}`);
    fs.mkdirSync(trialDir, { recursive: true });
    const existing = completedTrial(trialDir);
    if (existing) {
      results.push(existing);
      continue;
    }
    state('running', {
      phase: 'model_trials',
      activeTrial: { trialId, ordinal: scheduled.ordinal, pairId: scheduled.pairId, arm: scheduled.arm },
      completedTrials: results.length,
      totalTrials: experiment.schedule.length
    });
    const item = itemByPair.get(scheduled.pairId);
    const exam = oneItemExam(item);
    const retrievalPack = scheduled.arm === 'pack' ? buildRetrievalPack({
      capsule,
      task: item.prompt,
      conceptIds: item.conceptIds,
      trustedLessons,
      candidateLessons: [],
      mistakeWarnings: [],
      now: experiment.generatedAt,
      maxTokens: 900
    }) : null;
    if (retrievalPack) writeJson(path.join(trialDir, 'retrieval_pack.json'), retrievalPack);
    let result;
    try {
      const modelRun = runCodexExam({
        exam,
        sessionId: scheduled.sessionId,
        runId: trialId,
        learningContext: retrievalPack ? JSON.stringify(retrievalPack) : null,
        evidenceRole: `paired_ab_${scheduled.arm}`,
        timeoutSeconds,
        thinking,
        model
      });
      writeJson(path.join(trialDir, 'model_call.json'), modelRun.raw);
      fs.writeFileSync(path.join(trialDir, 'model_prompt.txt'), `${modelRun.prompt}\n`);
      const answerShapeValid = modelRun.answerSet.answers.length === 1 && modelRun.answerSet.answers[0].itemId === item.itemId;
      const graded = writeExamRun({
        capsule,
        exam,
        answerSet: modelRun.answerSet,
        runId: trialId,
        outputDir: trialDir,
        command: `codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --model ${model}`
      });
      const invalidReasons = [];
      if (!answerShapeValid) invalidReasons.push('answer_shape_or_item_id_mismatch');
      if (modelRun.toolEvents.length) invalidReasons.push('observed_tool_event');
      result = {
        schemaVersion: 'cortex.learning_os.ab_trial_result.v0',
        trialId,
        ordinal: scheduled.ordinal,
        pairId: scheduled.pairId,
        arm: scheduled.arm,
        sessionId: scheduled.sessionId,
        valid: invalidReasons.length === 0,
        invalidReasons,
        passed: graded.summary.passed,
        score: graded.summary.score,
        observedToolEventCount: modelRun.toolEvents.length,
        provider: modelRun.answerSet.answerSource.provider,
        model: modelRun.answerSet.answerSource.model,
        usage: modelRun.answerSet.answerSource.usage,
        startedAt: modelRun.answerSet.startedAt,
        completedAt: modelRun.answerSet.completedAt,
        evidenceRefs: [path.relative(artifactRoot, graded.files.summary), path.relative(artifactRoot, path.join(trialDir, 'model_call.json'))],
        truthBoundary: 'This result applies only to one preregistered arm/item/session. Invalid trials receive no capability credit and are never outcome-rerun.'
      };
    } catch (error) {
      if (error.workerRaw) writeJson(path.join(trialDir, 'model_call.json'), error.workerRaw);
      result = {
        schemaVersion: 'cortex.learning_os.ab_trial_result.v0',
        trialId,
        ordinal: scheduled.ordinal,
        pairId: scheduled.pairId,
        arm: scheduled.arm,
        sessionId: scheduled.sessionId,
        valid: false,
        invalidReasons: ['worker_or_response_error'],
        passed: false,
        score: 0,
        observedToolEventCount: error.workerRaw ? (error.workerRaw.events || []).filter((event) => event?.item?.type === 'command_execution').length : 0,
        provider: 'openai-codex',
        model,
        usage: null,
        startedAt: null,
        completedAt: new Date().toISOString(),
        error: error.message,
        evidenceRefs: error.workerRaw ? [path.relative(artifactRoot, path.join(trialDir, 'model_call.json'))] : [],
        truthBoundary: 'The worker/response failed mechanically. This invalid trial receives no capability credit and is never outcome-rerun.'
      };
    }
    writeJson(path.join(trialDir, 'trial_result.json'), result);
    results.push(result);
  }

  state('running', { phase: 'analysis', completedTrials: results.length, totalTrials: experiment.schedule.length });
  const analysis = analyzePairedExperiment({ experiment, trials: results });
  writeJson(path.join(artifactRoot, 'trial_results.json'), results.sort((a, b) => a.ordinal - b.ordinal));
  writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
  const manifestFiles = allFiles(artifactRoot)
    .filter((file) => !file.endsWith('artifact_manifest.json') && file !== statePath)
    .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0',
    runId: experimentId,
    generatedAt: new Date().toISOString(),
    files: manifestFiles,
    commands: [command],
    truthBoundary: analysis.truthBoundary
  });
  state('completed', {
    phase: 'terminal',
    completedTrials: results.length,
    totalTrials: experiment.schedule.length,
    mechanicalGreen: results.length === experiment.schedule.length,
    thresholdPass: analysis.boundedCausalEvidence,
    analysisPath: path.join(artifactRoot, 'analysis.json'),
    allowedClaims: analysis.allowedClaims,
    rejectedClaims: analysis.rejectedClaims,
    truthBoundary: analysis.truthBoundary
  });
  console.log(JSON.stringify({ ok: true, artifactRoot, analysis }, null, 2));
} catch (error) {
  const blocker = {
    schemaVersion: 'cortex.learning_os.blocker.v0',
    experimentId,
    generatedAt: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    completedTrials: results.length,
    truthBoundary: 'The experiment did not complete mechanically; no retrieval-benefit or learning claim is allowed.'
  };
  writeJson(path.join(artifactRoot, 'blocker.json'), blocker);
  state('blocked', { phase: 'terminal', completedTrials: results.length, totalTrials: experiment.schedule.length, blockerPath: path.join(artifactRoot, 'blocker.json'), truthBoundary: blocker.truthBoundary });
  console.error(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exitCode = 1;
}
