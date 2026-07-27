#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeGoNoGoProgram, buildGoNoGoProgram } from './go-no-go-experiment.mjs';
import { buildMistakes, distillCandidate } from './learning-loop.mjs';
import { runCodexExam } from './model-answer-runner.mjs';
import { writeExamRun } from './exam-runner.mjs';
import { evaluatePromotion } from './promotion.mjs';
import { buildRetrievalPack } from './retrieval-pack.mjs';
import { sha256File } from './hash.mjs';
import { readJson, writeJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const has = (flag) => args.includes(flag);
const compactTimestamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const programId = value('--program-id') || `clos-go-no-go-${compactTimestamp()}`;
const seedArgument = value('--seed');
const modelArgument = value('--model');
const thinkingArgument = value('--thinking');
const utilityFixtureArgument = value('--utility-fixture');
let seed = seedArgument || crypto.randomBytes(32).toString('hex');
let model = modelArgument || 'gpt-5.6-sol';
let thinking = thinkingArgument || 'xhigh';
const timeoutSeconds = Number(value('--timeout') || 240);
const artifactRoot = path.resolve(value('--artifact-root') || path.join(CLOS_ROOT, 'artifacts', programId));
const planOnly = has('--plan-only');
const resume = has('--resume');
const command = process.argv.map((part) => JSON.stringify(part)).join(' ');
const programPath = path.join(artifactRoot, 'program.json');
const statePath = path.join(artifactRoot, 'campaign_state.json');
const trialsRoot = path.join(artifactRoot, 'trials');
const acquisitionRoot = path.join(artifactRoot, 'acquisition');

function state(status, extra = {}) {
  const payload = {
    schemaVersion: 'cortex.learning_os.go_no_go_campaign_state.v0',
    programId,
    status,
    updatedAt: new Date().toISOString(),
    artifactRoot,
    terminal: ['completed', 'blocked'].includes(status),
    ...extra
  };
  writeJson(statePath, payload);
  return payload;
}

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function completedTrial(trialDir) {
  const result = readJson(path.join(trialDir, 'trial_result.json'));
  return result?.schemaVersion === 'cortex.learning_os.go_no_go_trial_result.v0' ? result : null;
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
    truthBoundary: 'This one-item exam is one frozen member of the capped Learning OS go/no-go validation.'
  };
}

function runOne({
  trialDir,
  trialId,
  ordinal,
  trackId,
  pairId,
  arm,
  sessionId,
  capsule,
  item,
  examId,
  learningContext,
  evidenceRole,
  retrievalPackEstimatedTokens = 0
}) {
  fs.mkdirSync(trialDir, { recursive: true });
  const existing = completedTrial(trialDir);
  if (existing) return existing;
  const exam = oneItemExam({ capsule, item, examId, title: `${trackId} ${evidenceRole}` });
  let result;
  try {
    const modelRun = runCodexExam({
      exam,
      sessionId,
      runId: trialId,
      learningContext,
      evidenceRole,
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
      schemaVersion: 'cortex.learning_os.go_no_go_trial_result.v0',
      trialId,
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
      truthBoundary: 'This result applies only to one frozen track/arm/item/session. Invalid trials receive no credit and are never outcome-rerun.'
    };
  } catch (error) {
    if (error.workerRaw) writeJson(path.join(trialDir, 'model_call.json'), error.workerRaw);
    result = {
      schemaVersion: 'cortex.learning_os.go_no_go_trial_result.v0',
      trialId,
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

function runAcquisition(program) {
  const track = program.tracks.mechanism;
  const existing = readJson(path.join(acquisitionRoot, 'acquisition_summary.json'));
  if (existing?.terminal) {
    const trustedLesson = readJson(path.join(acquisitionRoot, 'promotion', 'trusted_lesson.json'));
    return { ...existing, trustedLesson };
  }
  fs.mkdirSync(acquisitionRoot, { recursive: true });
  const roles = [
    { role: 'baseline', item: track.acquisition.items[0], examId: track.acquisition.baselineExamId, context: null, evidenceRole: 'baseline' },
    { role: 'correction', item: track.acquisition.items[1], examId: track.acquisition.correctionExamId, context: JSON.stringify({ type: 'corrective_training_context', procedure: track.rule.ruleText }), evidenceRole: 'correction' },
    { role: 'retest', item: track.acquisition.items[2], examId: track.acquisition.retestExamId, context: JSON.stringify({ type: 'independent_retest_context', procedure: track.rule.ruleText }), evidenceRole: 'retest' }
  ];
  const results = [];
  for (let index = 0; index < roles.length; index += 1) {
    const row = roles[index];
    state('running', {
      phase: 'mechanism_acquisition',
      activeAcquisition: row.role,
      completedModelCalls: index,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    const result = runOne({
      trialDir: path.join(acquisitionRoot, row.role),
      trialId: `${program.programId}-acquisition-${row.role}`,
      ordinal: index + 1,
      trackId: 'mechanism_acquisition',
      pairId: `acquisition-${row.role}`,
      arm: row.context ? 'training_context' : 'no_context',
      sessionId: `${program.programId}-acquisition-${row.role}-${sha256(`${program.seed}:${row.role}`).slice(0, 12)}`,
      capsule: track.capsule,
      item: acquisitionExamItem(row.item),
      examId: row.examId,
      learningContext: row.context,
      evidenceRole: row.evidenceRole
    });
    results.push(result);
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
        capsule: track.capsule,
        mistake: mistakes[0],
        lessonTemplate: track.acquisition.items[0].remediation.lessonTemplate,
        supportingResults,
        now: program.generatedAt
      });
      promotion = evaluatePromotion({ capsule: track.capsule, candidate, verifierResults: supportingResults, now: program.generatedAt });
    }
  }
  const promotionRoot = path.join(acquisitionRoot, 'promotion');
  fs.mkdirSync(promotionRoot, { recursive: true });
  writeJson(path.join(acquisitionRoot, 'mistakes.json'), mistakes);
  writeJson(path.join(promotionRoot, 'lesson_candidate.json'), candidate);
  writeJson(path.join(promotionRoot, 'promotion_proof.json'), promotion.promotionProof);
  writeJson(path.join(promotionRoot, 'trusted_lesson.json'), promotion.trustedLesson);
  const summary = {
    schemaVersion: 'cortex.learning_os.go_no_go_acquisition_summary.v0',
    terminal: true,
    valid: allValid,
    baselineFailed: baselineGrade?.passed === false,
    correctionPassed: results[1]?.passed === true,
    retestPassed: results[2]?.passed === true,
    requiredOutcome,
    promoted: promotion.promoted === true,
    modelCalls: results.length,
    trialIds: results.map((result) => result.trialId),
    truthBoundary: promotion.promoted
      ? 'One synthetic procedure met the declared acquisition and promotion gates; transfer remains unproven until the paired track passes.'
      : 'The synthetic procedure did not meet every acquisition and promotion gate; no transfer or Learning OS claim is allowed.'
  };
  writeJson(path.join(acquisitionRoot, 'acquisition_summary.json'), summary);
  return { ...summary, trustedLesson: promotion.trustedLesson };
}

fs.mkdirSync(trialsRoot, { recursive: true });
let program;
if (fs.existsSync(programPath)) {
  if (!resume && !planOnly) throw new Error(`artifact root already contains a program; use --resume to continue without rerunning completed trials: ${artifactRoot}`);
  program = readJson(programPath);
  if (program.programId !== programId) throw new Error('existing programId does not match --program-id');
  const mismatches = [
    seedArgument && program.seed !== seedArgument ? '--seed' : null,
    modelArgument && program.runtime?.model !== modelArgument ? '--model' : null,
    thinkingArgument && program.runtime?.thinking !== thinkingArgument ? '--thinking' : null
  ].filter(Boolean);
  if (utilityFixtureArgument) {
    const raw = fs.readFileSync(path.resolve(utilityFixtureArgument));
    if (program.inputs?.utilityFixtureFileSha256 !== sha256(raw)) mismatches.push('--utility-fixture');
  }
  if (mismatches.length) throw new Error(`resume arguments conflict with frozen program: ${mismatches.join(', ')}`);
  seed = program.seed;
  model = program.runtime.model;
  thinking = program.runtime.thinking;
} else {
  if (!utilityFixtureArgument) throw new Error('--utility-fixture is required when creating a program');
  const utilityPath = path.resolve(utilityFixtureArgument);
  const utilityRaw = fs.readFileSync(utilityPath);
  const utilityFixture = JSON.parse(utilityRaw.toString('utf8'));
  program = buildGoNoGoProgram({ programId, seed, utilityFixture, model, thinking });
  program.inputs = {
    utilityFixtureId: utilityFixture.fixtureId,
    utilityFixtureFileSha256: sha256(utilityRaw),
    utilityFixturePrivacy: utilityFixture.truthBoundary
  };
  writeJson(programPath, program);
}

if (planOnly) {
  state('preregistered', {
    phase: 'plan_only',
    completedModelCalls: 0,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    transferTrials: program.design.transferTrials,
    acquisitionTrials: program.design.acquisitionTrials
  });
  console.log(JSON.stringify({ ok: true, planOnly: true, artifactRoot, programPath, program }, null, 2));
  process.exit(0);
}

const itemMaps = Object.fromEntries(Object.entries(program.tracks).map(([trackId, track]) => [trackId, new Map(track.items.map((item) => [item.pairId, item]))]));
const transferResults = [];
try {
  const acquisition = runAcquisition(program);
  if (!acquisition.promoted || !acquisition.trustedLesson) {
    const analysis = analyzeGoNoGoProgram({ program, trials: [], acquisition });
    analysis.allowedClaims = ['synthetic_acquisition_gate_evaluated'];
    analysis.truthBoundary = 'The synthetic acquisition gate did not promote a lesson, so the capped program stopped before transfer trials. No retrieval-benefit or Learning OS claim is allowed.';
    writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
    writeJson(path.join(artifactRoot, 'trial_results.json'), []);
    const manifestFiles = allFiles(artifactRoot)
      .filter((file) => !file.endsWith('artifact_manifest.json') && file !== statePath)
      .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
      schemaVersion: 'cortex.learning_os.run_manifest.v0',
      runId: programId,
      generatedAt: new Date().toISOString(),
      files: manifestFiles,
      commands: [command],
      truthBoundary: analysis.truthBoundary
    });
    state('completed', {
      phase: 'terminal_early_no_go',
      completedModelCalls: acquisition.modelCalls,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls,
      mechanicalGreen: false,
      programPass: false,
      analysisPath: path.join(artifactRoot, 'analysis.json'),
      allowedClaims: analysis.allowedClaims,
      truthBoundary: analysis.truthBoundary
    });
    console.log(JSON.stringify({ ok: true, earlyNoGo: true, artifactRoot, analysis }, null, 2));
    process.exit(0);
  }

  const utilityLessons = new Map(program.tracks.utility.trustedLessons.map((lesson) => [lesson.lessonId, lesson]));
  for (const scheduled of program.schedule) {
    const track = program.tracks[scheduled.trackId];
    const item = itemMaps[scheduled.trackId].get(scheduled.pairId);
    const trialId = `${programId}-trial-${String(scheduled.ordinal).padStart(3, '0')}`;
    const trialDir = path.join(trialsRoot, `${String(scheduled.ordinal).padStart(3, '0')}-${scheduled.trackId}-${scheduled.pairId}-${scheduled.arm}`);
    const existing = completedTrial(trialDir);
    if (existing) {
      transferResults.push(existing);
      continue;
    }
    state('running', {
      phase: 'paired_transfer_trials',
      activeTrial: { trialId, ordinal: scheduled.ordinal, trackId: scheduled.trackId, pairId: scheduled.pairId, arm: scheduled.arm },
      completedModelCalls: acquisition.modelCalls + transferResults.length,
      totalPlannedModelCalls: program.design.maximumTotalModelCalls
    });
    let retrievalPack = null;
    if (scheduled.arm === 'pack') {
      const trustedLessons = scheduled.trackId === 'mechanism'
        ? [acquisition.trustedLesson]
        : [utilityLessons.get(item.lessonId)];
      retrievalPack = buildRetrievalPack({
        capsule: track.capsule,
        task: item.prompt,
        conceptIds: item.conceptIds,
        trustedLessons,
        candidateLessons: [],
        mistakeWarnings: [],
        now: program.generatedAt,
        maxTokens: track.analysisPlan.maximumRetrievalPackTokens
      });
      writeJson(path.join(trialDir, 'retrieval_pack.json'), retrievalPack);
    }
    const result = runOne({
      trialDir,
      trialId,
      ordinal: scheduled.ordinal,
      trackId: scheduled.trackId,
      pairId: scheduled.pairId,
      arm: scheduled.arm,
      sessionId: scheduled.sessionId,
      capsule: track.capsule,
      item,
      examId: `${programId}-${scheduled.trackId}-${item.itemId}-v0`,
      learningContext: retrievalPack ? JSON.stringify(retrievalPack) : null,
      evidenceRole: `${scheduled.trackId}_paired_${scheduled.arm}`,
      retrievalPackEstimatedTokens: retrievalPack?.estimatedTokens || 0
    });
    transferResults.push(result);
  }

  state('running', {
    phase: 'analysis',
    completedModelCalls: acquisition.modelCalls + transferResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls
  });
  const analysis = analyzeGoNoGoProgram({ program, trials: transferResults, acquisition });
  writeJson(path.join(artifactRoot, 'trial_results.json'), transferResults.sort((a, b) => a.ordinal - b.ordinal));
  writeJson(path.join(artifactRoot, 'analysis.json'), analysis);
  const manifestFiles = allFiles(artifactRoot)
    .filter((file) => !file.endsWith('artifact_manifest.json') && file !== statePath)
    .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0',
    runId: programId,
    generatedAt: new Date().toISOString(),
    files: manifestFiles,
    commands: [command],
    truthBoundary: analysis.truthBoundary
  });
  state('completed', {
    phase: 'terminal',
    completedModelCalls: acquisition.modelCalls + transferResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen: transferResults.length === program.design.transferTrials,
    programPass: analysis.programPass,
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
    programId,
    generatedAt: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    completedTransferTrials: transferResults.length,
    truthBoundary: 'The capped validation did not complete mechanically; no retrieval-benefit or Learning OS claim is allowed.'
  };
  writeJson(path.join(artifactRoot, 'blocker.json'), blocker);
  state('blocked', {
    phase: 'terminal',
    completedTransferTrials: transferResults.length,
    totalPlannedModelCalls: program.design.maximumTotalModelCalls,
    blockerPath: path.join(artifactRoot, 'blocker.json'),
    reason: error.message,
    truthBoundary: blocker.truthBoundary
  });
  console.error(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exitCode = 1;
}
