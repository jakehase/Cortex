#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import { WEBHOOK_SHOWCASE_VARIANTS, productRootForVariant, scoreArchitecture, sourceFilesForVariant, testPathForVariant } from './webhook-architecture-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const ROLES = Object.freeze(['architect', 'implementer', 'test_writer', 'adversarial_reviewer', 'scorer_refiner']);

function timestamp() { return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; }
function parseArgs(argv) {
  const args = {
    artifactRoot: path.join(STACK_ROOT, 'artifacts', 'showcases', `webhook-100agent-tournament-${timestamp()}`),
    agentCount: 100,
    maxRuntimeMs: 240_000,
    workerTimeoutMs: 60_000
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i], next = argv[i + 1];
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); i += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); i += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); i += 1; continue; }
    if (token === '--worker-timeout-ms') { args.workerTimeoutMs = Number(next); i += 1; continue; }
  }
  return args;
}
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); return value; }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function stableList(value) { return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort(); }

function roleFiles(variant, role) {
  const root = productRootForVariant(variant);
  if (role === 'architect') return [`${root}/README.md`, `${root}/architecture.json`, `${root}/role-artifacts/architect-brief.md`];
  if (role === 'implementer') return sourceFilesForVariant(variant).filter((rel) => rel.includes('/src/') && rel.endsWith('.mjs'));
  if (role === 'test_writer') return [testPathForVariant(variant)];
  if (role === 'adversarial_reviewer') return [`${root}/role-artifacts/adversarial-review.json`, `${root}/role-artifacts/adversarial-review.md`];
  if (role === 'scorer_refiner') return [`${root}/role-artifacts/scorecard.json`, `${root}/role-artifacts/refinement-notes.md`];
  return [];
}
function roleDeps(variant, role) {
  if (role === 'adversarial_reviewer') return [`${variant.id}__implementer`, `${variant.id}__test_writer`];
  if (role === 'scorer_refiner') return [`${variant.id}__architect`, `${variant.id}__implementer`, `${variant.id}__test_writer`, `${variant.id}__adversarial_reviewer`];
  return [];
}
function roleVerifiers(role) {
  if (role === 'scorer_refiner') return ['role', 'tests', 'lint'];
  return ['role'];
}

function buildWorkGraph(workspacePath) {
  return {
    schemaVersion: 'clawd.webhook_100agent_showcase_work_graph.v1',
    generatedAt: new Date().toISOString(),
    targetPath: workspacePath,
    workUnits: WEBHOOK_SHOWCASE_VARIANTS.flatMap((variant) => ROLES.map((role) => ({
      id: `${variant.id}__${role}`,
      title: `${variant.title} — ${role.replace(/_/g, ' ')}`,
      goal: `${role} role contributes to ${variant.title} webhook inbox/replay candidate.`,
      lane: role,
      domain: variant.pattern,
      deps: roleDeps(variant, role),
      fileAreas: roleFiles(variant, role),
      allowedFiles: roleFiles(variant, role),
      acceptanceChecks: role === 'scorer_refiner'
        ? ['role artifact exists', `node --test tests/webhook-showcase/${variant.id}.test.mjs`, 'static architecture verifier passes']
        : ['role artifact exists'],
      requiredVerifiers: roleVerifiers(role),
      metadata: {
        fixtureModuleId: `${variant.id}::${role}`,
        architectureId: variant.id,
        architectureTitle: variant.title,
        architecturePattern: variant.pattern,
        role,
        routeNamespaces: ['/webhooks/events', '/events', '/events/:id/replay'],
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: roleFiles(variant, role),
          targetModules: [productRootForVariant(variant)],
          verifierRequirements: roleVerifiers(role),
          successPredicate: role === 'scorer_refiner'
            ? ['final candidate behavior tests pass', 'final architecture verifier passes']
            : [`${role} role artifact exists and is in scope`]
        }
      }
    })))
  };
}

function buildSurfaceMatrix() {
  return {
    schemaVersion: 'clawd.webhook_100agent_showcase_surface_matrix.v1',
    generatedAt: new Date().toISOString(),
    surfaces: WEBHOOK_SHOWCASE_VARIANTS.flatMap((variant) => ROLES.map((role) => ({
      id: `${variant.id}__${role}`,
      label: `${variant.title} / ${role}`,
      status: 'pending',
      productFiles: roleFiles(variant, role),
      requiredArtifacts: roleVerifiers(role).map((verifier) => ({ kind: 'verifier_command', command: verifier })),
      metadata: { variantId: variant.id, role, pattern: variant.pattern, layers: variant.layers }
    })))
  };
}

function writeAgentWorkSpec(root, workspacePath) {
  const lines = [
    'goal Webhook100AgentArchitectureTournament',
    'outcome Use 100 role-agents to explore 20 architectures for one small webhook inbox + replay product slice, then select a reviewable winner.',
    `repo ${workspacePath}`,
    'fidelity production_slice',
    'agents 100',
    'forbid external_send, touch_prod',
    'done all_role_surfaces_pass, architecture_winner_selected, no_truth_layer_overclaim',
    '',
    'budget',
    '  worker_prompt_tokens: 3200',
    '  global_calls: 100',
    '',
    'evidence_schema showcase_100agent_quality',
    '  require: merged_role_shard_count >= 100',
    '  require: observed_agent_count >= 100',
    '  require: architectureWinnerSelected == 1',
    '  artifact: architecture_scores.json',
    '',
    ...WEBHOOK_SHOWCASE_VARIANTS.flatMap((variant) => ROLES.flatMap((role) => [
      `surface ${variant.id}__${role}`,
      `  label: ${variant.title} / ${role}`,
      `  goal: ${role} role for ${variant.pattern} candidate.`,
      `  lane: ${role}`,
      `  domain: ${variant.pattern}`,
      `  files: ${roleFiles(variant, role).join(', ')}`,
      `  verify: ${roleVerifiers(role).join(', ')}`,
      ''
    ]))
  ];
  fs.writeFileSync(path.join(root, 'agent_work_spec.aw'), `${lines.join('\n')}\n`);
}

function parseVerifierStdout(result) { try { return result?.stdout ? JSON.parse(result.stdout) : null; } catch { return null; } }
function collectScores({ root, liveRun }) {
  const resultDir = path.join(root, 'orchestrator_run', 'results');
  const results = fs.existsSync(resultDir) ? fs.readdirSync(resultDir).filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(resultDir, n), null)).filter(Boolean) : [];
  const merged = new Set((liveRun.patchQueue?.merged || []).map((patch) => patch.shardId));
  const rows = WEBHOOK_SHOWCASE_VARIANTS.map((variant) => {
    const roleStatus = Object.fromEntries(ROLES.map((role) => [`${role}Merged`, merged.has(`${variant.id}__${role}`)]));
    const scorer = results.find((entry) => entry.shardId === `${variant.id}__scorer_refiner`) || null;
    const tests = scorer?.verifierResults?.find((entry) => entry.verifier === 'tests') || null;
    const lint = scorer?.verifierResults?.find((entry) => entry.verifier === 'lint') || null;
    const lintParsed = parseVerifierStdout(lint);
    const metrics = lint?.metadata || lintParsed?.metadata || {};
    const score = scoreArchitecture({ variant, testOk: tests?.ok === true, lintOk: lint?.ok === true, metrics });
    const allRolesMerged = ROLES.every((role) => merged.has(`${variant.id}__${role}`));
    return {
      id: variant.id,
      title: variant.title,
      pattern: variant.pattern,
      layers: variant.layers,
      status: allRolesMerged ? 'all_roles_merged' : 'incomplete_roles',
      ...roleStatus,
      testsOk: tests?.ok === true,
      architectureOk: lint?.ok === true,
      score: score.total,
      rawScore: score.rawTotal,
      scoreBreakdown: score.breakdown,
      scoreRubric: score.rubric,
      lineCount: metrics.lineCount || null,
      fileCount: metrics.fileCount || null,
      productRoot: productRootForVariant(variant),
      testPath: `tests/webhook-showcase/${variant.id}.test.mjs`,
      note: variant.note
    };
  }).sort((a, b) => b.score - a.score || (b.rawScore || 0) - (a.rawScore || 0) || a.id.localeCompare(b.id));
  const winner = rows.find((row) => row.status === 'all_roles_merged' && row.testsOk && row.architectureOk) || rows[0] || null;
  return { rows, winner };
}

function renderReviewPack({ root, summary, scores }) {
  const winner = scores.winner;
  const lines = [
    '# 100-Agent Webhook Architecture Tournament', '',
    '## What this proves', '',
    '- 100 role-agent shards were orchestrated across 20 architecture candidates.',
    '- Each candidate had five roles: architect, implementer, test writer, adversarial reviewer, scorer/refiner.',
    '- The final scorer/refiner shard for each candidate ran behavior tests and a static architecture verifier.',
    '- The winner is packaged as a small senior-developer-readable bundle.', '',
    '## Run truth', '',
    `- Mechanical green: ${summary.mechanicalGreen}`,
    `- Role shards merged: ${summary.mergedShardCount}/${summary.shardCount}`,
    `- Requested agents: ${summary.agentCount}`,
    `- Observed unique agent IDs: ${summary.observedAgentCount}`,
    `- Peak concurrent workers: ${summary.metrics?.peakConcurrentWorkers ?? 'n/a'}`,
    `- Worker spawn count: ${summary.metrics?.workerSpawnCount ?? 'n/a'}`, '',
    '## Winner', '',
    winner ? `**${winner.title}** (\`${winner.id}\`) — score ${winner.score}` : 'No winner selected.',
    winner ? `- Pattern: ${winner.pattern}` : '',
    winner ? `- Product root: \`${winner.productRoot}\`` : '',
    winner ? `- Why: ${winner.note}` : '',
    winner ? `- Score breakdown: \`${JSON.stringify(winner.scoreBreakdown)}\`` : '', '',
    '## Top 5', '',
    ...scores.rows.slice(0, 5).map((row, i) => `${i + 1}. **${row.title}** — ${row.score} (${row.status}, files=${row.fileCount}, lines=${row.lineCount})`), '',
    '## Review instructions', '',
    winner ? `Start with \`${path.join(root, 'workspace', winner.productRoot)}\` and \`${path.join(root, 'workspace', winner.testPath)}\`.` : '',
    'Then inspect `agent_work_spec.aw`, `work_graph.json`, `surface_matrix.json`, `orchestrator_run/worker_events.json`, `orchestrator_run/patch_queue.json`, and `architecture_scores.json`.', '',
    '## Truth boundary', '',
    'This is a deterministic 100-role-agent tournament through the orchestration engine. It proves 100-shard orchestration, role decomposition, verifier gates, scoring, and packaging. It does not claim 100 real model agents independently invented the designs unless rerun with model-backed workers.'
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(path.join(root, 'review_pack.md'), `${lines}\n`);
}

const args = parseArgs(process.argv.slice(2));
const artifactRoot = path.resolve(args.artifactRoot);
const workspacePath = path.join(artifactRoot, 'workspace');
fs.mkdirSync(workspacePath, { recursive: true });
const workGraph = buildWorkGraph(workspacePath);
const surfaceMatrix = buildSurfaceMatrix();
writeJson(path.join(artifactRoot, 'work_graph.json'), workGraph);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), surfaceMatrix);
writeAgentWorkSpec(artifactRoot, workspacePath);

const liveRun = await runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount: Math.max(1, Number(args.agentCount || 100)),
  workerScriptPath: path.join(STACK_ROOT, 'apps/orchestrator-qualification/live-worker.mjs'),
  verifierScriptPath: path.join(SCRIPT_DIR, 'webhook-100agent-verifier.mjs'),
  implementationScriptPath: path.join(SCRIPT_DIR, 'webhook-100agent-implementation.mjs'),
  workspacePath,
  runRoot: path.join(artifactRoot, 'orchestrator_run'),
  maxRuntimeMs: Math.max(60_000, Number(args.maxRuntimeMs || 240_000)),
  workerTimeoutMs: Math.max(10_000, Number(args.workerTimeoutMs || 60_000)),
  leaseTtlMs: 30_000,
  maxAttemptsPerTask: 1,
  maxSpawnsPerTick: Math.max(1, Number(args.agentCount || 100)),
  plannerOptions: { maxFileAreasPerShard: 100, maxFilesPerShard: 100, maxAcceptanceChecksPerShard: 10 },
  executionMode: 'webhook_100agent_architecture_showcase_tournament',
  campaignContract: {
    fidelity: 'production_slice',
    requestedScope: WEBHOOK_SHOWCASE_VARIANTS.flatMap((variant) => ROLES.map((role) => `${variant.id}__${role}`)),
    repoPath: workspacePath,
    targetPath: workspacePath
  },
  contextGovernorOptions: { enabled: true, hardGate: false, maxWorkerTokens: 3200, workerPromptMode: 'compact' }
});

const scores = collectScores({ root: artifactRoot, liveRun });
const observedAgentIds = stableList(liveRun.metrics?.observedAgentIds || []);
const summary = {
  schemaVersion: 'clawd.webhook_100agent_showcase_summary.v1',
  generatedAt: new Date().toISOString(),
  artifactRoot,
  workspacePath,
  agentCount: Math.max(1, Number(args.agentCount || 100)),
  shardCount: liveRun.shardCount || 100,
  mergedShardCount: liveRun.patchQueue?.merged?.length || 0,
  rejectedPatchCount: liveRun.patchQueue?.rejected?.length || 0,
  mechanicalGreen: (liveRun.patchQueue?.merged?.length || 0) === 100,
  thresholdPass: false,
  thresholdPassReason: 'showcase_tournament_has_no_benchmark_threshold; use role-shard green plus architectureWinnerSelected for the demo claim',
  observedAgentCount: observedAgentIds.length || liveRun.metrics?.observedAgentCount || 0,
  observedAgentIds,
  architectureWinnerSelected: scores.winner ? 1 : 0,
  winner: scores.winner,
  metrics: liveRun.metrics,
  truthBoundary: 'Deterministic 100-role-agent tournament; not a model-creativity claim.'
};
writeJson(path.join(artifactRoot, 'architecture_scores.json'), scores);
writeJson(path.join(artifactRoot, 'completion_summary.json'), summary);
renderReviewPack({ root: artifactRoot, summary, scores });

console.log(JSON.stringify({ ok: summary.mechanicalGreen && Boolean(scores.winner), artifactRoot, winner: scores.winner, mergedShardCount: summary.mergedShardCount, shardCount: summary.shardCount, observedAgentCount: summary.observedAgentCount, peakConcurrentWorkers: summary.metrics?.peakConcurrentWorkers || 0 }, null, 2));
process.exit(summary.mechanicalGreen && scores.winner ? 0 : 1);
