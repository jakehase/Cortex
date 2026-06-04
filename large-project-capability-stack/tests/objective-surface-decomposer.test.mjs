import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildNegativeSpaceInventory,
  buildObjectiveExpansionPlan,
  buildObjectiveSurfaceMatrix,
  buildObjectiveWorkGraph,
  buildSurfaceGraph,
  decomposeObjectiveToArchitectureEpics,
  decomposeObjectiveToSurfaces,
  surveyRepository
} from '../packages/objective-surface-decomposer/index.mjs';
import { buildShardPlan } from '../packages/multi-agent-orchestrator/index.mjs';

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'objective-surface-decomposer-'));
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'apps/web/public/app-shell.jsx'), 'export function AppShell() { return <main data-app-shell="true" />; }\n');
  write(path.join(repo, 'packages/app/routes/campaigns.mjs'), 'export function campaignsRoute(req = {}) { return Response.json({ ok: true, campaignId: req.id }); }\n');
  write(path.join(repo, 'packages/app/domain-campaigns.mjs'), 'export function saveCampaignDraft(input = {}) { return { ...input, status: "draft" }; }\n');
  write(path.join(repo, 'packages/app/storage-campaigns.mjs'), 'export function persistCampaign(record = {}) { return { ...record, persisted: true }; }\n');
  write(path.join(repo, 'packages/app/jobs-campaigns.mjs'), 'export function enqueueCampaignDelivery(job = {}) { return { ...job, queued: true }; }\n');
  write(path.join(repo, 'packages/app/integration-provider.mjs'), 'export function sendProviderWebhook(payload = {}) { return { accepted: true, payload }; }\n');
  write(path.join(repo, 'packages/app/security.mjs'), 'export function requirePermission(user = {}) { return user.role === "admin"; }\n');
  write(path.join(repo, 'tests/campaigns.test.mjs'), 'import test from "node:test"; test("campaigns", () => {});\n');
  write(path.join(repo, 'docs/spec.md'), '# Product spec\nCampaigns, delivery, integrations, and dashboard workflows.\n');
  return repo;
}

test('repository survey inventories runtime roles without hand-written Mailchimp backlog data', () => {
  const repo = makeRepo();
  const survey = surveyRepository({ repoPath: repo });
  assert.equal(survey.metrics.productFileCount >= 7, true);
  assert.equal(survey.metrics.roleCounts.ui >= 1, true);
  assert.equal(survey.metrics.roleCounts.route_api >= 1, true);
  assert.equal(survey.metrics.roleCounts.storage >= 1, true);
  assert.equal(survey.metrics.roleCounts.job_event >= 1, true);
  assert.equal(survey.metrics.roleCounts.integration >= 1, true);
  assert.equal(survey.metrics.roleCounts.security >= 1, true);
  assert.ok(survey.domains.some((domain) => domain.id.includes('campaign')));
});

test('objective decomposition builds surface matrix and work graph from repo/objective only', () => {
  const repo = makeRepo();
  const objective = {
    id: 'marketing_platform_slice',
    title: 'Build a marketing automation production slice with campaigns, persistence, jobs, integrations, auth, and UI',
    requestedFidelity: 'production_slice'
  };
  const decomposition = decomposeObjectiveToSurfaces({ repoPath: repo, objective, requestedAgentCount: 4 });

  assert.equal(decomposition.status, 'planned');
  assert.equal(decomposition.summary.readyForRequestedAgentCount, true);
  assert.equal(decomposition.surfaceMatrix.surfaces.length >= 4, true);
  assert.equal(decomposition.workGraph.workUnits.length, decomposition.surfaceMatrix.surfaces.length);
  assert.equal(decomposition.surfaceMatrix.surfaces.every((surface) => surface.allowedFiles.length > 0), true);
  assert.equal(decomposition.workGraph.workUnits.every((unit) => unit.metadata.assignmentContract.artifactKind === 'product_diff'), true);

  const shardPlan = buildShardPlan({
    workGraph: decomposition.workGraph,
    surfaceMatrix: decomposition.surfaceMatrix,
    options: { maxFileAreasPerShard: 2, maxFilesPerShard: 2, maxAcceptanceChecksPerShard: 3 }
  });
  assert.equal(shardPlan.shards.length >= decomposition.surfaceMatrix.surfaces.length, true);
});

test('decomposer honestly blocks when requested agent tier exceeds low-overlap surface inventory', () => {
  const repo = makeRepo();
  const decomposition = decomposeObjectiveToSurfaces({
    repoPath: repo,
    objective: { title: 'Build a large Mailchimp-style marketing app', requestedFidelity: 'production_slice' },
    requestedAgentCount: 100
  });

  assert.equal(decomposition.status, 'blocked_insufficient_surface_inventory');
  assert.equal(decomposition.blocker.type, 'insufficient_parallel_surface_inventory');
  assert.equal(decomposition.summary.readyForRequestedAgentCount, false);
  assert.equal(decomposition.blocker.lowOverlapSurfaceCount < 100, true);
});

test('architecture-epic decomposer turns full-clone objective into epics and role work units', () => {
  const repo = makeRepo();
  write(path.join(repo, 'apps/web/server.mjs'), 'export function serveShell() { return { route: true }; }\n');
  write(path.join(repo, 'packages/app/view.mjs'), 'export function renderView() { return "<main></main>"; }\n');
  write(path.join(repo, 'packages/app/analytics-events.mjs'), 'export function recordAnalyticsEvent(event = {}) { return event; }\n');
  const decomposition = decomposeObjectiveToArchitectureEpics({
    repoPath: repo,
    objective: { id: 'mailchimp_full_clone', title: 'Build a full Mailchimp clone with rich client editor, visual builder, persistence, providers, analytics, and browser evidence', requestedFidelity: 'full_clone' },
    requestedAgentCount: 12,
    maxEpics: 5
  });

  assert.equal(decomposition.status, 'planned');
  assert.equal(decomposition.summary.singleEpicReady, true);
  assert.equal(decomposition.summary.multiEpicReady, true);
  assert.ok(decomposition.architectureEpicPlan.epics.some((epic) => epic.id === 'rich_client_editor_architecture'));
  assert.ok(decomposition.architectureEpicPlan.architectureRoles.includes('frontend_architect'));
  assert.ok(decomposition.architectureEpicPlan.architectureRoles.includes('persistence_database_agent'));
  assert.ok(decomposition.workGraph.workUnits.every((unit) => unit.metadata.architectureEpic === true));
  assert.ok(decomposition.workGraph.workUnits.every((unit) => unit.metadata.requiresStructuralProductDelta === true));
  assert.ok(decomposition.surfaceMatrix.surfaces.every((surface) => surface.lane === 'architecture_epic'));
});

test('architecture-epic decomposer can stage one concrete rich-client/editor proof', () => {
  const repo = makeRepo();
  write(path.join(repo, 'apps/web/server.mjs'), 'export function serveShell() { return { route: true }; }\n');
  write(path.join(repo, 'packages/app/view.mjs'), 'export function renderView() { return "<main></main>"; }\n');
  const decomposition = decomposeObjectiveToArchitectureEpics({
    repoPath: repo,
    objective: { title: 'Full Mailchimp clone rich client editor architecture', requestedFidelity: 'full_clone' },
    targetEpicIds: ['rich_client_editor_architecture'],
    stage: 'single_epic',
    requestedAgentCount: 4
  });

  assert.equal(decomposition.architectureEpicPlan.epics.length, 1);
  assert.equal(decomposition.architectureEpicPlan.epics[0].id, 'rich_client_editor_architecture');
  assert.equal(decomposition.summary.singleEpicReady, true);
  assert.ok(decomposition.workGraph.workUnits.some((unit) => unit.architectureRole === 'editor_runtime_builder'));
  assert.ok(decomposition.workGraph.workUnits.some((unit) => unit.metadata.browserBehaviorEvidenceRequired === true));
});

test('negative-space inventory names missing expected runtime roles for thin repos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'objective-surface-thin-'));
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'packages/app/domain-core.mjs'), 'export const core = true;\n');
  const survey = surveyRepository({ repoPath: repo });
  const negativeSpace = buildNegativeSpaceInventory({
    survey,
    objective: { title: 'Build a web app with persistence, jobs, integrations, security, and UI' },
    requestedAgentCount: 10
  });

  assert.ok(negativeSpace.missingRoles.includes('ui'));
  assert.ok(negativeSpace.missingRoles.includes('storage'));
  assert.ok(negativeSpace.gaps.some((gap) => gap.type === 'insufficient_low_overlap_surface_inventory'));
});

test('objective surface decomposition CLI writes canonical artifact set', () => {
  const repo = makeRepo();
  const out = path.join(path.dirname(repo), 'artifacts', 'objective-decomposition');
  const cli = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/build-objective-surface-decomposition.mjs'),
    repo,
    '--objective', 'Build a marketing automation production slice with campaigns and integrations',
    '--requested-agent-count', '4',
    '--out', out
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(cli.status, 0, cli.stdout || cli.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'decomposition_summary.json'), 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(path.join(out, 'surface_matrix.json'), 'utf8'));
  const workGraph = JSON.parse(fs.readFileSync(path.join(out, 'work_graph.json'), 'utf8'));
  assert.equal(summary.status, 'planned');
  assert.equal(matrix.surfaces.length, workGraph.workUnits.length);
  assert.equal(fs.existsSync(path.join(out, 'surface_inventory.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'negative_space_inventory.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'report.md')), true);
});

test('objective decomposition CLI writes architecture-epic artifact set', () => {
  const repo = makeRepo();
  write(path.join(repo, 'apps/web/server.mjs'), 'export function serveShell() { return { route: true }; }\n');
  write(path.join(repo, 'packages/app/view.mjs'), 'export function renderView() { return "<main></main>"; }\n');
  const out = path.join(path.dirname(repo), 'artifacts', 'architecture-epic-decomposition');
  const cli = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/build-objective-surface-decomposition.mjs'),
    repo,
    '--objective', 'Build a full Mailchimp clone rich client editor architecture',
    '--fidelity', 'full_clone',
    '--architecture-epics',
    '--stage', 'single_epic',
    '--target-epics', 'rich_client_editor_architecture',
    '--requested-agent-count', '4',
    '--out', out
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(cli.status, 0, cli.stdout || cli.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'decomposition_summary.json'), 'utf8'));
  const epicPlan = JSON.parse(fs.readFileSync(path.join(out, 'architecture_epic_plan.json'), 'utf8'));
  assert.equal(summary.status, 'planned');
  assert.equal(epicPlan.epics[0].id, 'rich_client_editor_architecture');
  assert.equal(epicPlan.workGraph.summary.stagedProofs.singleEpicReady, true);
  assert.equal(fs.existsSync(path.join(out, 'surface_matrix.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'work_graph.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'report.md')), true);
});

test('objective expansion plan opens new architecture work after scoped queue exhaustion', () => {
  const repo = makeRepo();
  write(path.join(repo, 'apps/web/server.mjs'), 'export function serveShell() { return { route: true }; }\n');
  write(path.join(repo, 'packages/app/view.mjs'), 'export function renderView() { return "<main></main>"; }\n');
  const plan = buildObjectiveExpansionPlan({
    repoPath: repo,
    objective: {
      id: 'mailchimp_full_clone',
      title: 'Build a full Mailchimp clone with rich client editor, persistence, providers, analytics, and browser evidence',
      requestedFidelity: 'full_clone'
    },
    requestedAgentCount: 12,
    architectureEpics: true,
    stage: 'dynamic_final_boss_expansion',
    currentSurfaceMatrix: { status: 'all_complete', surfaces: [{ id: 'scoped_slice', status: 'complete' }] },
    currentWorkCount: 0,
    scopeAlreadySatisfied: true,
    supervisorState: { status: 'red', matrixStatus: 'all_complete', parityStatus: 'blocked', blockerKind: 'strict_1to1_ceiling', requestedFidelity: 'full_clone' }
  });

  assert.equal(plan.shouldExpand, true);
  assert.equal(plan.reason, 'strict_ceiling_red_objective_expansion_available');
  assert.equal(plan.mode, 'architecture_epic_negative_space');
  assert.ok(plan.expansionSurfaceCount >= 1);
  assert.ok(plan.expansionWorkUnitCount >= 1);
  assert.ok(plan.remainingObjectiveIds.includes('rich_client_editor_architecture'));
  assert.match(plan.truthBoundary, /not a completion/);
});

test('objective expansion CLI writes expansion artifacts', () => {
  const repo = makeRepo();
  write(path.join(repo, 'apps/web/server.mjs'), 'export function serveShell() { return { route: true }; }\n');
  write(path.join(repo, 'packages/app/view.mjs'), 'export function renderView() { return "<main></main>"; }\n');
  const out = path.join(path.dirname(repo), 'artifacts', 'objective-expansion');
  const cli = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/build-objective-surface-decomposition.mjs'),
    repo,
    '--objective', 'Build a full Mailchimp clone with dynamic objective expansion',
    '--fidelity', 'full_clone',
    '--architecture-epics',
    '--expansion',
    '--scope-already-satisfied',
    '--current-work-count', '0',
    '--supervisor-status', 'red',
    '--matrix-status', 'all_complete',
    '--parity-status', 'blocked',
    '--blocker-kind', 'strict_1to1_ceiling',
    '--requested-agent-count', '12',
    '--out', out
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(cli.status, 0, cli.stdout || cli.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'objective_expansion_plan.json'), 'utf8'));
  assert.equal(plan.shouldExpand, true);
  assert.equal(fs.existsSync(path.join(out, 'surface_matrix.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'work_graph.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'report.md')), true);
});

test('surface graph helpers remain composable for benchmark bootstrapping', () => {
  const repo = makeRepo();
  const survey = surveyRepository({ repoPath: repo });
  const graph = buildSurfaceGraph({ survey, objective: { title: 'Campaigns app' }, requestedAgentCount: 2 });
  const matrix = buildObjectiveSurfaceMatrix({ surfaceGraph: graph, objective: { id: 'campaigns_app' } });
  const workGraph = buildObjectiveWorkGraph({ surfaceGraph: graph, objective: { id: 'campaigns_app', title: 'Campaigns app' }, repoPath: repo });

  assert.equal(matrix.surfaces.length, graph.surfaces.length);
  assert.equal(workGraph.workUnits.length, graph.surfaces.length);
  assert.equal(workGraph.workUnits.every((unit) => Array.isArray(unit.acceptanceChecks) && unit.acceptanceChecks.length >= 3), true);
});
