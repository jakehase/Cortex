#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildPrivateUtilityProgram, analyzePrivateUtilityCalibration, analyzePrivateUtilityHoldout } from './private-utility-experiment.mjs';
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
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const validationId = value('--validation-id') || `clos-private-utility-${compactTimestamp()}`;
const seedArgument = value('--seed');
const modelArgument = value('--model');
const thinkingArgument = value('--thinking');
const calibrationFixtureArgument = value('--calibration-fixture');
const holdoutFixtureArgument = value('--holdout-fixture');
let seed = seedArgument || crypto.randomBytes(32).toString('hex');
let model = modelArgument || 'gpt-5.6-sol';
let thinking = thinkingArgument || 'low';
const timeoutSeconds = Number(value('--timeout') || 240);
const artifactRoot = path.resolve(value('--artifact-root') || path.join(CLOS_ROOT, 'artifacts', validationId));
const planOnly = has('--plan-only');
const resume = has('--resume');
const command = process.argv.map((part) => JSON.stringify(part)).join(' ');
const programPath = path.join(artifactRoot, 'program.json');
const statePath = path.join(artifactRoot, 'campaign_state.json');
const calibrationRoot = path.join(artifactRoot, 'calibration');
const holdoutRoot = path.join(artifactRoot, 'holdout');

function state(status, extra = {}) {
  const payload = {
    schemaVersion: 'cortex.learning_os.private_utility_campaign_state.v0',
    validationId,
    status,
    updatedAt: new Date().toISOString(),
    artifactRoot,
    terminal: ['completed', 'blocked'].includes(status),
    ...extra
  };
  writeJson(statePath, payload);
  return payload;
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function completedTrial(trialDir) {
  const result = readJson(path.join(trialDir, 'trial_result.json'));
  return result?.schemaVersion === 'cortex.learning_os.private_utility_trial_result.v0' ? result : null;
}

function oneItemExam({ capsule, item, examId, title }) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0',
    examId,
    capsuleId: capsule.capsuleId,
    version: '0.1.0',
    title,
    passThreshold: 1,
    allowedTools: [],
    items: [item],
    truthBoundary: 'This one-item exam belongs to one frozen arm/session in the selective private utility validation.'
  };
}

function runOne({ trialDir, trialId, phase, ordinal, pairId, clusterId, arm, sessionId, capsule, item, learningContext, retrievalPackEstimatedTokens = 0 }) {
  fs.mkdirSync(trialDir, { recursive: true });
  const existing = completedTrial(trialDir);
  if (existing) return existing;
  const exam = oneItemExam({
    capsule,
    item,
    examId: `${validationId}-${phase}-${item.itemId}-${arm}-v0`,
    title: `${phase} ${clusterId} ${arm}`
  });
  let result;
  try {
    const modelRun = runCodexExam({
      exam,
      sessionId,
      runId: trialId,
      learningContext,
      evidenceRole: `${phase}_${arm}`,
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
      command: `codex exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only --model ${model}`
    });
    const invalidReasons = [];
    if (!answerShapeValid) invalidReasons.push('answer_shape_or_item_id_mismatch');
    if (modelRun.toolEvents.length) invalidReasons.push('observed_tool_event');
    result = {
      schemaVersion: 'cortex.learning_os.private_utility_trial_result.v0',
      trialId,
      phase,
      ordinal,
      pairId,
      clusterId,
      arm,
      sessionId,
      itemId: item.itemId,
      valid: invalidReasons.length === 0,
      invalidReasons,
      passed: graded.summary.passed,
      score: graded.summary.score,
      observedToolEventCount: modelRun.toolEvents.length,
      retrievalPackEstimatedTokens,
      provider: modelRun.answerSet.answerSource.provider,
      model: modelRun.answerSet.answerSource.model,
      usage: modelRun.answerSet.answerSource.usage,
      startedAt: modelRun.answerSet.startedAt,
      completedAt: modelRun.answerSet.completedAt,
      evidenceRefs: [path.relative(artifactRoot, graded.files.summary), path.relative(artifactRoot, path.join(trialDir, 'model_call.json'))],
      truthBoundary: 'This result applies only to one frozen private-fact prompt, arm, and fresh session. Invalid trials receive no credit and are never outcome-rerun.'
    };
  } catch (error) {
    if (error.workerRaw) writeJson(path.join(trialDir, 'model_call.json'), error.workerRaw);
    result = {
      schemaVersion: 'cortex.learning_os.private_utility_trial_result.v0',
      trialId,
      phase,
      ordinal,
      pairId,
      clusterId,
      arm,
      sessionId,
      itemId: item.itemId,
      valid: false,
      invalidReasons: ['worker_or_response_error'],
      passed: false,
      score: 0,
      observedToolEventCount: error.workerRaw ? (error.workerRaw.events || []).filter((event) => event?.item?.type === 'command_execution').length : 0,
      retrievalPackEstimatedTokens,
      provider: 'openai-codex',
      model,
      usage: null,
      startedAt: null,
      completedAt: new Date().toISOString(),
      error: error.message,
      evidenceRefs: error.workerRaw ? [path.relative(artifactRoot, path.join(trialDir, 'model_call.json'))] : [],
      truthBoundary: 'The worker or response failed mechanically. This invalid trial receives no credit and is never outcome-rerun.'
    };
  }
  writeJson(path.join(trialDir, 'trial_result.json'), result);
  return result;
}

function writeManifest(truthBoundary) {
  const files = allFiles(artifactRoot)
    .filter((file) => !file.endsWith('artifact_manifest.json') && file !== statePath)
    .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0',
    runId: validationId,
    generatedAt: new Date().toISOString(),
    files,
    commands: [command],
    truthBoundary
  });
}

fs.mkdirSync(calibrationRoot, { recursive: true });
fs.mkdirSync(holdoutRoot, { recursive: true });
let program;
if (fs.existsSync(programPath)) {
  if (!resume && !planOnly) throw new Error(`artifact root already contains a program; use --resume: ${artifactRoot}`);
  program = readJson(programPath);
  if (program.validationId !== validationId) throw new Error('existing validationId does not match --validation-id');
  const mismatches = [
    seedArgument && program.seed !== seedArgument ? '--seed' : null,
    modelArgument && program.runtime?.model !== modelArgument ? '--model' : null,
    thinkingArgument && program.runtime?.thinking !== thinkingArgument ? '--thinking' : null
  ].filter(Boolean);
  if (calibrationFixtureArgument) {
    const raw = fs.readFileSync(path.resolve(calibrationFixtureArgument));
    if (program.inputs?.calibrationFixtureFileSha256 !== sha256(raw)) mismatches.push('--calibration-fixture');
  }
  if (holdoutFixtureArgument) {
    const raw = fs.readFileSync(path.resolve(holdoutFixtureArgument));
    if (program.inputs?.holdoutFixtureFileSha256 !== sha256(raw)) mismatches.push('--holdout-fixture');
  }
  if (mismatches.length) throw new Error(`resume arguments conflict with frozen program: ${mismatches.join(', ')}`);
  seed = program.seed;
  model = program.runtime.model;
  thinking = program.runtime.thinking;
} else {
  if (!calibrationFixtureArgument || !holdoutFixtureArgument) throw new Error('--calibration-fixture and --holdout-fixture are required when creating a program');
  const calibrationRaw = fs.readFileSync(path.resolve(calibrationFixtureArgument));
  const holdoutRaw = fs.readFileSync(path.resolve(holdoutFixtureArgument));
  const calibrationFixture = JSON.parse(calibrationRaw.toString('utf8'));
  const holdoutFixture = JSON.parse(holdoutRaw.toString('utf8'));
  program = buildPrivateUtilityProgram({ validationId, seed, calibrationFixture, holdoutFixture, model, thinking });
  program.inputs = {
    calibrationFixtureId: calibrationFixture.fixtureId,
    calibrationFixtureFileSha256: sha256(calibrationRaw),
    holdoutFixtureId: holdoutFixture.fixtureId,
    holdoutFixtureFileSha256: sha256(holdoutRaw),
    fixturePrivacy: 'Low-sensitivity private workspace facts only; fixture files remain outside Git and are copied only to the isolated execution root.'
  };
  writeJson(programPath, program);
}

if (planOnly) {
  state('preregistered', {
    phase: 'plan_only',
    completedModelCalls: 0,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    calibrationModelCalls: program.design.calibrationModelCalls,
    holdoutModelCalls: program.design.holdoutModelCalls
  });
  console.log(JSON.stringify({ ok: true, planOnly: true, artifactRoot, programPath, program }, null, 2));
  process.exit(0);
}

const calibrationItems = new Map(program.calibration.items.map((item) => [item.pairId, item]));
const holdoutItems = new Map(program.holdout.items.map((item) => [item.pairId, item]));
const trustedLessons = new Map(program.holdout.trustedLessons.map((lesson) => [lesson.lessonId, lesson]));
const calibrationResults = [];
const holdoutResults = [];

try {
  for (const scheduled of program.calibration.schedule) {
    const item = calibrationItems.get(scheduled.pairId);
    const trialId = `${validationId}-calibration-${String(scheduled.ordinal).padStart(3, '0')}`;
    const trialDir = path.join(calibrationRoot, 'trials', `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.pairId}`);
    const existing = completedTrial(trialDir);
    if (existing) {
      calibrationResults.push(existing);
      continue;
    }
    state('running', {
      phase: 'calibration',
      activeTrial: { trialId, ordinal: scheduled.ordinal, pairId: scheduled.pairId, clusterId: scheduled.clusterId, arm: scheduled.arm },
      completedModelCalls: calibrationResults.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    calibrationResults.push(runOne({
      trialDir,
      trialId,
      phase: 'calibration',
      ordinal: scheduled.ordinal,
      pairId: scheduled.pairId,
      clusterId: scheduled.clusterId,
      arm: scheduled.arm,
      sessionId: scheduled.sessionId,
      capsule: program.capsule,
      item,
      learningContext: null
    }));
  }
  const calibrationAnalysis = analyzePrivateUtilityCalibration({ program, trials: calibrationResults });
  writeJson(path.join(calibrationRoot, 'trial_results.json'), calibrationResults.sort((a, b) => a.ordinal - b.ordinal));
  writeJson(path.join(calibrationRoot, 'analysis.json'), calibrationAnalysis);
  if (!calibrationAnalysis.calibrationPass) {
    const analysis = {
      schemaVersion: 'cortex.learning_os.private_utility_final_analysis.v0',
      validationId,
      generatedAt: new Date().toISOString(),
      calibration: calibrationAnalysis,
      holdout: null,
      validationPass: false,
      decision: 'headroom_not_confirmed_stop_before_holdout',
      allowedClaims: ['disjoint_private_utility_calibration_completed'],
      rejectedClaims: ['private_retrieval_utility', 'broad_ordinary_task_utility', 'default_path_approval'],
      truthBoundary: 'Calibration failed the frozen headroom gate, so held-out calls were not run and no private retrieval utility claim is allowed.'
    };
    writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
    writeJson(path.join(holdoutRoot, 'trial_results.json'), []);
    writeManifest(analysis.truthBoundary);
    state('completed', {
      phase: 'terminal_calibration_stop',
      completedModelCalls: calibrationResults.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls,
      mechanicalGreen: true,
      calibrationPass: false,
      validationPass: false,
      decision: analysis.decision,
      analysisPath: path.join(artifactRoot, 'analysis.json'),
      allowedClaims: analysis.allowedClaims,
      rejectedClaims: analysis.rejectedClaims,
      truthBoundary: analysis.truthBoundary
    });
    console.log(JSON.stringify({ ok: true, earlyStop: true, artifactRoot, analysis }, null, 2));
    process.exit(0);
  }

  for (const scheduled of program.holdout.schedule) {
    const item = holdoutItems.get(scheduled.pairId);
    const trialId = `${validationId}-holdout-${String(scheduled.ordinal).padStart(3, '0')}`;
    const trialDir = path.join(holdoutRoot, 'trials', `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.pairId}-${scheduled.arm}`);
    const existing = completedTrial(trialDir);
    if (existing) {
      holdoutResults.push(existing);
      continue;
    }
    state('running', {
      phase: 'holdout',
      calibrationPass: true,
      activeTrial: { trialId, ordinal: scheduled.ordinal, pairId: scheduled.pairId, clusterId: scheduled.clusterId, arm: scheduled.arm },
      completedModelCalls: calibrationResults.length + holdoutResults.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    let retrievalPack = null;
    if (scheduled.arm === 'pack') {
      retrievalPack = buildRetrievalPack({
        capsule: program.capsule,
        task: item.prompt,
        conceptIds: item.conceptIds,
        trustedLessons: [trustedLessons.get(item.lessonId)],
        candidateLessons: [],
        mistakeWarnings: [],
        now: program.generatedAt,
        maxTokens: program.holdout.thresholds.maximumRetrievalPackTokens
      });
      writeJson(path.join(trialDir, 'retrieval_pack.json'), retrievalPack);
    }
    holdoutResults.push(runOne({
      trialDir,
      trialId,
      phase: 'holdout',
      ordinal: scheduled.ordinal,
      pairId: scheduled.pairId,
      clusterId: scheduled.clusterId,
      arm: scheduled.arm,
      sessionId: scheduled.sessionId,
      capsule: program.capsule,
      item,
      learningContext: retrievalPack ? JSON.stringify(retrievalPack) : null,
      retrievalPackEstimatedTokens: retrievalPack?.estimatedTokens || 0
    }));
  }

  state('running', {
    phase: 'analysis',
    calibrationPass: true,
    completedModelCalls: calibrationResults.length + holdoutResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls
  });
  const holdoutAnalysis = analyzePrivateUtilityHoldout({ program, trials: holdoutResults });
  const analysis = {
    schemaVersion: 'cortex.learning_os.private_utility_final_analysis.v0',
    validationId,
    generatedAt: new Date().toISOString(),
    calibration: calibrationAnalysis,
    holdout: holdoutAnalysis,
    validationPass: holdoutAnalysis.holdoutPass,
    decision: holdoutAnalysis.decision,
    allowedClaims: holdoutAnalysis.allowedClaims,
    rejectedClaims: holdoutAnalysis.rejectedClaims,
    truthBoundary: holdoutAnalysis.truthBoundary
  };
  writeJson(path.join(holdoutRoot, 'trial_results.json'), holdoutResults.sort((a, b) => a.ordinal - b.ordinal));
  writeJson(path.join(holdoutRoot, 'analysis.json'), holdoutAnalysis);
  writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
  writeManifest(analysis.truthBoundary);
  state('completed', {
    phase: 'terminal',
    completedModelCalls: calibrationResults.length + holdoutResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen: holdoutResults.length === program.design.holdoutModelCalls,
    calibrationPass: true,
    validationPass: analysis.validationPass,
    decision: analysis.decision,
    analysisPath: path.join(artifactRoot, 'analysis.json'),
    allowedClaims: analysis.allowedClaims,
    rejectedClaims: analysis.rejectedClaims,
    truthBoundary: analysis.truthBoundary
  });
  console.log(JSON.stringify({ ok: true, artifactRoot, analysis }, null, 2));
} catch (error) {
  const blocker = {
    schemaVersion: 'cortex.learning_os.blocker.v0',
    validationId,
    generatedAt: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    completedCalibrationTrials: calibrationResults.length,
    completedHoldoutTrials: holdoutResults.length,
    truthBoundary: 'The corrected private utility validation did not complete mechanically; no utility claim is allowed.'
  };
  writeJson(path.join(artifactRoot, 'blocker.json'), blocker);
  state('blocked', {
    phase: 'terminal',
    completedModelCalls: calibrationResults.length + holdoutResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    blockerPath: path.join(artifactRoot, 'blocker.json'),
    reason: error.message,
    truthBoundary: blocker.truthBoundary
  });
  console.error(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exitCode = 1;
}
