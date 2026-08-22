import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeNovelMathCalibration,
  analyzeNovelMathEfficacyTrack,
  analyzeNovelMathProgram,
  analyzeNovelMathRegression,
  analyzeRestartIntegrity,
  buildMicrotheory,
  buildNovelMathProgram,
  combinePair,
  twistPair
} from '../src/novel-math-experiment.mjs';

const generatedAt = '2026-07-26T03:00:00.000Z';

function program(overrides = {}) {
  const record = buildNovelMathProgram({
    validationId: 'novel-math-test',
    seed: 'fixed-novel-math-seed',
    generatedAt,
    ...overrides
  });
  record.runtime.workerProvenance = {
    command: 'codex',
    explicitOverride: false,
    claimable: true,
    resolvedPath: '/fixture/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex',
    version: 'codex-cli 0.144.1',
    executableSha256: 'a'.repeat(64)
  };
  return record;
}

function trial({ phase = 'immediate', trackId, pairId, itemId = pairId, arm, passed, ordinal, valid = true }) {
  return {
    schemaVersion: 'cortex.learning_os.novel_math_trial_result.v0',
    trialId: `${phase}-${trackId}-${pairId}-${arm}`,
    phase,
    ordinal,
    trackId,
    pairId,
    itemId,
    arm,
    sessionId: `${phase}-${trackId}-${pairId}-${arm}`,
    valid,
    invalidReasons: valid ? [] : ['test_invalid'],
    passed,
    observedToolEventCount: 0,
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    usage: { input_tokens: arm === 'pack' ? 900 : 500, output_tokens: 20 },
    retrievalPackEstimatedTokens: arm === 'pack' ? 300 : 0,
    startedAt: '2026-07-26T03:00:00.000Z',
    completedAt: arm === 'pack' ? '2026-07-26T03:00:02.000Z' : '2026-07-26T03:00:01.000Z'
  };
}

function pairedTrials(track, { packPass = true, noPackPass = false, phase = 'immediate' } = {}) {
  let ordinal = 0;
  return track.items.flatMap((item) => [
    trial({ phase, trackId: track.trackId, pairId: item.pairId, itemId: item.itemId, arm: 'pack', passed: packPass, ordinal: ++ordinal }),
    trial({ phase, trackId: track.trackId, pairId: item.pairId, itemId: item.itemId, arm: 'no_pack', passed: noPackPass, ordinal: ++ordinal })
  ]);
}

test('novel-math program freezes 225 calls, disjoint theories, paired arms, and unique sessions', () => {
  const first = program();
  const second = program();
  assert.deepEqual(first, second);
  assert.equal(first.design.maximumTotalModelCalls, 225);
  assert.equal(first.design.calibrationModelCalls, 12);
  assert.equal(first.design.acquisitionModelCalls, 3);
  assert.equal(first.design.immediateModelCalls, 170);
  assert.equal(first.design.postRestartModelCalls, 40);
  assert.notEqual(first.calibration.theory.digest, first.targetTheory.digest);
  assert.notEqual(first.calibration.theory.name, first.targetTheory.name);
  assert.equal(first.immediateSchedule.length, 170);
  assert.equal(first.durabilitySchedule.length, 40);
  for (const track of Object.values(first.tracks)) {
    for (const item of track.items) {
      const schedule = track.trackId === 'durability' ? first.durabilitySchedule : first.immediateSchedule;
      const rows = schedule.filter((row) => row.trackId === track.trackId && row.pairId === item.pairId);
      assert.equal(rows.length, 2);
      assert.deepEqual(new Set(rows.map((row) => row.arm)), new Set(['pack', 'no_pack']));
    }
  }
  const sessions = [
    ...first.calibration.schedule.map((row) => row.sessionId),
    ...first.immediateSchedule.map((row) => row.sessionId),
    ...first.durabilitySchedule.map((row) => row.sessionId)
  ];
  assert.equal(new Set(sessions).size, sessions.length);
});

test('invented pair algebra applies ordered bilinear and unary rules deterministically', () => {
  const theory = buildMicrotheory('arithmetic-check-seed', 'target');
  const left = [3, 4];
  const right = [5, 6];
  const [w1, w2, w3, w4, w5, w6] = theory.combineWeights;
  const expectedCombine = [
    (w1 * 3 + w2 * 5 + w3 * 4 * 6 + theory.combineBiases[0]) % theory.leftModulus,
    (w4 * 4 + w5 * 6 + w6 * 3 * 5 + theory.combineBiases[1]) % theory.rightModulus
  ];
  assert.deepEqual(combinePair(left, right, theory), expectedCombine);
  const [u1, u2, u3, u4] = theory.twistWeights;
  assert.deepEqual(twistPair(left, theory), [
    (u1 * 3 + u2 * 4 + theory.twistBiases[0]) % theory.leftModulus,
    (u3 * 4 + u4 * 3 + theory.twistBiases[1]) % theory.rightModulus
  ]);
  assert.notDeepEqual(combinePair(left, right, theory), combinePair(right, left, theory));
});

test('calibration proceeds only when disjoint no-pack headroom is confirmed', () => {
  const p = program();
  const failing = p.calibration.items.map((item, index) => trial({
    phase: 'calibration',
    trackId: 'calibration',
    pairId: item.pairId,
    itemId: item.itemId,
    arm: 'no_pack',
    passed: false,
    ordinal: index + 1
  }));
  assert.equal(analyzeNovelMathCalibration({ program: p, trials: failing }).calibrationPass, true);
  const easy = failing.map((row) => ({ ...row, passed: true }));
  const analysis = analyzeNovelMathCalibration({ program: p, trials: easy });
  assert.equal(analysis.calibrationPass, false);
  assert.equal(analysis.decision, 'headroom_not_confirmed_stop');
});

test('direct and compositional efficacy gates pass a strong paired effect and reject a null effect', () => {
  const p = program();
  for (const track of [p.tracks.direct, p.tracks.composition]) {
    const passing = analyzeNovelMathEfficacyTrack({ track, trials: pairedTrials(track) });
    assert.equal(passing.trackPass, true);
    assert.equal(passing.packAccuracy, 1);
    assert.equal(passing.noPackAccuracy, 0);
    assert.equal(passing.exactMcNemarTwoSidedP <= 0.01, true);
    const nullResult = analyzeNovelMathEfficacyTrack({ track, trials: pairedTrials(track, { noPackPass: true }) });
    assert.equal(nullResult.trackPass, false);
    assert.equal(nullResult.gates.headroomGate, false);
    assert.equal(nullResult.gates.liftGate, false);
  }
});

test('ordinary-math regression detects interference from an irrelevant pack', () => {
  const p = program();
  const noHarm = analyzeNovelMathRegression({ track: p.tracks.regression, trials: pairedTrials(p.tracks.regression, { noPackPass: true }) });
  assert.equal(noHarm.regressionPass, true);
  const trials = pairedTrials(p.tracks.regression, { noPackPass: true });
  for (const row of trials.filter((candidate) => candidate.arm === 'pack').slice(0, 2)) row.passed = false;
  const harmed = analyzeNovelMathRegression({ track: p.tracks.regression, trials });
  assert.equal(harmed.regressionPass, false);
  assert.equal(harmed.gates.nonInterferenceGate, false);
});

test('restart integrity requires a distinct process nonce and stable lesson digest', () => {
  const checkpoint = { processNonce: 'immediate', processId: 100, completedAt: '2026-07-26T03:05:00.000Z', trustedLessonSha256: 'abc' };
  const invocation = { processNonce: 'durability', processId: 101, startedAt: '2026-07-26T03:05:01.000Z' };
  assert.equal(analyzeRestartIntegrity({ checkpoint, durabilityInvocation: invocation, trustedLessonSha256: 'abc' }).restartIntegrityPass, true);
  assert.equal(analyzeRestartIntegrity({ checkpoint, durabilityInvocation: { ...invocation, processNonce: 'immediate' }, trustedLessonSha256: 'abc' }).restartIntegrityPass, false);
  assert.equal(analyzeRestartIntegrity({ checkpoint, durabilityInvocation: invocation, trustedLessonSha256: 'changed' }).restartIntegrityPass, false);
});

test('full analysis separates mechanical green from threshold pass', () => {
  const p = program();
  const calibrationTrials = p.calibration.items.map((item, index) => trial({
    phase: 'calibration', trackId: 'calibration', pairId: item.pairId, itemId: item.itemId, arm: 'no_pack', passed: false, ordinal: index + 1
  }));
  const immediateTrials = [
    ...pairedTrials(p.tracks.direct),
    ...pairedTrials(p.tracks.composition),
    ...pairedTrials(p.tracks.regression, { noPackPass: true })
  ];
  const durabilityTrials = pairedTrials(p.tracks.durability, { phase: 'post_restart' });
  const acquisitionTrials = ['baseline', 'correction', 'retest'].map((role, index) => trial({
    phase: 'acquisition', trackId: 'acquisition', pairId: role, arm: role === 'baseline' ? 'no_context' : 'training_context', passed: role !== 'baseline', ordinal: index + 1
  }));
  const acquisition = { valid: true, baselineFailed: true, correctionPassed: true, retestPassed: true, promoted: true, modelCalls: 3, trials: acquisitionTrials };
  const checkpoint = { processNonce: 'first', processId: 1, completedAt: '2026-07-26T03:05:00.000Z', trustedLessonSha256: 'digest' };
  const durabilityInvocation = { processNonce: 'second', processId: 2, startedAt: '2026-07-26T03:05:01.000Z' };
  const analysis = analyzeNovelMathProgram({
    program: p,
    calibrationTrials,
    acquisition,
    immediateTrials,
    durabilityTrials,
    checkpoint,
    durabilityInvocation,
    trustedLessonSha256: 'digest'
  });
  assert.equal(analysis.completedModelCalls, 225);
  assert.equal(analysis.mechanicalGreen, true);
  assert.equal(analysis.thresholdPass, true);
  const nullDirect = immediateTrials.map((row) => row.trackId === 'direct' && row.arm === 'no_pack' ? { ...row, passed: true } : row);
  const noGo = analyzeNovelMathProgram({
    program: p,
    calibrationTrials,
    acquisition,
    immediateTrials: nullDirect,
    durabilityTrials,
    checkpoint,
    durabilityInvocation,
    trustedLessonSha256: 'digest'
  });
  assert.equal(noGo.mechanicalGreen, true);
  assert.equal(noGo.thresholdPass, false);
  assert.equal(noGo.decision, 'no_go_math_section_not_production_qualified');
});

test('plan-only freezes runtime and resumed execution rejects drift', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-novel-math-plan-'));
  const artifactRoot = path.join(temp, 'artifact');
  const runner = new URL('../src/run-novel-math-validation.mjs', import.meta.url);
  try {
    const planned = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--validation-id', 'frozen-novel-math', '--seed', 'frozen-seed', '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.equal(planned.status, 0, planned.stderr);
    const programRecord = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'program.json'), 'utf8'));
    assert.equal(programRecord.design.maximumTotalModelCalls, 225);
    const mismatch = spawnSync(process.execPath, [runner.pathname, '--resume', '--phase', 'immediate', '--validation-id', 'frozen-novel-math', '--model', 'different-model', '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /conflict with frozen program: --model/);
    const state = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'campaign_state.json'), 'utf8'));
    assert.equal(state.status, 'blocked');
    assert.equal(state.thresholdPass, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('fake worker completes all 225 calls across a real process restart and passes independent recomputation', { timeout: 120_000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-novel-math-lifecycle-'));
  const artifactRoot = path.join(temp, 'artifact');
  const verificationPath = path.join(temp, 'verification.json');
  const runner = new URL('../src/run-novel-math-validation.mjs', import.meta.url);
  const verifier = new URL('../src/verify-novel-math-artifacts.mjs', import.meta.url);
  const worker = new URL('./fake-codex-worker.mjs', import.meta.url);
  const validationId = 'fake-novel-math-lifecycle';
  try {
    const planned = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--validation-id', validationId, '--seed', 'fake-lifecycle-seed', '--codex-command', worker.pathname, '--artifact-root', artifactRoot], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(planned.status, 0, planned.stderr);
    const env = { ...process.env, CLOS_FAKE_PROGRAM_PATH: path.join(artifactRoot, 'program.json') };
    const immediate = spawnSync(process.execPath, [runner.pathname, '--resume', '--phase', 'immediate', '--validation-id', validationId, '--artifact-root', artifactRoot], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(immediate.status, 0, immediate.stderr);
    const waiting = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'campaign_state.json'), 'utf8'));
    assert.equal(waiting.status, 'awaiting_restart');
    assert.equal(waiting.thresholdPass, false);
    const durability = spawnSync(process.execPath, [runner.pathname, '--resume', '--phase', 'durability', '--validation-id', validationId, '--artifact-root', artifactRoot], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(durability.status, 0, durability.stderr);
    const verified = spawnSync(process.execPath, [verifier.pathname, '--artifact-root', artifactRoot, '--out', verificationPath], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(verified.status, 0, verified.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'campaign_state.json'), 'utf8'));
    const analysis = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'analysis.json'), 'utf8'));
    const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
    assert.equal(state.completedModelCalls, 225);
    assert.equal(state.mechanicalGreen, true);
    assert.equal(state.thresholdPass, false);
    assert.equal(analysis.restartIntegrity.restartIntegrityPass, true);
    assert.equal(analysis.frozenOutcomePass, true);
    assert.equal(analysis.providerEvidence.workerCommandPass, false);
    assert.equal(analysis.decision, 'nonclaimable_worker_override');
    assert.deepEqual(analysis.allowedClaims, ['synthetic_harness_validation_completed']);
    assert.equal(verification.artifactIntegrityPass, true);
    assert.equal(verification.thresholdPass, false);

    const tamperedTrialPath = path.join(artifactRoot, 'immediate', 'trials', fs.readdirSync(path.join(artifactRoot, 'immediate', 'trials'))[0], 'trial_result.json');
    const tamperedTrial = JSON.parse(fs.readFileSync(tamperedTrialPath, 'utf8'));
    tamperedTrial.passed = !tamperedTrial.passed;
    fs.writeFileSync(tamperedTrialPath, `${JSON.stringify(tamperedTrial, null, 2)}\n`);
    const tamperedVerificationPath = path.join(temp, 'tampered-verification.json');
    const tampered = spawnSync(process.execPath, [verifier.pathname, '--artifact-root', artifactRoot, '--out', tamperedVerificationPath], { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(tampered.status, 0);
    const tamperedVerification = JSON.parse(fs.readFileSync(tamperedVerificationPath, 'utf8'));
    assert.equal(tamperedVerification.artifactIntegrityPass, false);
    assert.match(tamperedVerification.errors.join('; '), /manifest digest mismatch|stored final analysis differs/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
