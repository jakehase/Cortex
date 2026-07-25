import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePairedExperiment, buildPairedExperiment, exactMcNemarP } from '../src/ab-experiment.mjs';
import { observedToolEvents } from '../src/model-answer-runner.mjs';

function trial(pairId, arm, passed, valid = true) {
  return { trialId: `${pairId}-${arm}`, pairId, arm, valid, passed };
}

test('paired experiment generation is deterministic, balanced, and identical-item by construction', () => {
  const options = { experimentId: 'ab-test', seed: 'fixed-seed', generatedAt: '2026-07-25T13:00:00.000Z' };
  const first = buildPairedExperiment(options);
  const second = buildPairedExperiment(options);
  assert.deepEqual(first, second);
  assert.equal(first.items.length, 27);
  assert.equal(first.schedule.length, 54);
  assert.equal(first.analysisPlan.minimumValidPairs, 24);
  assert.equal(new Set(first.schedule.map((row) => row.sessionId)).size, 54);
  for (const item of first.items) {
    const [left, right] = item.prompt.match(/(\d+) × (\d+)/).slice(1);
    assert.equal((BigInt(left) * BigInt(right)).toString(), item.checker.expected);
    const rows = first.schedule.filter((row) => row.pairId === item.pairId);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.arm)), new Set(['pack', 'no_pack']));
  }
});

test('paired analysis refuses a benefit claim when arms tie', () => {
  const experiment = buildPairedExperiment({ experimentId: 'tie', seed: 'tie-seed', pairCount: 24 });
  const trials = experiment.items.flatMap(({ pairId }) => [trial(pairId, 'pack', true), trial(pairId, 'no_pack', true)]);
  const result = analyzePairedExperiment({ experiment, trials });
  assert.equal(result.validPairs, 24);
  assert.equal(result.packAccuracy, 1);
  assert.equal(result.noPackAccuracy, 1);
  assert.equal(result.exactMcNemarTwoSidedP, 1);
  assert.equal(result.boundedCausalEvidence, false);
  assert.deepEqual(result.allowedClaims, ['paired_randomized_experiment_completed']);
});

test('paired analysis applies preregistered lift, validity, and exact-test gates', () => {
  const experiment = buildPairedExperiment({ experimentId: 'lift', seed: 'lift-seed', pairCount: 24 });
  const trials = experiment.items.flatMap(({ pairId }, index) => index < 6
    ? [trial(pairId, 'pack', true), trial(pairId, 'no_pack', false)]
    : [trial(pairId, 'pack', true), trial(pairId, 'no_pack', true)]);
  const result = analyzePairedExperiment({ experiment, trials, generatedAt: '2026-07-25T13:30:00.000Z' });
  assert.equal(result.packOnly, 6);
  assert.equal(result.noPackOnly, 0);
  assert.equal(result.absoluteLift, 0.25);
  assert.equal(result.exactMcNemarTwoSidedP, 0.03125);
  assert.equal(result.boundedCausalEvidence, true);
  assert.equal(result.allowedClaims.includes('bounded_retrieval_benefit_for_exact_multiplication_under_declared_configuration'), true);
  assert.equal(exactMcNemarP(5, 0), 0.0625);
});

test('an invalid trial invalidates its pair and blocks an underpowered claim', () => {
  const experiment = buildPairedExperiment({ experimentId: 'invalid', seed: 'invalid-seed', pairCount: 24 });
  const trials = experiment.items.flatMap(({ pairId }, index) => [
    trial(pairId, 'pack', true, index !== 0),
    trial(pairId, 'no_pack', index >= 6)
  ]);
  const result = analyzePairedExperiment({ experiment, trials });
  assert.equal(result.invalidPairs, 1);
  assert.equal(result.validPairs, 23);
  assert.equal(result.boundedCausalEvidence, false);
});

test('Codex event validation detects command/tool use without flagging normal reasoning or final messages', () => {
  const events = [
    { type: 'thread.started' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'private reasoning' } },
    { type: 'item.started', item: { type: 'command_execution', command: 'python -c pass' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"answers":[]}' } }
  ];
  const detected = observedToolEvents(events);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].item.type, 'command_execution');
});
