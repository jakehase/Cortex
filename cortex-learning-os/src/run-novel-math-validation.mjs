#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  NOVEL_MATH_RESULT_VERSION,
  analyzeNovelMathCalibration,
  analyzeNovelMathEfficacyTrack,
  analyzeNovelMathProgram,
  analyzeNovelMathRegression,
  buildNovelMathProgram
} from './novel-math-experiment.mjs';
import { buildMistakes, distillCandidate } from './learning-loop.mjs';
import { runCodexExam } from './model-answer-runner.mjs';
import { writeExamRun } from './exam-runner.mjs';
import { evaluatePromotion } from './promotion.mjs';
import { buildRetrievalPack } from './retrieval-pack.mjs';
import { sha256File } from './hash.mjs';
import { readJson, writeJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const has = (flag) => args.includes(flag);
const compactTimestamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');
const validationId = value('--validation-id') || `clos-novel-math-${compactTimestamp()}`;
const seedArgument = value('--seed');
const modelArgument = value('--model');
const thinkingArgument = value('--thinking');
const codexCommandArgument = value('--codex-command');
const phase = value('--phase') || 'immediate';
const timeoutSeconds = Number(value('--timeout') || 240);
const artifactRoot = path.resolve(value('--artifact-root') || path.join(CLOS_ROOT, 'artifacts', validationId));
const planOnly = has('--plan-only');
const resume = has('--resume');
const command = process.argv.map((part) => JSON.stringify(part)).join(' ');
const processNonce = crypto.randomBytes(16).toString('hex');
const invocationStartedAt = new Date().toISOString();

if (!['immediate', 'durability'].includes(phase)) throw new Error('--phase must be immediate or durability');
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 1800) throw new Error('--timeout must be between 30 and 1800 seconds');

const programPath = path.join(artifactRoot, 'program.json');
const preregistrationPath = path.join(artifactRoot, 'preregistration.json');
const statePath = path.join(artifactRoot, 'campaign_state.json');
const calibrationRoot = path.join(artifactRoot, 'calibration');
const acquisitionRoot = path.join(artifactRoot, 'acquisition');
const immediateRoot = path.join(artifactRoot, 'immediate');
const durabilityRoot = path.join(artifactRoot, 'durability');
const checkpointPath = path.join(immediateRoot, 'restart_checkpoint.json');
const trustedLessonPath = path.join(acquisitionRoot, 'promotion', 'trusted_lesson.json');

const SOURCE_FILES = [
  'src/novel-math-experiment.mjs',
  'src/run-novel-math-validation.mjs',
  'src/verify-novel-math-artifacts.mjs',
  'src/run-novel-math-canary.mjs',
  'src/model-answer-runner.mjs',
  'src/ab-experiment.mjs',
  'src/retrieval-pack.mjs',
  'src/learning-loop.mjs',
  'src/promotion.mjs',
  'src/exam-runner.mjs',
  'src/checkers.mjs',
  'src/contracts.mjs',
  'src/hash.mjs',
  'src/json.mjs',
  'src/paths.mjs',
  'scripts/run-novel-math-remote.sh',
  'schemas/model-answer-output.schema.json'
];

function gitCommit() {
  if (process.env.CLOS_SOURCE_COMMIT) {
    if (!/^[0-9a-f]{40}$/.test(process.env.CLOS_SOURCE_COMMIT)) throw new Error('CLOS_SOURCE_COMMIT must be a full lowercase Git commit');
    return process.env.CLOS_SOURCE_COMMIT;
  }
  return currentCommittedIdentity().sourceCommit;
}

function workerProvenance(commandName, explicitOverride) {
  const base = { command: commandName, explicitOverride, claimable: false, resolvedPath: null, version: null, executableSha256: null };
  try {
    const resolvedPath = fs.realpathSync(execFileSync('which', [commandName], { encoding: 'utf8' }).trim());
    const executableSha256 = sha256File(resolvedPath);
    if (explicitOverride) return { ...base, resolvedPath, executableSha256 };
    const version = execFileSync(commandName, ['--version'], { encoding: 'utf8' }).trim();
    const claimable = commandName === 'codex'
      && /@openai\/codex[^/]*\/.*\/bin\/codex$/.test(resolvedPath)
      && /^codex-cli\s+\d+\.\d+\.\d+/.test(version);
    return { ...base, claimable, resolvedPath, version, executableSha256 };
  } catch (error) {
    return { ...base, error: error.message };
  }
}

function sourceHashes() {
  return Object.fromEntries(SOURCE_FILES.map((relative) => [relative, sha256File(path.join(CLOS_ROOT, relative))]));
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeState(status, extra = {}) {
  const payload = {
    schemaVersion: 'cortex.learning_os.novel_math_campaign_state.v0',
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
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function writeManifest(truthBoundary) {
  const files = allFiles(artifactRoot)
    .filter((file) => file !== path.join(artifactRoot, 'artifact_manifest.json') && file !== statePath)
    .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0',
    runId: validationId,
    generatedAt: new Date().toISOString(),
    sourceGitCommit: gitCommit(),
    files,
    commands: readJson(path.join(artifactRoot, 'invocations.json'), []).map((row) => row.command),
    truthBoundary
  });
}

function appendInvocation(record) {
  const invocationPath = path.join(artifactRoot, 'invocations.json');
  const rows = readJson(invocationPath, []);
  rows.push(record);
  writeJson(invocationPath, rows);
}

function completedTrial(trialDir) {
  const result = readJson(path.join(trialDir, 'trial_result.json'));
  return result?.schemaVersion === NOVEL_MATH_RESULT_VERSION ? result : null;
}

function oneItemExam({ capsule, item, examId, title, truthBoundary }) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0',
    examId,
    capsuleId: capsule.capsuleId,
    version: '0.1.0',
    title,
    passThreshold: 1,
    allowedTools: [],
    items: [item],
    truthBoundary
  };
}

function runOne({
  program,
  trialDir,
  trialId,
  phaseName,
  ordinal,
  trackId,
  pairId,
  arm,
  sessionId,
  item,
  examId = null,
  learningContext,
  evidenceRole,
  retrievalPackEstimatedTokens = 0,
  codexCommand
}) {
  fs.mkdirSync(trialDir, { recursive: true });
  const existing = completedTrial(trialDir);
  if (existing) return existing;
  const exam = oneItemExam({
    capsule: program.capsule,
    item,
    examId: examId || `${program.validationId}-${phaseName}-${trackId}-${item.itemId}-${arm}-v0`,
    title: `${phaseName} ${trackId} ${arm}`,
    truthBoundary: 'One frozen item, arm, and fresh session in the preregistered novel-math benchmark.'
  });
  let result;
  try {
    const modelRun = runCodexExam({
      exam,
      sessionId,
      runId: trialId,
      learningContext,
      evidenceRole,
      timeoutSeconds,
      thinking: program.runtime.thinking,
      model: program.runtime.model,
      codexCommand
    });
    writeJson(path.join(trialDir, 'model_call.json'), modelRun.raw);
    fs.writeFileSync(path.join(trialDir, 'model_prompt.txt'), `${modelRun.prompt}\n`);
    const answerShapeValid = modelRun.answerSet.answers.length === 1 && modelRun.answerSet.answers[0].itemId === item.itemId;
    const graded = writeExamRun({
      capsule: program.capsule,
      exam,
      answerSet: modelRun.answerSet,
      runId: trialId,
      outputDir: trialDir,
      command: `${codexCommand} exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --model ${program.runtime.model}`
    });
    const invalidReasons = [];
    if (!answerShapeValid) invalidReasons.push('answer_shape_or_item_id_mismatch');
    if (modelRun.toolEvents.length) invalidReasons.push('observed_tool_event');
    result = {
      schemaVersion: NOVEL_MATH_RESULT_VERSION,
      trialId,
      phase: phaseName,
      ordinal,
      trackId,
      pairId,
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
      truthBoundary: 'One frozen model call. Invalid trials receive no credit and are never outcome-rerun.'
    };
  } catch (error) {
    if (error.workerRaw) writeJson(path.join(trialDir, 'model_call.json'), error.workerRaw);
    result = {
      schemaVersion: NOVEL_MATH_RESULT_VERSION,
      trialId,
      phase: phaseName,
      ordinal,
      trackId,
      pairId,
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
      model: program.runtime.model,
      usage: null,
      startedAt: null,
      completedAt: new Date().toISOString(),
      error: error.message,
      evidenceRefs: error.workerRaw ? [path.relative(artifactRoot, path.join(trialDir, 'model_call.json'))] : [],
      truthBoundary: 'Worker or response failure invalidated this call. It receives no credit and is never outcome-rerun.'
    };
  }
  writeJson(path.join(trialDir, 'trial_result.json'), result);
  return result;
}

function acquisitionExamItem(item) {
  return {
    itemId: item.itemId,
    prompt: item.prompt,
    conceptIds: item.conceptIds,
    answerFormat: item.answerFormat,
    checker: item.checker,
    mistakeCategory: item.mistakeCategory,
    remediation: item.remediation
  };
}

function runAcquisition(program, codexCommand) {
  const existing = readJson(path.join(acquisitionRoot, 'acquisition_summary.json'));
  if (existing?.terminal) return existing;
  fs.mkdirSync(acquisitionRoot, { recursive: true });
  const roles = [
    { role: 'baseline', item: program.acquisition.items[0], examId: program.acquisition.baselineExamId, context: null, evidenceRole: 'baseline' },
    { role: 'correction', item: program.acquisition.items[1], examId: program.acquisition.correctionExamId, context: JSON.stringify({ type: 'corrective_training_context', mathematicalMicrotheory: program.targetTheory.ruleText }), evidenceRole: 'correction' },
    { role: 'retest', item: program.acquisition.items[2], examId: program.acquisition.retestExamId, context: JSON.stringify({ type: 'independent_retest_context', mathematicalMicrotheory: program.targetTheory.ruleText }), evidenceRole: 'retest' }
  ];
  const results = [];
  for (let index = 0; index < roles.length; index += 1) {
    const row = roles[index];
    writeState('running', {
      phase: 'acquisition',
      activeTrial: row.role,
      completedModelCalls: program.calibration.items.length + index,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    results.push(runOne({
      program,
      trialDir: path.join(acquisitionRoot, row.role),
      trialId: `${program.validationId}-acquisition-${row.role}`,
      phaseName: 'acquisition',
      ordinal: index + 1,
      trackId: 'acquisition',
      pairId: `acquisition-${row.role}`,
      arm: row.context ? 'training_context' : 'no_context',
      sessionId: `${program.validationId}-acquisition-${row.role}-${sha256(`${program.seed}:acquisition:${row.role}`).slice(0, 12)}`,
      item: acquisitionExamItem(row.item),
      examId: row.examId,
      learningContext: row.context,
      evidenceRole: row.evidenceRole,
      codexCommand
    }));
  }
  const baselineGrade = readJson(path.join(acquisitionRoot, 'baseline', 'score_summary.json'));
  const correctionVerifiers = readJson(path.join(acquisitionRoot, 'correction', 'verifier_results.json'), []);
  const retestVerifiers = readJson(path.join(acquisitionRoot, 'retest', 'verifier_results.json'), []);
  const baselineAttempts = readJson(path.join(acquisitionRoot, 'baseline', 'attempts.json'), []);
  const baselineVerifiers = readJson(path.join(acquisitionRoot, 'baseline', 'verifier_results.json'), []);
  const baselineExam = readJson(path.join(acquisitionRoot, 'baseline', 'exam.json'));
  const allValid = results.every((result) => result.valid);
  const requiredOutcome = allValid && baselineGrade?.passed === false && results[1]?.passed === true && results[2]?.passed === true;
  let promotion = { promoted: false, promotionProof: null, trustedLesson: null };
  let mistakes = [];
  let candidate = null;
  if (requiredOutcome) {
    mistakes = buildMistakes({ exam: baselineExam, attempts: baselineAttempts, verifierResults: baselineVerifiers });
    if (mistakes.length === 1) {
      const supportingResults = [...correctionVerifiers, ...retestVerifiers];
      candidate = distillCandidate({
        capsule: program.capsule,
        mistake: mistakes[0],
        lessonTemplate: program.acquisition.items[0].remediation.lessonTemplate,
        supportingResults,
        now: program.generatedAt
      });
      promotion = evaluatePromotion({ capsule: program.capsule, candidate, verifierResults: supportingResults, now: program.generatedAt });
    }
  }
  const promotionRoot = path.join(acquisitionRoot, 'promotion');
  fs.mkdirSync(promotionRoot, { recursive: true });
  writeJson(path.join(acquisitionRoot, 'mistakes.json'), mistakes);
  writeJson(path.join(promotionRoot, 'lesson_candidate.json'), candidate);
  writeJson(path.join(promotionRoot, 'promotion_proof.json'), promotion.promotionProof);
  writeJson(trustedLessonPath, promotion.trustedLesson);
  const summary = {
    schemaVersion: 'cortex.learning_os.novel_math_acquisition_summary.v0',
    terminal: true,
    valid: allValid,
    baselineFailed: baselineGrade?.passed === false,
    correctionPassed: results[1]?.passed === true,
    retestPassed: results[2]?.passed === true,
    requiredOutcome,
    promoted: promotion.promoted === true,
    modelCalls: results.length,
    trialIds: results.map((result) => result.trialId),
    trials: results,
    trustedLessonPath: promotion.trustedLesson ? path.relative(artifactRoot, trustedLessonPath) : null,
    truthBoundary: promotion.promoted
      ? 'One invented mathematical microtheory met the frozen acquisition and promotion gates; held-out transfer remains unproven.'
      : 'Acquisition or promotion failed; no target-theory transfer or math-learning claim is allowed.'
  };
  writeJson(path.join(acquisitionRoot, 'acquisition_summary.json'), summary);
  return summary;
}

function retrievalContext(program, trustedLesson, item, maxTokens) {
  return buildRetrievalPack({
    capsule: program.capsule,
    task: item.prompt,
    conceptIds: item.conceptIds,
    trustedLessons: [trustedLesson],
    candidateLessons: [],
    mistakeWarnings: [],
    now: program.generatedAt,
    maxTokens
  });
}

function runSchedule({ program, schedule, root, phaseName, trustedLesson, codexCommand, offset }) {
  const itemMaps = Object.fromEntries(Object.entries(program.tracks).map(([trackId, track]) => [trackId, new Map(track.items.map((item) => [item.pairId, item]))]));
  const results = [];
  for (const scheduled of schedule) {
    const item = itemMaps[scheduled.trackId].get(scheduled.pairId);
    const trialId = `${program.validationId}-${phaseName}-${String(scheduled.ordinal).padStart(3, '0')}`;
    const trialDir = path.join(root, 'trials', `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.trackId}-${scheduled.pairId}-${scheduled.arm}`);
    const existing = completedTrial(trialDir);
    if (existing) {
      results.push(existing);
      continue;
    }
    writeState('running', {
      phase: phaseName,
      activeTrial: { trialId, ordinal: scheduled.ordinal, trackId: scheduled.trackId, pairId: scheduled.pairId, arm: scheduled.arm },
      completedModelCalls: offset + results.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    let pack = null;
    if (scheduled.arm === 'pack') {
      pack = retrievalContext(program, trustedLesson, item, program.tracks[scheduled.trackId].thresholds.maximumRetrievalPackTokens);
      fs.mkdirSync(trialDir, { recursive: true });
      writeJson(path.join(trialDir, 'retrieval_pack.json'), pack);
    }
    results.push(runOne({
      program,
      trialDir,
      trialId,
      phaseName,
      ordinal: scheduled.ordinal,
      trackId: scheduled.trackId,
      pairId: scheduled.pairId,
      arm: scheduled.arm,
      sessionId: scheduled.sessionId,
      item,
      learningContext: pack ? JSON.stringify(pack) : null,
      evidenceRole: `${phaseName}_${scheduled.trackId}_${scheduled.arm}`,
      retrievalPackEstimatedTokens: pack?.estimatedTokens || 0,
      codexCommand
    }));
  }
  return results;
}

function earlyNoGo(program, calibrationTrials, calibration, acquisition, reason) {
  const analysis = {
    schemaVersion: 'cortex.learning_os.novel_math_early_stop_analysis.v0',
    validationId: program.validationId,
    generatedAt: new Date().toISOString(),
    reason,
    completedModelCalls: calibrationTrials.length + Number(acquisition?.modelCalls || 0),
    plannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen: true,
    calibration,
    acquisition: acquisition || null,
    thresholdPass: false,
    decision: 'preregistered_early_no_go',
    allowedClaims: ['preregistered_novel_math_gate_evaluated'],
    rejectedClaims: ['novel_math_learning', 'retrieval_transfer', 'durability_across_restart', 'production_qualification'],
    truthBoundary: 'A frozen prerequisite gate failed, so later calls were correctly not run and no math-learning claim is allowed.'
  };
  writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
  writeManifest(analysis.truthBoundary);
  writeState('completed', {
    phase: 'terminal_early_no_go',
    completedModelCalls: analysis.completedModelCalls,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen: true,
    thresholdPass: false,
    decision: analysis.decision,
    analysisPath: path.join(artifactRoot, 'analysis.json'),
    truthBoundary: analysis.truthBoundary
  });
  console.log(JSON.stringify({ ok: true, earlyNoGo: true, artifactRoot, analysis }, null, 2));
}

fs.mkdirSync(artifactRoot, { recursive: true });
let program;
let workerCommand;
try {
  if (!fs.existsSync(programPath)) {
    if (!planOnly) throw new Error('preregistration is required: run once with --plan-only before executing model calls');
    const seed = seedArgument || crypto.randomBytes(32).toString('hex');
    const model = modelArgument || 'gpt-5.6-sol';
    const thinking = thinkingArgument || 'xhigh';
    workerCommand = codexCommandArgument || 'codex';
    program = buildNovelMathProgram({ validationId, seed, model, thinking });
    program.source = { gitCommit: gitCommit(), files: sourceHashes() };
    program.runtime.workerCommand = workerCommand;
    program.runtime.workerProvenance = workerProvenance(workerCommand, Boolean(codexCommandArgument));
    writeJson(programPath, program);
    const preregistration = {
      schemaVersion: 'cortex.learning_os.novel_math_preregistration.v0',
      validationId,
      frozenAt: new Date().toISOString(),
      programSha256: sha256(fs.readFileSync(programPath)),
      sourceGitCommit: program.source.gitCommit,
      sourceFiles: program.source.files,
      noOutcomeDrivenChanges: true,
      frozenThresholds: Object.fromEntries(Object.entries(program.tracks).map(([trackId, track]) => [trackId, track.thresholds])),
      truthBoundary: program.truthBoundary
    };
    writeJson(preregistrationPath, preregistration);
    appendInvocation({ processNonce, processId: process.pid, startedAt: invocationStartedAt, phase: 'plan_only', command, sourceGitCommit: gitCommit() });
  } else {
    program = readJson(programPath);
    const preregistration = readJson(preregistrationPath);
    if (!preregistration || preregistration.programSha256 !== sha256(fs.readFileSync(programPath))) throw new Error('program does not match frozen preregistration digest');
    if (program.validationId !== validationId) throw new Error('existing validationId does not match --validation-id');
    const mismatches = [
      seedArgument && program.seed !== seedArgument ? '--seed' : null,
      modelArgument && program.runtime?.model !== modelArgument ? '--model' : null,
      thinkingArgument && program.runtime?.thinking !== thinkingArgument ? '--thinking' : null,
      codexCommandArgument && program.runtime?.workerCommand !== codexCommandArgument ? '--codex-command' : null
    ].filter(Boolean);
    if (mismatches.length) throw new Error(`resume arguments conflict with frozen program: ${mismatches.join(', ')}`);
    if (program.source?.gitCommit !== gitCommit()) throw new Error(`source commit drift: frozen ${program.source?.gitCommit}, current ${gitCommit()}`);
    if (!sameObject(program.source?.files, sourceHashes())) throw new Error('source file hashes drifted after preregistration');
    const currentWorkerProvenance = workerProvenance(program.runtime.workerCommand, program.runtime.workerProvenance?.explicitOverride === true);
    if (!sameObject(program.runtime.workerProvenance, currentWorkerProvenance)) throw new Error('worker executable provenance drift after preregistration');
    workerCommand = program.runtime.workerCommand;
  }

  if (planOnly) {
    writeState('preregistered', {
      phase: 'plan_only',
      completedModelCalls: 0,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls,
      sourceGitCommit: program.source.gitCommit,
      programSha256: readJson(preregistrationPath).programSha256,
      thresholdPass: false,
      truthBoundary: 'The benchmark is frozen but no model calls have run.'
    });
    console.log(JSON.stringify({
      ok: true,
      planOnly: true,
      artifactRoot,
      validationId: program.validationId,
      sourceGitCommit: program.source.gitCommit,
      programSha256: readJson(preregistrationPath).programSha256,
      modelCalls: program.design.maximumTotalModelCalls,
      phaseCalls: {
        calibration: program.design.calibrationModelCalls,
        acquisition: program.design.acquisitionModelCalls,
        immediate: program.design.immediateModelCalls,
        postRestart: program.design.postRestartModelCalls
      }
    }, null, 2));
    process.exit(0);
  }

  if (!resume) throw new Error('execution of a frozen program requires --resume');
  appendInvocation({ processNonce, processId: process.pid, startedAt: invocationStartedAt, phase, command, sourceGitCommit: gitCommit() });

  if (phase === 'immediate') {
    if (fs.existsSync(checkpointPath)) {
      console.log(JSON.stringify({ ok: true, resumed: true, status: 'awaiting_restart', artifactRoot, checkpointPath }, null, 2));
      process.exit(0);
    }
    fs.mkdirSync(calibrationRoot, { recursive: true });
    const calibrationItems = new Map(program.calibration.items.map((item) => [item.pairId, item]));
    const calibrationTrials = [];
    for (const scheduled of program.calibration.schedule) {
      const item = calibrationItems.get(scheduled.pairId);
      const trialDir = path.join(calibrationRoot, 'trials', `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.pairId}`);
      const existing = completedTrial(trialDir);
      if (existing) {
        calibrationTrials.push(existing);
        continue;
      }
      writeState('running', {
        phase: 'calibration',
        activeTrial: { ordinal: scheduled.ordinal, pairId: scheduled.pairId, arm: scheduled.arm },
        completedModelCalls: calibrationTrials.length,
        totalPlannedModelCalls: program.design.maximumTotalModelCalls
      });
      calibrationTrials.push(runOne({
        program,
        trialDir,
        trialId: `${program.validationId}-calibration-${String(scheduled.ordinal).padStart(3, '0')}`,
        phaseName: 'calibration',
        ordinal: scheduled.ordinal,
        trackId: 'calibration',
        pairId: scheduled.pairId,
        arm: 'no_pack',
        sessionId: scheduled.sessionId,
        item,
        learningContext: null,
        evidenceRole: 'disjoint_headroom_calibration',
        codexCommand: workerCommand
      }));
    }
    const calibrationAnalysis = analyzeNovelMathCalibration({ program, trials: calibrationTrials });
    writeJson(path.join(calibrationRoot, 'trial_results.json'), calibrationTrials.sort((a, b) => a.ordinal - b.ordinal));
    writeJson(path.join(calibrationRoot, 'analysis.json'), calibrationAnalysis);
    if (!calibrationAnalysis.calibrationPass) {
      earlyNoGo(program, calibrationTrials, calibrationAnalysis, null, 'calibration_headroom_gate_failed');
      process.exit(0);
    }

    const acquisition = runAcquisition(program, workerCommand);
    if (!acquisition.promoted) {
      earlyNoGo(program, calibrationTrials, calibrationAnalysis, acquisition, 'acquisition_or_promotion_gate_failed');
      process.exit(0);
    }
    const trustedLesson = readJson(trustedLessonPath);
    if (!trustedLesson) throw new Error('promoted trusted lesson missing after successful acquisition');
    fs.mkdirSync(immediateRoot, { recursive: true });
    const immediateTrials = runSchedule({
      program,
      schedule: program.immediateSchedule,
      root: immediateRoot,
      phaseName: 'immediate',
      trustedLesson,
      codexCommand: workerCommand,
      offset: program.design.calibrationModelCalls + program.design.acquisitionModelCalls
    });
    writeJson(path.join(immediateRoot, 'trial_results.json'), immediateTrials.sort((a, b) => a.ordinal - b.ordinal));
    const immediateAnalysis = {
      schemaVersion: 'cortex.learning_os.novel_math_immediate_analysis.v0',
      validationId: program.validationId,
      generatedAt: new Date().toISOString(),
      direct: analyzeNovelMathEfficacyTrack({ track: program.tracks.direct, trials: immediateTrials }),
      composition: analyzeNovelMathEfficacyTrack({ track: program.tracks.composition, trials: immediateTrials }),
      regression: analyzeNovelMathRegression({ track: program.tracks.regression, trials: immediateTrials })
    };
    immediateAnalysis.immediatePass = immediateAnalysis.direct.trackPass && immediateAnalysis.composition.trackPass && immediateAnalysis.regression.regressionPass;
    writeJson(path.join(immediateRoot, 'analysis.json'), immediateAnalysis);
    const checkpoint = {
      schemaVersion: 'cortex.learning_os.novel_math_restart_checkpoint.v0',
      validationId: program.validationId,
      processNonce,
      processId: process.pid,
      invocationStartedAt,
      completedAt: new Date().toISOString(),
      trustedLessonPath: path.relative(artifactRoot, trustedLessonPath),
      trustedLessonSha256: sha256File(trustedLessonPath),
      programSha256: sha256(fs.readFileSync(programPath)),
      immediateTrialCount: immediateTrials.length,
      immediatePass: immediateAnalysis.immediatePass,
      nextRequiredPhase: 'durability_in_new_process',
      truthBoundary: 'The immediate runner must exit. A distinct process must reload the persisted lesson before durability trials.'
    };
    writeJson(checkpointPath, checkpoint);
    writeState('awaiting_restart', {
      phase: 'immediate_complete',
      completedModelCalls: program.design.calibrationModelCalls + program.design.acquisitionModelCalls + immediateTrials.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls,
      immediatePass: immediateAnalysis.immediatePass,
      thresholdPass: false,
      checkpointPath,
      nextRequiredPhase: 'durability',
      truthBoundary: 'Immediate evidence is incomplete until a distinct process finishes the frozen post-restart track.'
    });
    console.log(JSON.stringify({ ok: true, status: 'awaiting_restart', artifactRoot, checkpointPath, immediateAnalysis }, null, 2));
    process.exit(0);
  }

  const checkpoint = readJson(checkpointPath);
  if (!checkpoint) throw new Error('durability phase requires a completed immediate restart checkpoint');
  if (checkpoint.processNonce === processNonce) throw new Error('durability must run in a distinct process invocation');
  if (checkpoint.programSha256 !== sha256(fs.readFileSync(programPath))) throw new Error('program changed across restart boundary');
  if (!fs.existsSync(trustedLessonPath)) throw new Error('persisted trusted lesson missing at durability restart');
  const trustedLessonDigest = sha256File(trustedLessonPath);
  if (checkpoint.trustedLessonSha256 !== trustedLessonDigest) throw new Error('trusted lesson changed across restart boundary');
  const trustedLesson = readJson(trustedLessonPath);
  const durabilityInvocation = {
    schemaVersion: 'cortex.learning_os.novel_math_durability_invocation.v0',
    validationId: program.validationId,
    processNonce,
    processId: process.pid,
    startedAt: invocationStartedAt,
    sourceGitCommit: gitCommit(),
    loadedTrustedLessonSha256: trustedLessonDigest,
    truthBoundary: 'This distinct process loaded the persisted promoted lesson before making post-restart calls.'
  };
  fs.mkdirSync(durabilityRoot, { recursive: true });
  writeJson(path.join(durabilityRoot, 'invocation.json'), durabilityInvocation);
  const immediateTrials = readJson(path.join(immediateRoot, 'trial_results.json'), []);
  const durabilityTrials = runSchedule({
    program,
    schedule: program.durabilitySchedule,
    root: durabilityRoot,
    phaseName: 'post_restart',
    trustedLesson,
    codexCommand: workerCommand,
    offset: program.design.calibrationModelCalls + program.design.acquisitionModelCalls + immediateTrials.length
  });
  writeJson(path.join(durabilityRoot, 'trial_results.json'), durabilityTrials.sort((a, b) => a.ordinal - b.ordinal));
  const calibrationTrials = readJson(path.join(calibrationRoot, 'trial_results.json'), []);
  const acquisition = readJson(path.join(acquisitionRoot, 'acquisition_summary.json'), {});
  const analysis = analyzeNovelMathProgram({
    program,
    calibrationTrials,
    acquisition,
    immediateTrials,
    durabilityTrials,
    checkpoint,
    durabilityInvocation,
    trustedLessonSha256: sha256File(trustedLessonPath)
  });
  writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
  writeManifest(analysis.truthBoundary);
  writeState('completed', {
    phase: 'terminal',
    completedModelCalls: analysis.completedModelCalls,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen: analysis.mechanicalGreen,
    thresholdPass: analysis.thresholdPass,
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
    phase,
    error: error.message,
    stack: error.stack,
    sourceGitCommit: (() => { try { return gitCommit(); } catch { return null; } })(),
    truthBoundary: 'The novel-math validation did not complete mechanically; no math-learning, transfer, restart-durability, or production qualification claim is allowed.'
  };
  fs.mkdirSync(artifactRoot, { recursive: true });
  writeJson(path.join(artifactRoot, 'blocker.json'), blocker);
  writeState('blocked', {
    phase: `terminal_${phase}`,
    blockerPath: path.join(artifactRoot, 'blocker.json'),
    reason: error.message,
    mechanicalGreen: false,
    thresholdPass: false,
    truthBoundary: blocker.truthBoundary
  });
  console.error(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exitCode = 1;
}
