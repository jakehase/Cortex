import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  applyAutofix,
  buildRelaunchPlan,
  classifyAutopilot,
  normalizeFocusIds,
  readAutopilotState,
  writeJson
} from '../scripts/lib/full-clone-autopilot.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function snapshot(overrides = {}) {
  return {
    summary: {},
    persistentStatus: {},
    blockerReport: {},
    programState: {},
    workerStatus: {},
    syncStatus: {},
    noProgressAudit: {},
    liveExecution: {},
    patchQueue: { merged: [], rejected: [] },
    ...overrides
  };
}

test('full-clone autopilot classifies no-progress circuit breakers as fix-then-relaunch work when another gap remains', () => {
  const result = classifyAutopilot(snapshot({
    persistentStatus: {
      status: 'blocked',
      blocker: {
        blocker: 'Persistent parity runner stopped after 5 consecutive red iterations with unchanged nextFocus and no canonical product landing delta.',
        nextFocus: ['focus.signup_onboarding']
      }
    },
    surfaceMatrix: {
      surfaces: [
        { id: 'signup_onboarding', status: 'partial', focusId: 'focus.signup_onboarding' },
        { id: 'dashboard_home', status: 'partial', focusId: 'focus.dashboard_home' }
      ]
    }
  }));
  assert.equal(result.family, 'no_progress_circuit');
  assert.equal(result.action, 'fix_then_relaunch');
  assert.deepEqual(result.nextFocus, ['focus.signup_onboarding']);
});

test('full-clone autopilot hard-blocks when rotating the saturated focus would exhaust all open gaps', () => {
  const result = classifyAutopilot(snapshot({
    persistentStatus: {
      generatedAt: '2026-04-29T20:00:00.000Z',
      status: 'blocked',
      blocker: {
        blocker: 'Persistent parity runner stopped after 5 consecutive red iterations with unchanged nextFocus and no canonical product landing delta.',
        nextFocus: ['focus.signup_onboarding']
      }
    },
    implementationScriptMtimeMs: Date.parse('2026-04-29T19:00:00.000Z'),
    surfaceMatrix: {
      surfaces: [
        { id: 'signup_onboarding', status: 'partial', focusId: 'focus.signup_onboarding' },
        { id: 'dashboard_home', status: 'all_complete', focusId: 'focus.dashboard_home' }
      ]
    }
  }));
  assert.equal(result.family, 'no_progress_circuit');
  assert.equal(result.action, 'hard_block');
  assert.equal(result.exhaustedAfterRotation, true);
});

test('full-clone autopilot retries a sole saturated focus after a fresh implementation repair', () => {
  const result = classifyAutopilot(snapshot({
    persistentStatus: {
      generatedAt: '2026-04-29T20:00:00.000Z',
      status: 'blocked',
      blocker: {
        blocker: 'Persistent parity runner stopped after 5 consecutive red iterations with unchanged nextFocus and no canonical product landing delta.',
        nextFocus: ['focus.signup_onboarding']
      }
    },
    implementationScriptMtimeMs: Date.parse('2026-04-29T21:00:00.000Z'),
    surfaceMatrix: {
      surfaces: [
        { id: 'signup_onboarding', status: 'partial', focusId: 'focus.signup_onboarding' },
        { id: 'dashboard_home', status: 'all_complete', focusId: 'focus.dashboard_home' }
      ]
    }
  }), { excludedFocusIds: ['focus.signup_onboarding'] });
  assert.equal(result.family, 'no_progress_repaired_focus');
  assert.equal(result.action, 'fix_then_relaunch');
  assert.equal(result.repairMode, 'unexclude_repaired_focus');
  assert.equal(result.freshImplementationRepair, true);
});

test('full-clone autopilot relaunches strict ceiling blockers when product progress landed', () => {
  const result = classifyAutopilot(snapshot({
    summary: {
      fidelity: 'full_clone',
      blockerKind: 'strict_1to1_ceiling',
      blocker: { blocker: 'Strict 1:1 parity ceiling is still red.' },
      productThroughput: { newlyLandedProductFileCount: 1, mergedPatchCount: 1 }
    }
  }));
  assert.equal(result.family, 'strict_ceiling_with_progress');
  assert.equal(result.action, 'relaunch');
  assert.equal(result.landingDelta, 1);
});

test('full-clone autopilot only finishes on explicit full-clone green truth', () => {
  const scoped = classifyAutopilot(snapshot({
    summary: {
      fidelity: 'parity_for_scope',
      supervisorConfirmedCompletion: true,
      supervisorStatus: 'green',
      parityStatus: 'full'
    }
  }));
  assert.notEqual(scoped.action, 'finish');

  const full = classifyAutopilot(snapshot({
    summary: {
      fidelity: 'full_clone',
      supervisorConfirmedCompletion: true,
      supervisorStatus: 'green',
      parityStatus: 'full'
    }
  }));
  assert.equal(full.action, 'finish');
});

test('full-clone autopilot autofix rotates saturated focus ids without crediting them complete', () => {
  const state = readAutopilotState('/tmp/nonexistent-autopilot-state.json');
  const fixed = applyAutofix({ action: 'fix_then_relaunch', family: 'no_progress_circuit', nextFocus: ['focus.signup_onboarding'] }, state);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.changed, true);
  assert.deepEqual(fixed.state.excludedFocusIds, ['focus.signup_onboarding']);
  assert.deepEqual(fixed.state.completedFocusIds, []);
  assert.equal(fixed.fix.kind, 'rotate_saturated_focus');
});

test('full-clone autopilot autofix unexcludes repaired focus ids without crediting them complete', () => {
  const state = { ...readAutopilotState('/tmp/nonexistent-autopilot-state.json'), excludedFocusIds: ['focus.signup_onboarding'] };
  const fixed = applyAutofix({
    action: 'fix_then_relaunch',
    family: 'no_progress_repaired_focus',
    repairMode: 'unexclude_repaired_focus',
    nextFocus: ['focus.signup_onboarding']
  }, state);
  assert.equal(fixed.ok, true);
  assert.deepEqual(fixed.state.excludedFocusIds, []);
  assert.deepEqual(fixed.state.completedFocusIds, []);
  assert.equal(fixed.fix.kind, 'unexclude_repaired_focus');
});

test('full-clone autopilot carries completed surface-matrix focus ids into repair relaunch env', () => {
  const classification = classifyAutopilot(snapshot({
    persistentStatus: {
      generatedAt: '2026-04-30T05:47:00.000Z',
      status: 'blocked',
      blocker: {
        blocker: 'Persistent parity runner stopped after 5 consecutive red iterations with unchanged nextFocus and no canonical product landing delta.',
        nextFocus: ['focus.contacts_table']
      }
    },
    implementationScriptMtimeMs: Date.parse('2026-04-30T06:00:00.000Z'),
    surfaceMatrix: {
      surfaces: [
        { id: 'signup_onboarding', status: 'all_complete', focusId: 'focus.signup_onboarding' },
        { id: 'dashboard_home', status: 'complete', focusId: 'focus.dashboard_home' },
        { id: 'contacts_table', status: 'partial', focusId: 'focus.contacts_table' }
      ]
    }
  }), { excludedFocusIds: ['focus.contacts_table'] });
  assert.equal(classification.action, 'fix_then_relaunch');
  assert.deepEqual(classification.completedFocusIds, ['focus.signup_onboarding', 'focus.dashboard_home']);
  const fixed = applyAutofix(classification, readAutopilotState('/tmp/nonexistent-autopilot-state.json'));
  assert.deepEqual(fixed.state.completedFocusIds, ['focus.signup_onboarding', 'focus.dashboard_home']);
  const plan = buildRelaunchPlan({ rootDir: ROOT, state: fixed.state, cycleIndex: 8, nowStamp: '20260430-060000' });
  assert.equal(plan.env.MAILCHIMP_COMPLETED_FOCUS_IDS, 'focus.signup_onboarding,focus.dashboard_home');
});

test('full-clone autopilot relaunch plan pins full-clone truth env and disables benchmark/synthetic helpers', () => {
  const plan = buildRelaunchPlan({
    rootDir: ROOT,
    state: { completedFocusIds: ['focus.done'], excludedFocusIds: ['focus.signup_onboarding'] },
    cycleIndex: 7,
    nowStamp: '20260429-190000'
  });
  assert.equal(plan.env.ORCHESTRATOR_REQUESTED_FIDELITY, 'full_clone');
  assert.equal(plan.env.MAILCHIMP_USE_BENCHMARK_SCOPE, '0');
  assert.equal(plan.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY, '1');
  assert.equal(plan.env.MAILCHIMP_STRICT_GAP_SEQUENCE, '0');
  assert.equal(plan.env.MAILCHIMP_REQUESTED_AGENT_COUNT, '100');
  assert.equal(plan.env.MAILCHIMP_CONTINUE_UNTIL_GLOBAL_PARITY, '1');
  assert.equal(plan.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION, '1');
  assert.equal(plan.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH, 'docs/MAILCHIMP_FINAL_BOSS_FULL_CLONE_BENCHMARK_CONTRACT_2026-05-08.json');
  assert.equal(plan.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION, '1');
  assert.equal(plan.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION, '1');
  assert.equal(plan.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION, '1');
  assert.equal(plan.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION, '1');
  assert.equal(plan.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR, '1');
  assert.equal(plan.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE, '1');
  assert.equal(plan.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES, '0');
  assert.equal(plan.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS, '26');
  assert.equal(plan.env.MAILCHIMP_ALLOW_SYNTHETIC_PARITY_DELTAS, '0');
  assert.equal(plan.env.MAILCHIMP_AUTOPILOT_CHILD, '1');
  assert.equal(plan.env.MAILCHIMP_EXCLUDED_FOCUS_IDS, 'focus.signup_onboarding');
  assert.equal(plan.env.MAILCHIMP_COMPLETED_FOCUS_IDS, 'focus.done');
  assert.match(plan.campaignRunId, /mailchimp-full-clone-autopilot-007/);
});

test('full-clone autopilot CLI dry-run persists watcher/fixer/relauncher cycle state', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-test-'));
  const statePath = path.join(tmp, 'state.json');
  const result = spawnSync(process.execPath, ['scripts/full-clone-autopilot.mjs', '--dry-run', '--once', '--state', statePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  assert.match(String(result.stdout), /"finalStatus"/);
  const output = JSON.parse(result.stdout);
  assert.equal(typeof output.ok, 'boolean');
  assert.equal(output.statePath.startsWith('../'), true, 'external temp state path should be reported relative to repo');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(Array.isArray(state.cycles));
  assert.ok(state.cycles.length >= 1);
});

test('normalizeFocusIds keeps only canonical focus ids', () => {
  assert.deepEqual(normalizeFocusIds(['focus.a', 'x', '', 'focus.a', ' focus.b ']), ['focus.a', 'focus.b']);
});

// Smoke writeJson export for callers that persist managed state outside the default artifact root.
test('full-clone autopilot writeJson creates parent directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-write-'));
  const filePath = path.join(tmp, 'nested', 'state.json');
  writeJson(filePath, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { ok: true });
});
