#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeNovelMathProgram, NOVEL_MATH_RESULT_VERSION } from './novel-math-experiment.mjs';
import { validateRecord } from './contracts.mjs';
import { sha256File } from './hash.mjs';
import { readJson, writeJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const artifactArgument = value('--artifact-root');
if (!artifactArgument) throw new Error('--artifact-root is required');
const artifactRoot = path.resolve(artifactArgument);
const outputPath = path.resolve(value('--out') || `${artifactRoot}-independent-verification.json`);
const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function verifyTrialShape(trial, label) {
  check(trial?.schemaVersion === NOVEL_MATH_RESULT_VERSION, `${label}: wrong trial schema`);
  check(typeof trial?.trialId === 'string' && trial.trialId.length > 0, `${label}: missing trialId`);
  check(typeof trial?.sessionId === 'string' && trial.sessionId.length > 0, `${label}: missing sessionId`);
  check(Array.isArray(trial?.invalidReasons), `${label}: invalidReasons missing`);
  check(Number(trial?.observedToolEventCount || 0) === 0, `${label}: tool event observed`);
}

function verifySchedule(schedule, trials, label) {
  check(trials.length === schedule.length, `${label}: expected ${schedule.length} trials, found ${trials.length}`);
  const byOrdinal = new Map(trials.map((trial) => [trial.ordinal, trial]));
  check(byOrdinal.size === trials.length, `${label}: duplicate ordinal`);
  for (const row of schedule) {
    const trial = byOrdinal.get(row.ordinal ?? row.trackOrdinal);
    if (!trial) {
      errors.push(`${label}: missing ordinal ${row.ordinal ?? row.trackOrdinal}`);
      continue;
    }
    check(trial.pairId === row.pairId, `${label}: pair mismatch at ordinal ${row.ordinal ?? row.trackOrdinal}`);
    check(trial.trackId === row.trackId, `${label}: track mismatch at ordinal ${row.ordinal ?? row.trackOrdinal}`);
    check(trial.arm === row.arm, `${label}: arm mismatch at ordinal ${row.ordinal ?? row.trackOrdinal}`);
    check(trial.sessionId === row.sessionId, `${label}: session mismatch at ordinal ${row.ordinal ?? row.trackOrdinal}`);
  }
}

try {
  const programPath = path.join(artifactRoot, 'program.json');
  const program = readJson(programPath);
  const preregistration = readJson(path.join(artifactRoot, 'preregistration.json'));
  const state = readJson(path.join(artifactRoot, 'campaign_state.json'));
  const analysis = readJson(path.join(artifactRoot, 'analysis.json'));
  const manifest = readJson(path.join(artifactRoot, 'artifact_manifest.json'));
  const calibrationTrials = readJson(path.join(artifactRoot, 'calibration', 'trial_results.json'), []);
  const acquisition = readJson(path.join(artifactRoot, 'acquisition', 'acquisition_summary.json'), {});
  const immediateTrials = readJson(path.join(artifactRoot, 'immediate', 'trial_results.json'), []);
  const durabilityTrials = readJson(path.join(artifactRoot, 'durability', 'trial_results.json'), []);
  const checkpoint = readJson(path.join(artifactRoot, 'immediate', 'restart_checkpoint.json'));
  const durabilityInvocation = readJson(path.join(artifactRoot, 'durability', 'invocation.json'));
  const trustedLessonPath = path.join(artifactRoot, 'acquisition', 'promotion', 'trusted_lesson.json');
  const trustedLesson = readJson(trustedLessonPath);
  const promotionProof = readJson(path.join(artifactRoot, 'acquisition', 'promotion', 'promotion_proof.json'));
  const acquisitionTrials = ['baseline', 'correction', 'retest'].map((role) => ({
    role,
    trial: readJson(path.join(artifactRoot, 'acquisition', role, 'trial_result.json'))
  }));

  check(Boolean(program), 'program.json missing');
  check(Boolean(preregistration), 'preregistration.json missing');
  check(Boolean(state), 'campaign_state.json missing');
  check(Boolean(analysis), 'analysis.json missing');
  check(Boolean(manifest), 'artifact_manifest.json missing');
  if (program && preregistration) {
    check(preregistration.programSha256 === sha256(fs.readFileSync(programPath)), 'program digest differs from preregistration');
    check(preregistration.sourceGitCommit === program.source?.gitCommit, 'preregistration source commit mismatch');
    check(program.source?.gitCommit === gitCommit(), 'verifier checkout is not the frozen source commit');
    for (const [relative, digest] of Object.entries(program.source?.files || {})) {
      const sourcePath = path.join(CLOS_ROOT, relative);
      check(fs.existsSync(sourcePath), `source file missing: ${relative}`);
      if (fs.existsSync(sourcePath)) check(sha256File(sourcePath) === digest, `source file digest mismatch: ${relative}`);
    }
    const currentWorkerProvenance = workerProvenance(program.runtime.workerCommand, program.runtime.workerProvenance?.explicitOverride === true);
    check(same(program.runtime.workerProvenance, currentWorkerProvenance), 'worker executable provenance differs from preregistration');
  }
  if (manifest) {
    check(manifest.sourceGitCommit === program?.source?.gitCommit, 'manifest source commit mismatch');
    const listed = new Set((manifest.files || []).map((row) => row.path));
    const actual = new Set(allFiles(artifactRoot)
      .filter((file) => file !== path.join(artifactRoot, 'campaign_state.json') && file !== path.join(artifactRoot, 'artifact_manifest.json'))
      .map((file) => path.relative(artifactRoot, file)));
    check(same([...listed].sort(), [...actual].sort()), 'manifest file set does not exactly match artifact files');
    for (const row of manifest.files || []) {
      const file = path.join(artifactRoot, row.path);
      check(fs.existsSync(file), `manifest file missing: ${row.path}`);
      if (fs.existsSync(file)) check(sha256File(file) === row.sha256, `manifest digest mismatch: ${row.path}`);
    }
  }

  check(same(acquisition?.trials || [], acquisitionTrials.map(({ trial }) => trial)), 'acquisition summary trials differ from trial artifacts');
  for (const { role, trial } of acquisitionTrials) {
    verifyTrialShape(trial, `acquisition.${role}`);
    if (program && trial) {
      const roleIndex = ['baseline', 'correction', 'retest'].indexOf(role);
      check(trial.trialId === `${program.validationId}-acquisition-${role}`, `acquisition.${role}: trialId mismatch`);
      check(trial.itemId === program.acquisition.items[roleIndex].itemId, `acquisition.${role}: item mismatch`);
      check(trial.sessionId === `${program.validationId}-acquisition-${role}-${sha256(`${program.seed}:acquisition:${role}`).slice(0, 12)}`, `acquisition.${role}: session mismatch`);
      check(trial.arm === (role === 'baseline' ? 'no_context' : 'training_context'), `acquisition.${role}: arm mismatch`);
    }
  }
  for (const [index, trial] of calibrationTrials.entries()) verifyTrialShape(trial, `calibration[${index}]`);
  for (const [index, trial] of immediateTrials.entries()) verifyTrialShape(trial, `immediate[${index}]`);
  for (const [index, trial] of durabilityTrials.entries()) verifyTrialShape(trial, `durability[${index}]`);
  if (program) {
    const calibrationSchedule = program.calibration.schedule.map((row) => ({ ...row, trackId: 'calibration' }));
    verifySchedule(calibrationSchedule, calibrationTrials, 'calibration');
    verifySchedule(program.immediateSchedule, immediateTrials, 'immediate');
    verifySchedule(program.durabilitySchedule, durabilityTrials, 'durability');
    const allSessionIds = [...calibrationTrials, ...immediateTrials, ...durabilityTrials].map((trial) => trial.sessionId);
    check(new Set(allSessionIds).size === allSessionIds.length, 'trial session ids are not globally unique');
    check(calibrationTrials.length + Number(acquisition?.modelCalls || 0) + immediateTrials.length + durabilityTrials.length === program.design.maximumTotalModelCalls, 'executed model-call count differs from frozen plan');
  }

  check(acquisition?.valid === true, 'acquisition calls were not all valid');
  check(acquisition?.baselineFailed === true, 'acquisition baseline did not fail');
  check(acquisition?.correctionPassed === true, 'acquisition correction did not pass');
  check(acquisition?.retestPassed === true, 'acquisition retest did not pass');
  check(acquisition?.promoted === true, 'acquisition lesson was not promoted');
  check(promotionProof?.promoted === true, 'promotion proof is not promoted');
  if (trustedLesson) {
    const lessonValidation = validateRecord(trustedLesson);
    check(lessonValidation.ok, `trusted lesson schema invalid: ${lessonValidation.errors.join('; ')}`);
    check(trustedLesson.capsuleId === program?.capsule?.capsuleId, 'trusted lesson capsule mismatch');
    check(trustedLesson.rule === program?.targetTheory?.ruleText, 'trusted lesson rule differs from frozen target theory');
  } else {
    errors.push('trusted lesson missing');
  }
  check(checkpoint?.trustedLessonSha256 === sha256File(trustedLessonPath), 'trusted lesson digest changed after immediate checkpoint');
  check(checkpoint?.processNonce !== durabilityInvocation?.processNonce, 'immediate and durability invocations are not distinct');

  if (program && analysis) {
    const recomputed = analyzeNovelMathProgram({
      program,
      calibrationTrials,
      acquisition,
      immediateTrials,
      durabilityTrials,
      checkpoint,
      durabilityInvocation,
      trustedLessonSha256: sha256File(trustedLessonPath),
      generatedAt: analysis.generatedAt
    });
    check(same(recomputed, analysis), 'stored final analysis differs from independent recomputation');
  }
  check(state?.status === 'completed' && state?.terminal === true, 'campaign state is not terminal completed');
  check(state?.mechanicalGreen === analysis?.mechanicalGreen, 'state mechanicalGreen differs from analysis');
  check(state?.thresholdPass === analysis?.thresholdPass, 'state thresholdPass differs from analysis');

  const result = {
    schemaVersion: 'cortex.learning_os.novel_math_independent_verification.v0',
    validationId: program?.validationId || null,
    verifiedAt: new Date().toISOString(),
    artifactRoot,
    sourceGitCommit: program?.source?.gitCommit || null,
    artifactIntegrityPass: errors.length === 0,
    mechanicalGreen: errors.length === 0 && analysis?.mechanicalGreen === true,
    thresholdPass: errors.length === 0 && analysis?.thresholdPass === true,
    decision: errors.length === 0
      ? (analysis?.thresholdPass ? 'verified_threshold_pass' : 'verified_threshold_no_go')
      : 'verification_failed',
    errors,
    allowedClaims: errors.length === 0 ? (analysis?.allowedClaims || []) : [],
    truthBoundary: errors.length === 0
      ? analysis?.truthBoundary
      : 'Artifact integrity or independent recomputation failed; no benchmark completion or math-learning claim is allowed.'
  };
  writeJson(outputPath, result);
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (error) {
  const result = {
    schemaVersion: 'cortex.learning_os.novel_math_independent_verification.v0',
    verifiedAt: new Date().toISOString(),
    artifactRoot,
    artifactIntegrityPass: false,
    mechanicalGreen: false,
    thresholdPass: false,
    decision: 'verification_failed',
    errors: [error.message],
    truthBoundary: 'Verifier execution failed; no benchmark completion or math-learning claim is allowed.'
  };
  writeJson(outputPath, result);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
