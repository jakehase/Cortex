import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeGoNoGoProgram,
  buildGoNoGoProgram,
  validateUtilityFixture
} from '../src/go-no-go-experiment.mjs';

function utilityFixture(itemCount = 24) {
  const lessons = [
    { lessonId: 'lesson-a', conceptId: 'concept-a', rule: 'For private rule A, choose A.', sourceRef: '/private/a' },
    { lessonId: 'lesson-b', conceptId: 'concept-b', rule: 'For private rule B, choose B.', sourceRef: '/private/b' }
  ];
  const items = Array.from({ length: itemCount }, (_, index) => {
    const lesson = lessons[index % lessons.length];
    const expected = lesson.lessonId === 'lesson-a' ? 'A' : 'B';
    return {
      itemId: `utility-test-${String(index + 1).padStart(3, '0')}`,
      lessonId: lesson.lessonId,
      prompt: `Apply ${lesson.lessonId}. A) A B) B C) C D) D`,
      expected
    };
  });
  return {
    schemaVersion: 'cortex.learning_os.private_utility_fixture.v0',
    fixtureId: 'private-test-fixture',
    truthBoundary: 'test only',
    lessons,
    items
  };
}

function trial({ trackId, pairId, arm, passed, ordinal }) {
  return {
    schemaVersion: 'cortex.learning_os.go_no_go_trial_result.v0',
    trialId: `${trackId}-${pairId}-${arm}`,
    ordinal,
    trackId,
    pairId,
    arm,
    valid: true,
    passed,
    usage: { input_tokens: arm === 'pack' ? 1000 : 500 },
    retrievalPackEstimatedTokens: arm === 'pack' ? 300 : 0,
    startedAt: '2026-07-25T17:00:00.000Z',
    completedAt: arm === 'pack' ? '2026-07-25T17:00:02.000Z' : '2026-07-25T17:00:01.000Z'
  };
}

test('go/no-go program deterministically freezes two tracks and unique fresh sessions', () => {
  const options = {
    programId: 'go-no-go-test',
    seed: 'fixed-seed',
    utilityFixture: utilityFixture(27),
    generatedAt: '2026-07-25T17:00:00.000Z'
  };
  const first = buildGoNoGoProgram(options);
  const second = buildGoNoGoProgram(options);
  assert.deepEqual(first, second);
  assert.equal(first.tracks.mechanism.pairCount, 27);
  assert.equal(first.tracks.utility.pairCount, 27);
  assert.equal(first.schedule.length, 108);
  assert.equal(first.design.maximumTotalModelCalls, 111);
  assert.equal(new Set(first.schedule.map((row) => row.sessionId)).size, 108);
  assert.equal(first.tracks.mechanism.rule.digest.length, 64);
  assert.equal(first.tracks.mechanism.items.every((item) => /^Q\d{2}-\d{2}$/.test(item.checker.expected)), true);
  for (const track of Object.values(first.tracks)) {
    for (const item of track.items) {
      const rows = track.schedule.filter((row) => row.pairId === item.pairId);
      assert.equal(rows.length, 2);
      assert.deepEqual(new Set(rows.map((row) => row.arm)), new Set(['pack', 'no_pack']));
    }
  }
});

test('private utility fixture validation fails closed on missing lesson coverage', () => {
  const fixture = utilityFixture();
  assert.equal(validateUtilityFixture(fixture).ok, true);
  fixture.items = fixture.items.filter((item) => item.lessonId === 'lesson-a');
  const invalid = validateUtilityFixture(fixture);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('; '), /lesson-b/);
});

test('program passes only when acquisition and both paired tracks pass effect, cost, and regression gates', () => {
  const program = buildGoNoGoProgram({
    programId: 'passing-program',
    seed: 'passing-seed',
    utilityFixture: utilityFixture(27),
    generatedAt: '2026-07-25T17:00:00.000Z'
  });
  let ordinal = 0;
  const trials = Object.values(program.tracks).flatMap((track) => track.items.flatMap((item) => [
    trial({ trackId: track.trackId, pairId: item.pairId, arm: 'pack', passed: true, ordinal: ++ordinal }),
    trial({ trackId: track.trackId, pairId: item.pairId, arm: 'no_pack', passed: false, ordinal: ++ordinal })
  ]));
  const analysis = analyzeGoNoGoProgram({ program, trials, acquisition: { promoted: true }, generatedAt: '2026-07-25T18:00:00.000Z' });
  assert.equal(analysis.tracks.mechanism.trackPass, true);
  assert.equal(analysis.tracks.utility.trackPass, true);
  assert.equal(analysis.programPass, true);
  assert.equal(analysis.decision, 'go_bounded_shadow_integration_candidate');
});

test('a utility null result forces an overall no-go despite a passing mechanism track', () => {
  const program = buildGoNoGoProgram({
    programId: 'null-program',
    seed: 'null-seed',
    utilityFixture: utilityFixture(27),
    generatedAt: '2026-07-25T17:00:00.000Z'
  });
  let ordinal = 0;
  const trials = Object.values(program.tracks).flatMap((track) => track.items.flatMap((item) => {
    const noPackPass = track.trackId === 'utility';
    return [
      trial({ trackId: track.trackId, pairId: item.pairId, arm: 'pack', passed: true, ordinal: ++ordinal }),
      trial({ trackId: track.trackId, pairId: item.pairId, arm: 'no_pack', passed: noPackPass, ordinal: ++ordinal })
    ];
  }));
  const analysis = analyzeGoNoGoProgram({ program, trials, acquisition: { promoted: true } });
  assert.equal(analysis.tracks.mechanism.trackPass, true);
  assert.equal(analysis.tracks.utility.trackPass, false);
  assert.equal(analysis.programPass, false);
  assert.equal(analysis.decision, 'no_go_preserve_as_verified_memory_toolkit');
});

test('resumed validation fails closed when explicit runtime arguments conflict with the frozen program', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-go-no-go-plan-'));
  const fixturePath = path.join(temp, 'fixture.json');
  const artifactRoot = path.join(temp, 'artifact');
  fs.writeFileSync(fixturePath, `${JSON.stringify(utilityFixture(), null, 2)}\n`);
  const runner = new URL('../src/run-go-no-go-validation.mjs', import.meta.url);
  try {
    const planned = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--program-id', 'frozen-program', '--seed', 'fixed-seed', '--thinking', 'low', '--utility-fixture', fixturePath, '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.equal(planned.status, 0, planned.stderr);
    const mismatch = spawnSync(process.execPath, [runner.pathname, '--plan-only', '--resume', '--program-id', 'frozen-program', '--thinking', 'high', '--artifact-root', artifactRoot], { encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /conflict with frozen program: --thinking/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
