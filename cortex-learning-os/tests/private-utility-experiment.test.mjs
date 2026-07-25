import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzePrivateUtilityCalibration,
  analyzePrivateUtilityHoldout,
  buildPrivateUtilityProgram,
  validateDisjointOpenUtilityFixtures
} from '../src/private-utility-experiment.mjs';

function fixture(poolType, prefix, lessonCount) {
  const lessons = Array.from({ length: lessonCount }, (_, index) => ({
    lessonId: `${prefix}-lesson-${index + 1}`,
    factId: `${prefix}-fact-${index + 1}`,
    conceptId: `${prefix}-concept-${index + 1}`,
    rule: `The exact private ${prefix} answer ${index + 1} is VALUE-${prefix}-${index + 1}.`,
    sourceRef: `/private/${prefix}/${index + 1}`,
    expectedAnswer: `VALUE-${prefix}-${index + 1}`
  }));
  return {
    schemaVersion: 'cortex.learning_os.private_open_utility_fixture.v0',
    fixtureId: `${prefix}-fixture`,
    poolType,
    truthBoundary: 'unit test only',
    lessons,
    items: lessons.flatMap((lesson, index) => [1, 2].map((paraphrase) => ({
      itemId: `${prefix}-item-${index + 1}-${paraphrase}`,
      lessonId: lesson.lessonId,
      prompt: `Return private ${prefix} fact ${index + 1}, paraphrase ${paraphrase}.`
    })))
  };
}

function result({ phase, pairId, clusterId, arm, passed, ordinal }) {
  return {
    schemaVersion: 'cortex.learning_os.private_utility_trial_result.v0',
    trialId: `${phase}-${pairId}-${arm}`,
    phase,
    pairId,
    clusterId,
    arm,
    ordinal,
    valid: true,
    passed,
    usage: { input_tokens: arm === 'pack' ? 1000 : 500 },
    retrievalPackEstimatedTokens: arm === 'pack' ? 250 : 0,
    startedAt: '2026-07-25T19:00:00.000Z',
    completedAt: arm === 'pack' ? '2026-07-25T19:00:02.000Z' : '2026-07-25T19:00:01.000Z'
  };
}

function program() {
  return buildPrivateUtilityProgram({
    validationId: 'private-utility-test',
    seed: 'fixed-private-seed',
    calibrationFixture: fixture('calibration', 'cal', 12),
    holdoutFixture: fixture('holdout', 'hold', 30),
    generatedAt: '2026-07-25T19:00:00.000Z'
  });
}

test('private utility program freezes disjoint calibration and clustered holdout schedules deterministically', () => {
  const first = program();
  const second = program();
  assert.deepEqual(first, second);
  assert.equal(first.design.calibrationModelCalls, 24);
  assert.equal(first.design.holdoutModelCalls, 120);
  assert.equal(first.design.maximumTotalModelCalls, 144);
  assert.equal(first.calibration.lessonCount, 12);
  assert.equal(first.holdout.clusterCount, 30);
  assert.equal(first.holdout.pairCount, 60);
  const sessions = [...first.calibration.schedule, ...first.holdout.schedule].map((row) => row.sessionId);
  assert.equal(new Set(sessions).size, 144);
  for (const item of first.holdout.items) {
    const rows = first.holdout.schedule.filter((row) => row.pairId === item.pairId);
    assert.deepEqual(new Set(rows.map((row) => row.arm)), new Set(['pack', 'no_pack']));
  }
});

test('fixture disjointness fails closed on reused fact identifiers', () => {
  const calibration = fixture('calibration', 'cal', 12);
  const holdout = fixture('holdout', 'hold', 30);
  holdout.lessons[0].factId = calibration.lessons[0].factId;
  const validation = validateDisjointOpenUtilityFixtures(calibration, holdout);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('; '), /factId/);
});

test('calibration passes only when no-pack headroom is confirmed', () => {
  const p = program();
  const failingBaseline = p.calibration.items.map((item, index) => result({ phase: 'calibration', pairId: item.pairId, clusterId: item.clusterId, arm: 'no_pack', passed: false, ordinal: index + 1 }));
  const pass = analyzePrivateUtilityCalibration({ program: p, trials: failingBaseline });
  assert.equal(pass.calibrationPass, true);
  assert.equal(pass.noPackItemAccuracy, 0);
  const easyBaseline = p.calibration.items.map((item, index) => result({ phase: 'calibration', pairId: item.pairId, clusterId: item.clusterId, arm: 'no_pack', passed: true, ordinal: index + 1 }));
  const fail = analyzePrivateUtilityCalibration({ program: p, trials: easyBaseline });
  assert.equal(fail.calibrationPass, false);
  assert.equal(fail.decision, 'headroom_not_confirmed_stop_before_holdout');
});

test('clustered heldout analysis passes a strong selective private retrieval effect', () => {
  const p = program();
  let ordinal = 0;
  const trials = p.holdout.items.flatMap((item) => [
    result({ phase: 'holdout', pairId: item.pairId, clusterId: item.clusterId, arm: 'pack', passed: true, ordinal: ++ordinal }),
    result({ phase: 'holdout', pairId: item.pairId, clusterId: item.clusterId, arm: 'no_pack', passed: false, ordinal: ++ordinal })
  ]);
  const analysis = analyzePrivateUtilityHoldout({ program: p, trials });
  assert.equal(analysis.clusters.valid, 30);
  assert.equal(analysis.clusters.packOnly, 30);
  assert.equal(analysis.gates.effectGate, true);
  assert.equal(analysis.holdoutPass, true);
});

test('clustered heldout analysis rejects another ceiling-limited task set', () => {
  const p = program();
  const noPackPassingClusters = new Set([...new Set(p.holdout.items.map((item) => item.clusterId))].slice(0, 27));
  let ordinal = 0;
  const trials = p.holdout.items.flatMap((item) => [
    result({ phase: 'holdout', pairId: item.pairId, clusterId: item.clusterId, arm: 'pack', passed: true, ordinal: ++ordinal }),
    result({ phase: 'holdout', pairId: item.pairId, clusterId: item.clusterId, arm: 'no_pack', passed: noPackPassingClusters.has(item.clusterId), ordinal: ++ordinal })
  ]);
  const analysis = analyzePrivateUtilityHoldout({ program: p, trials });
  assert.equal(analysis.clusters.noPackAccuracy, 0.9);
  assert.equal(analysis.clusters.absoluteLift, 0.1);
  assert.equal(analysis.gates.effectGate, false);
  assert.equal(analysis.holdoutPass, false);
});

test('resumed private utility validation rejects fixture changes after freeze', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-private-plan-'));
  const calibrationPath = path.join(temp, 'calibration.json');
  const holdoutPath = path.join(temp, 'holdout.json');
  const artifactRoot = path.join(temp, 'artifact');
  fs.writeFileSync(calibrationPath, `${JSON.stringify(fixture('calibration', 'cal', 12), null, 2)}\n`);
  fs.writeFileSync(holdoutPath, `${JSON.stringify(fixture('holdout', 'hold', 30), null, 2)}\n`);
  const runner = new URL('../src/run-private-utility-validation.mjs', import.meta.url);
  try {
    const planned = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--validation-id', 'frozen-private', '--seed', 'fixed-seed', '--calibration-fixture', calibrationPath, '--holdout-fixture', holdoutPath, '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.equal(planned.status, 0, planned.stderr);
    const changed = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    changed.lessons[0].rule += ' changed';
    fs.writeFileSync(holdoutPath, `${JSON.stringify(changed, null, 2)}\n`);
    const mismatch = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--resume', '--validation-id', 'frozen-private', '--holdout-fixture', holdoutPath, '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /conflict with frozen program: --holdout-fixture/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
