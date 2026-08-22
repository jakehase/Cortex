import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('mailchimp autopilot uses shared autonomy to replan after zero-diff iteration with next queue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-autonomy-replan-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'surface_a', strictGap: 'gap A' }, { id: 'surface_b', strictGap: 'gap B' }] }));
  process.exit(0);
}
const anchor = arg('--phase13-artifact-root');
const artifactRoot = arg('--artifact-root');
const queue = readJson(path.join(anchor, 'next_work_queue.json'), { work: [] });
const strictGap = queue.work[0].strictGap;
if (strictGap === 'gap A') {
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    thresholdPass: false,
    supervisorStatus: 'red',
    selectedStrictGap: 'gap A',
    selectedSurfaceId: 'surface_a',
    testsPassed: false,
    honestyGate: { ok: false, claimIntegrityKind: 'zero_modified_files' },
    blocker: { blockerKind: 'zero_modified_files', blocker: 'handler emitted no product delta' }
  });
  writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), { thresholdPass: false, ok: false });
  writeJson(path.join(artifactRoot, 'run_state_truth.json'), { terminalState: 'blocked_terminal', terminal: true, running: false });
  writeJson(path.join(artifactRoot, 'blocker_report.json'), { blockerKind: 'zero_modified_files', blocker: 'handler emitted no product delta' });
  writeJson(path.join(artifactRoot, 'patch_queue.json'), { merged: [], rejected: [{ id: 'patch-a', rejectionReason: 'zero_modified_files' }] });
  writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 1, work: [{ strictGap: 'gap B' }] });
  process.exit(0);
}
writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  thresholdPass: true,
  supervisorStatus: 'green',
  selectedStrictGap: 'gap B',
  selectedSurfaceId: 'surface_b',
  testsPassed: true,
  honestyGate: { ok: true, violationCount: 0 },
  nextStrictGap: null,
  globalFullClonePass: true,
  blocker: null
});
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), { thresholdPass: true, ok: true });
writeJson(path.join(artifactRoot, 'run_state_truth.json'), { terminalState: 'threshold_pass', terminal: true, running: false, ok: true });
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 0, work: [] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'gap A' }, null, 2));
  write(path.join(seedArtifactRoot, 'next_work_queue.json'), JSON.stringify({ count: 1, work: [{ strictGap: 'gap A' }] }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '2'
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = readJson(path.join(artifactRoot, 'completion_summary.json'));
  const events = readJson(path.join(artifactRoot, 'loop_events.json')).events;
  assert.equal(completion.thresholdPass, true);
  assert.deepEqual(completion.iterations.map((entry) => entry.selectedStrictGap), ['gap A', 'gap B']);
  assert.equal(completion.iterations[0].autonomyDecision.decision, 'continue_next_work_queue');
  assert.ok(events.some((entry) => entry.type === 'shared_autonomy_decision_after_non_green_iteration' && entry.decision === 'continue_next_work_queue'));
  assert.ok(events.some((entry) => entry.type === 'shared_autonomy_decision_for_non_green_anchor' && entry.decision === 'continue_next_work_queue'));
});

test('mailchimp autopilot maps phase9 leaf queue entries through supported global gap ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-leaf-queue-map-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
const strictGap = 'Mailchimp global gap Audience overview product-state parity: strict_1to1_gap_inventory id audience_overview remains open until real product-surface diff or explicit product-state proof is admitted';
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'mailchimp_global_gap_audience_overview_product_state_reconciliation', globalGapId: 'audience_overview', strictGap }] }));
  process.exit(0);
}
const anchor = arg('--phase13-artifact-root');
const artifactRoot = arg('--artifact-root');
const queue = readJson(path.join(anchor, 'next_work_queue.json'), { work: [] });
writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  thresholdPass: true,
  supervisorStatus: 'green',
  selectedStrictGap: strictGap,
  selectedSurfaceId: 'mailchimp_global_gap_audience_overview_product_state_reconciliation',
  sourceQueueLeafId: queue.work[0]?.id,
  testsPassed: true,
  honestyGate: { ok: true, violationCount: 0 },
  nextStrictGap: null,
  globalFullClonePass: true,
  blocker: null
});
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), { thresholdPass: true, ok: true });
writeJson(path.join(artifactRoot, 'run_state_truth.json'), { terminalState: 'threshold_pass', terminal: true, running: false, ok: true });
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 0, work: [] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: false, benchmarkTier: 'phase9_full_clone_preflight', nextWorkQueueCount: 1 }, null, 2));
  write(path.join(seedArtifactRoot, 'threshold_evaluation.json'), JSON.stringify({ thresholdPass: false, benchmarkTier: 'phase9_full_clone_preflight' }, null, 2));
  write(path.join(seedArtifactRoot, 'next_work_queue.json'), JSON.stringify({ count: 1, work: [{ id: 'audience_overview__req_01', parentSurfaceId: 'audience_overview', allowedFiles: ['packages/app/domain-audience.mjs'], targetedTests: ['tests/audience-core.test.mjs'] }] }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '1'
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = readJson(path.join(artifactRoot, 'completion_summary.json'));
  const events = readJson(path.join(artifactRoot, 'loop_events.json')).events;
  assert.equal(completion.iterations[0].selectedSurfaceId, 'mailchimp_global_gap_audience_overview_product_state_reconciliation');
  assert.match(completion.iterations[0].selectedStrictGap, /strict_1to1_gap_inventory id audience_overview/);
  assert.ok(events.some((entry) => entry.type === 'shared_autonomy_decision_for_non_green_anchor' && entry.mayStart === true));
});

test('mailchimp autopilot claim-blocks when strict inventory is exhausted without global full-clone proof', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-strict-inventory-claim-block-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  const strictGap = 'Mailchimp global gap Gap A product-state parity: strict_1to1_gap_inventory id gap_a remains open until real product-surface diff or explicit product-state proof is admitted';
  write(path.join(mailchimpRoot, 'docs', 'MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json'), JSON.stringify({
    gapCount: 1,
    gaps: [{ id: 'gap_a', label: 'Gap A', status: 'remaining_gap' }]
  }, null, 2));
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
const strictGap = ${JSON.stringify(strictGap)};
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'surface_a', globalGapId: 'gap_a', strictGap }] }));
  process.exit(0);
}
const artifactRoot = arg('--artifact-root');
const semanticWorkGate = { ok: true, productChangedFiles: ['packages/app/domain-audience.mjs'] };
writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  thresholdPass: true,
  supervisorStatus: 'green',
  selectedStrictGap: strictGap,
  selectedSurfaceId: 'surface_a',
  selectedGlobalGapId: 'gap_a',
  selectedGlobalGapLabel: 'Gap A',
  testsPassed: true,
  honestyGate: { ok: true, violationCount: 0 },
  semanticWorkGate,
  nextStrictGap: null,
  globalFullClonePass: false,
  blocker: null
});
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), { thresholdPass: true, ok: true });
writeJson(path.join(artifactRoot, 'run_state_truth.json'), { terminalState: 'threshold_pass', terminal: true, running: false, ok: true });
writeJson(path.join(artifactRoot, 'global_gap_credit.json'), {
  thresholdPass: true,
  globalGapId: 'gap_a',
  globalGapLabel: 'Gap A',
  selectedSurfaceId: 'surface_a',
  selectedStrictGap: strictGap,
  semanticWorkGate
});
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 0, work: [] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: strictGap }, null, 2));
  write(path.join(seedArtifactRoot, 'next_work_queue.json'), JSON.stringify({ count: 1, work: [{ strictGap }] }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '1'
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 1, run.stdout || run.stderr);
  const completion = readJson(path.join(artifactRoot, 'completion_summary.json'));
  const runState = readJson(path.join(artifactRoot, 'run_state_truth.json'));
  const blocker = readJson(path.join(artifactRoot, 'blocker_report.json'));
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.globalFullClonePass, false);
  assert.equal(completion.stopReason, 'claim_blocked_after_strict_inventory_reduction');
  assert.equal(completion.blocker.blockerKind, 'strict_inventory_reduction_complete_full_clone_unproven');
  assert.equal(blocker.claimBlocked, true);
  assert.equal(runState.terminalState, 'claim_blocked');
});
