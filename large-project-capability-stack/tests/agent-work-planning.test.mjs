import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  admitRun,
  approvePlanReviewPacket,
  buildAgentWorkPlanningPacket,
  buildRepositoryInventoryAdapter,
  compileObjective,
  deriveContinuationPolicy
} from '../packages/canonical-agent-work/index.mjs';

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeRepo(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-work-phase4-${kind}-`));
  const repo = path.join(root, 'repo');
  if (kind === 'web') {
    write(path.join(repo, 'apps/web/public/app-shell.jsx'), 'export function AppShell() { return <main data-route="dashboard" />; }\n');
    write(path.join(repo, 'packages/app/routes/dashboard.mjs'), 'export function dashboardRoute() { return Response.json({ ok: true }); }\n');
    write(path.join(repo, 'tests/dashboard.test.mjs'), 'import test from "node:test"; test("dashboard", () => {});\n');
  } else if (kind === 'api') {
    write(path.join(repo, 'packages/app/domain-account.mjs'), 'export function accountState(input = {}) { return { ...input, active: true }; }\n');
    write(path.join(repo, 'packages/app/storage-account.mjs'), 'export function persistAccount(record = {}) { return { ...record, persisted: true }; }\n');
    write(path.join(repo, 'packages/app/security-policy.mjs'), 'export function canEdit(user = {}) { return user.role === "admin"; }\n');
    write(path.join(repo, 'tests/account.test.mjs'), 'import test from "node:test"; test("account", () => {});\n');
  } else if (kind === 'worker') {
    write(path.join(repo, 'packages/app/jobs-delivery.mjs'), 'export function enqueueDelivery(job = {}) { return { ...job, queued: true }; }\n');
    write(path.join(repo, 'packages/app/integration-provider.mjs'), 'export function sendProvider(payload = {}) { return { ok: true, payload }; }\n');
    write(path.join(repo, 'packages/app/domain-delivery.mjs'), 'export function deliveryState(input = {}) { return input; }\n');
    write(path.join(repo, 'tests/delivery.test.mjs'), 'import test from "node:test"; test("delivery", () => {});\n');
  } else if (kind === 'thin') {
    write(path.join(repo, 'packages/app/domain-core.mjs'), 'export const core = true;\n');
  }
  return repo;
}

function handoff(repo, overrides = {}) {
  return {
    schemaVersion: 'cortex.agent_work_handoff.v0',
    generatedAt: '2026-07-10T00:00:00.000Z',
    objective: 'Build a web app with routes, persistence, jobs, permissions, integrations, tests, and runtime roles',
    repoPath: repo,
    fidelity: 'production_slice',
    implementationSurface: 'mixed',
    requestedClaims: ['phase4_planning'],
    requestedAgentCount: 3,
    executionBoundary: 'control_plane_allowed',
    stopCondition: 'supervisor_green_or_blocker_report',
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
    budgets: { concurrency: 3, duration_minutes: 30, max_retries: 1 },
    doneWhen: ['phase4_plan_digest_reviewed', 'negative_space_work_graph_generated'],
    surfaces: [{ id: 'core', label: 'Core surface', goal: 'Plan core work', files: ['packages/app/domain-core.mjs'], verify: ['node --check packages/app/domain-core.mjs'] }],
    ...overrides
  };
}

test('Phase 4 automatic inventory adapters are deterministic across three dissimilar fixture repos', () => {
  for (const kind of ['web', 'api', 'worker']) {
    const repo = makeRepo(kind);
    const first = buildRepositoryInventoryAdapter({ repoPath: repo, objective: { objective: `Inventory ${kind}`, fidelity: 'production_slice', requestedAgentCount: 2 } });
    const second = buildRepositoryInventoryAdapter({ repoPath: repo, objective: { objective: `Inventory ${kind}`, fidelity: 'production_slice', requestedAgentCount: 2 } });
    assert.equal(first.ok, true, kind);
    assert.equal(first.inventory.schemaVersion, 'clawd.full_parity.inventory.v0');
    assert.equal(first.inventory.surfaceCount > 0, true, kind);
    assert.equal(first.inventory.digest, second.inventory.digest, kind);
    assert.equal(first.deterministicDigest, second.deterministicDigest, kind);
  }
});

test('Phase 4 planning names missing routes, persistence, permissions, integrations, tests, and runtime roles as explicit gaps', () => {
  const repo = makeRepo('thin');
  const packet = buildAgentWorkPlanningPacket({ input: handoff(repo) });
  const kinds = new Set(packet.planningNegativeSpace.rows.map((row) => row.kind));
  assert.equal(packet.status, 'planned');
  assert.equal(kinds.has('missing_routes'), true);
  assert.equal(kinds.has('missing_persistence'), true);
  assert.equal(kinds.has('missing_permissions'), true);
  assert.equal(kinds.has('missing_integrations'), true);
  assert.equal(kinds.has('missing_tests'), true);
  assert.equal(kinds.has('missing_runtime_role'), true);
  assert.equal(packet.workGraph.nodes.length >= packet.planningNegativeSpace.rows.length, true);
  assert.equal(packet.workGraph.nodes.every((node) => node.verifierBacked && node.requiredVerifiers.length > 0), true);
  assert.equal(packet.concurrency.feasibleConcurrency > 0, true);
});

test('Phase 4 continuation expands red exhausted queues, blocks empty expansions, and rejects duplicate expansion work', () => {
  const repo = makeRepo('thin');
  const packet = buildAgentWorkPlanningPacket({ input: handoff(repo) });
  const redExhausted = { status: 'red', matrixStatus: 'all_complete', parityStatus: 'blocked', currentWorkCount: 0 };
  const expansion = deriveContinuationPolicy({ supervisorState: redExhausted, planningWorkGraph: packet.workGraph });
  assert.equal(expansion.action, 'expand');
  assert.equal(expansion.executableExpansionNodeCount > 0, true);

  const duplicate = deriveContinuationPolicy({ supervisorState: redExhausted, planningWorkGraph: packet.workGraph, priorExpansionDigests: [expansion.expansionDigest] });
  assert.equal(duplicate.action, 'blocked');
  assert.equal(duplicate.blocker.code, 'duplicate_expansion_work_rejected');

  const empty = deriveContinuationPolicy({ supervisorState: redExhausted, planningWorkGraph: { nodes: [] } });
  assert.equal(empty.action, 'blocked');
  assert.equal(empty.blocker.code, 'objective_red_no_executable_expansion_work');
});

test('Phase 4 full-clone planning cannot compile without a declared reference source or parity evidence requirements', () => {
  const repo = makeRepo('web');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-full-clone-no-reference-'));
  const result = compileObjective({ input: handoff(repo, { objective: 'Build a full clone of the declared app', fidelity: 'full_clone' }), outputDir: out });
  assert.equal(result.ok, false);
  assert.equal(result.blockerCode, 'full_clone_reference_required');
  assert.equal(fs.existsSync(path.join(out, 'phase4_planning_packet.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'run.db')), false);

  const packet = buildAgentWorkPlanningPacket({
    input: handoff(repo, {
      objective: 'Build a full clone of the declared app',
      fidelity: 'full_clone',
      referenceInventory: { source: 'declared_reference_inventory', surfaces: [{ id: 'dashboard', files: ['src/dashboard.mjs'] }] }
    })
  });
  assert.equal(packet.compileAllowed, false);
  assert.equal(packet.blockers.some((blocker) => blocker.code === 'full_clone_parity_evidence_required'), true);
});

test('Phase 4 plan digest approval binds the admitted plan exactly', () => {
  const repo = makeRepo('api');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-plan-approval-'));
  const plan = compileObjective({ input: handoff(repo, { requestedAgentCount: 2 }), outputDir: out, config: { executionBoundary: 'control_plane_allowed' } });
  assert.equal(plan.ok, true, JSON.stringify(plan, null, 2));
  const reviewPath = path.join(out, 'plan_review_packet.json');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));

  const pending = admitRun({ runRoot: out, config: { requirePlanApproval: true } });
  assert.equal(pending.ok, false);
  assert.equal(pending.blockerCode, 'plan_digest_approval_required');

  fs.writeFileSync(reviewPath, JSON.stringify(approvePlanReviewPacket(review, { approvedBy: 'test', approvedPlanDigest: 'wrong-digest' }), null, 2));
  const wrong = admitRun({ runRoot: out, config: { requirePlanApproval: true } });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.blockerCode, 'plan_digest_approval_required');

  fs.writeFileSync(reviewPath, `${JSON.stringify(approvePlanReviewPacket(review, { approvedBy: 'test' }), null, 2)}\n`);
  const admitted = admitRun({ runRoot: out, config: { requirePlanApproval: true } });
  assert.equal(admitted.ok, true, JSON.stringify(admitted, null, 2));
  assert.equal(admitted.state, 'admitted');
});
