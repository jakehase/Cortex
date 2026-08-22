#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import {
  REAL_CODEX_ROLES,
  allowedFilesForRole,
  candidateIds,
  candidateRoot,
  candidateSeed,
  candidateTestPath,
  roleDependencies,
  roleVerifiers
} from './webhook-real-codex-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));

function timestamp() { return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; }
function parseArgs(argv) {
  const args = {
    artifactRoot: null,
    variantCount: Number(process.env.REAL_CODEX_SHOWCASE_VARIANT_COUNT || 5),
    agentCount: Number(process.env.REAL_CODEX_SHOWCASE_AGENT_COUNT || 25),
    maxRuntimeMs: Number(process.env.REAL_CODEX_SHOWCASE_MAX_RUNTIME_MS || 25 * 60_000),
    workerTimeoutMs: Number(process.env.REAL_CODEX_SHOWCASE_WORKER_TIMEOUT_MS || 6 * 60_000),
    maxSpawnsPerTick: Number(process.env.REAL_CODEX_SHOWCASE_MAX_SPAWNS_PER_TICK || 10),
    maxAttemptsPerTask: Number(process.env.REAL_CODEX_SHOWCASE_MAX_ATTEMPTS || 2)
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i], next = argv[i + 1];
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); i += 1; continue; }
    if (token === '--variant-count') { args.variantCount = Number(next); i += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); i += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); i += 1; continue; }
    if (token === '--worker-timeout-ms') { args.workerTimeoutMs = Number(next); i += 1; continue; }
    if (token === '--max-spawns-per-tick') { args.maxSpawnsPerTick = Number(next); i += 1; continue; }
  }
  const count = Math.max(1, Math.min(20, Number(args.variantCount || 5)));
  args.variantCount = count;
  args.agentCount = Math.max(1, Number(args.agentCount || count * REAL_CODEX_ROLES.length));
  args.artifactRoot ||= path.join(STACK_ROOT, 'artifacts', 'showcases', `webhook-real-codex-${count}variant-${timestamp()}`);
  return args;
}
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); return value; }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function stableList(value) { return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort(); }
function parseVerifierStdout(result) { try { return result?.stdout ? JSON.parse(result.stdout) : null; } catch { return null; } }

function buildWorkGraph({ ids, workspacePath }) {
  return {
    schemaVersion: 'clawd.webhook_real_codex_showcase_work_graph.v1',
    generatedAt: new Date().toISOString(),
    targetPath: workspacePath,
    workUnits: ids.flatMap((id) => REAL_CODEX_ROLES.map((role) => ({
      id: `${id}__${role}`,
      title: `${id} real Codex ${role.replace(/_/g, ' ')}`,
      goal: `Real Codex ${role} invents/contributes to ${id} webhook inbox/replay architecture.`,
      lane: role,
      domain: 'webhook_real_codex_showcase',
      deps: roleDependencies(id, role),
      fileAreas: allowedFilesForRole(id, role),
      allowedFiles: allowedFilesForRole(id, role),
      acceptanceChecks: role === 'scorer_refiner'
        ? ['role artifact exists', 'dynamic golden behavior verifier passes', 'dynamic architecture verifier passes']
        : ['role artifact exists'],
      requiredVerifiers: roleVerifiers(role),
      metadata: {
        fixtureModuleId: `${id}::${role}`,
        candidateId: id,
        role,
        explorationSeed: candidateSeed(id),
        routeNamespaces: ['/webhooks/events', '/events', '/events/:id/replay'],
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: allowedFilesForRole(id, role),
          targetModules: [candidateRoot(id)],
          verifierRequirements: roleVerifiers(role),
          successPredicate: role === 'scorer_refiner'
            ? ['real Codex final behavior and architecture verifiers pass']
            : [`real Codex ${role} artifact exists and is in scope`]
        }
      }
    })))
  };
}
function buildSurfaceMatrix(ids) {
  return {
    schemaVersion: 'clawd.webhook_real_codex_showcase_surface_matrix.v1',
    generatedAt: new Date().toISOString(),
    surfaces: ids.flatMap((id) => REAL_CODEX_ROLES.map((role) => ({
      id: `${id}__${role}`,
      label: `${id} / ${role}`,
      status: 'pending',
      productFiles: allowedFilesForRole(id, role),
      requiredArtifacts: roleVerifiers(role).map((verifier) => ({ kind: 'verifier_command', command: verifier })),
      metadata: { candidateId: id, role, explorationSeed: candidateSeed(id) }
    })))
  };
}
function writeAgentWorkSpec(root, workspacePath, ids) {
  const lines = [
    'goal RealCodexWebhookArchitectureTournament',
    'outcome Real Codex role-agents invent, implement, test, review, refine, and score webhook inbox/replay architecture candidates.',
    `repo ${workspacePath}`,
    'fidelity production_slice',
    `agents ${ids.length * REAL_CODEX_ROLES.length}`,
    'forbid external_send, touch_prod',
    'done all_role_surfaces_pass, architecture_winner_selected, no_truth_layer_overclaim, real_codex_worker_evidence_present',
    '',
    'budget',
    `  global_calls: ${ids.length * REAL_CODEX_ROLES.length}`,
    '  worker_prompt_tokens: 6000',
    '',
    'evidence_schema real_codex_showcase_quality',
    `  require: merged_role_shard_count >= ${ids.length * REAL_CODEX_ROLES.length}`,
    `  require: observed_agent_count >= ${ids.length * REAL_CODEX_ROLES.length}`,
    '  require: architectureWinnerSelected == 1',
    '  artifact: architecture_scores.json',
    '',
    ...ids.flatMap((id) => REAL_CODEX_ROLES.flatMap((role) => [
      `surface ${id}__${role}`,
      `  label: ${id} / ${role}`,
      `  goal: Real Codex ${role} role for architecture seed ${candidateSeed(id)}.`,
      `  lane: ${role}`,
      '  domain: webhook_real_codex_showcase',
      `  files: ${allowedFilesForRole(id, role).join(', ')}`,
      `  verify: ${roleVerifiers(role).join(', ')}`,
      ''
    ]))
  ];
  fs.writeFileSync(path.join(root, 'agent_work_spec.aw'), `${lines.join('\n')}\n`);
}

function collectScores({ root, liveRun, ids }) {
  const resultDir = path.join(root, 'orchestrator_run', 'results');
  const results = fs.existsSync(resultDir) ? fs.readdirSync(resultDir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(resultDir, name), null)).filter(Boolean) : [];
  const merged = new Set((liveRun.patchQueue?.merged || []).map((patch) => patch.shardId));
  const rows = ids.map((id) => {
    const roleStatus = Object.fromEntries(REAL_CODEX_ROLES.map((role) => [`${role}Merged`, merged.has(`${id}__${role}`)]));
    const scorer = results.find((entry) => entry.shardId === `${id}__scorer_refiner`) || null;
    const behavior = scorer?.verifierResults?.find((entry) => entry.verifier === 'behavior') || null;
    const architecture = scorer?.verifierResults?.find((entry) => entry.verifier === 'architecture') || null;
    const architectureParsed = parseVerifierStdout(architecture);
    const metrics = architecture?.metadata || architectureParsed?.metadata || {};
    const architectureDoc = metrics.architecture || readJson(path.join(root, 'workspace', candidateRoot(id), 'architecture.json'), {});
    const score = Number(metrics.architectureScore ?? 0);
    const rawScore = Number(metrics.rawScore ?? score);
    const allRolesMerged = REAL_CODEX_ROLES.every((role) => merged.has(`${id}__${role}`));
    return {
      id,
      title: architectureDoc.title || architectureDoc.pattern || `${id} real Codex architecture`,
      pattern: architectureDoc.pattern || candidateSeed(id),
      layers: Array.isArray(architectureDoc.layers) ? architectureDoc.layers : [],
      explorationSeed: candidateSeed(id),
      status: allRolesMerged ? 'all_roles_merged' : 'incomplete_roles',
      ...roleStatus,
      testsOk: behavior?.ok === true,
      architectureOk: architecture?.ok === true,
      score,
      rawScore,
      scoreBreakdown: metrics.scoreBreakdown || null,
      scoreRubric: metrics.scoringNote || null,
      lineCount: metrics.lineCount || null,
      fileCount: metrics.fileCount || null,
      productRoot: candidateRoot(id),
      testPath: candidateTestPath(id),
      rationale: architectureDoc.rationale || null,
      tradeoffs: architectureDoc.tradeoffs || null
    };
  }).sort((a, b) => b.score - a.score || b.rawScore - a.rawScore || a.id.localeCompare(b.id));
  const winner = rows.find((row) => row.status === 'all_roles_merged' && row.testsOk && row.architectureOk) || rows[0] || null;
  const realCodexShardIds = new Set(results.filter((entry) => entry.implementation?.metadata?.realCodex === true).map((entry) => entry.shardId).filter(Boolean));
  const okShardIds = new Set(results.filter((entry) => entry.ok === true).map((entry) => entry.shardId).filter(Boolean));
  const failedShardIds = new Set(results.filter((entry) => entry.ok !== true).map((entry) => entry.shardId).filter(Boolean));
  return { rows, winner, resultCount: results.length, realCodexResultCount: realCodexShardIds.size, okResultShardCount: okShardIds.size, failedResultShardCount: failedShardIds.size };
}
function renderReviewPack({ root, summary, scores }) {
  const winner = scores.winner;
  const greenFinalists = scores.rows.filter((row) => row.status === 'all_roles_merged' && row.testsOk && row.architectureOk);
  const rejectedCandidates = scores.rows.filter((row) => !(row.status === 'all_roles_merged' && row.testsOk && row.architectureOk));
  const lines = [
    '# Real Codex Webhook Architecture Tournament', '',
    '## What this proves', '',
    `- ${summary.shardCount} real Codex role-agent shards were orchestrated across ${summary.variantCount} architecture candidates.`,
    '- Codex roles: architect, implementer, test writer, adversarial reviewer, scorer/refiner.',
    '- The final scorer/refiner shard for each candidate had to pass dynamic behavior and architecture verifiers.',
    '- The winner is packaged as a small senior-developer-readable bundle.', '',
    '## Run truth', '',
    `- Tournament green: ${summary.tournamentGreen}`,
    `- Mechanical all-merged green: ${summary.mechanicalGreen}`,
    `- Real Codex result coverage: ${summary.realCodexResultCount}/${summary.shardCount}`,
    `- Role shards merged: ${summary.mergedShardCount}/${summary.shardCount}`,
    `- Requested agents: ${summary.agentCount}`,
    `- Observed unique agent IDs: ${summary.observedAgentCount}`,
    `- Peak concurrent workers: ${summary.metrics?.peakConcurrentWorkers ?? 'n/a'}`,
    `- Worker spawn count: ${summary.metrics?.workerSpawnCount ?? 'n/a'}`, '',
    '## Winner', '',
    winner ? `**${winner.title}** (\`${winner.id}\`) — score ${winner.score}` : 'No winner selected.',
    winner ? `- Pattern: ${winner.pattern}` : '',
    winner ? `- Product root: \`${winner.productRoot}\`` : '',
    winner?.rationale ? `- Rationale: ${typeof winner.rationale === 'string' ? winner.rationale : JSON.stringify(winner.rationale)}` : '',
    winner ? `- Score breakdown: \`${JSON.stringify(winner.scoreBreakdown)}\`` : '', '',
    '## Top green finalists', '',
    ...greenFinalists.slice(0, 5).map((row, index) => `${index + 1}. **${row.title}** (\`${row.id}\`) — score ${row.score}, raw ${row.rawScore}, files=${row.fileCount}, lines=${row.lineCount}`), '',
    '## Highest-scoring rejected candidates', '',
    ...rejectedCandidates.slice(0, 5).map((row, index) => `${index + 1}. **${row.title}** (\`${row.id}\`) — score ${row.score}, raw ${row.rawScore}, status=${row.status}, testsOk=${row.testsOk}, architectureOk=${row.architectureOk}`), '',
    '## Review instructions', '',
    winner ? `Start with \`${path.join(root, 'workspace', winner.productRoot)}\` and \`${path.join(root, 'workspace', winner.testPath)}\`.` : '',
    'Then inspect `agent_work_spec.aw`, `work_graph.json`, `surface_matrix.json`, `orchestrator_run/worker_events.json`, `orchestrator_run/patch_queue.json`, `architecture_scores.json`, and the winner role prompts/logs under `orchestrator_run/results` / `logs`.', '',
    '## Truth boundary', '',
    'This is a real-Codex showcase only if the implementation metadata and logs show Codex CLI execution for each merged role shard. It remains a small production-slice demo, not a production deployment.'
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(path.join(root, 'review_pack.md'), `${lines}\n`);
}

const args = parseArgs(process.argv.slice(2));
const ids = candidateIds(args.variantCount);
const artifactRoot = path.resolve(args.artifactRoot);
const workspacePath = path.join(artifactRoot, 'workspace');
fs.mkdirSync(workspacePath, { recursive: true });
const workGraph = buildWorkGraph({ ids, workspacePath });
const surfaceMatrix = buildSurfaceMatrix(ids);
writeJson(path.join(artifactRoot, 'work_graph.json'), workGraph);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), surfaceMatrix);
writeAgentWorkSpec(artifactRoot, workspacePath, ids);
writeJson(path.join(artifactRoot, 'launch_config.json'), { generatedAt: new Date().toISOString(), ids, args, codexBin: process.env.CODEX_BIN || '/home/jake/.local/bin/codex', model: process.env.SHOWCASE_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5' });

const liveRun = await runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount: args.agentCount,
  workerScriptPath: path.join(STACK_ROOT, 'apps/orchestrator-qualification/live-worker.mjs'),
  verifierScriptPath: path.join(SCRIPT_DIR, 'webhook-real-codex-verifier.mjs'),
  implementationScriptPath: path.join(SCRIPT_DIR, 'webhook-real-codex-implementation.mjs'),
  workspacePath,
  runRoot: path.join(artifactRoot, 'orchestrator_run'),
  maxRuntimeMs: Math.max(60_000, Number(args.maxRuntimeMs || 25 * 60_000)),
  workerTimeoutMs: Math.max(30_000, Number(args.workerTimeoutMs || 4 * 60_000)),
  leaseTtlMs: 60_000,
  maxAttemptsPerTask: Math.max(1, Number(args.maxAttemptsPerTask || 2)),
  maxSpawnsPerTick: Math.max(1, Number(args.maxSpawnsPerTick || 10)),
  plannerOptions: { maxFileAreasPerShard: 100, maxFilesPerShard: 100, maxAcceptanceChecksPerShard: 10 },
  executionMode: 'webhook_real_codex_architecture_showcase_tournament',
  campaignContract: { fidelity: 'production_slice', requestedScope: ids.flatMap((id) => REAL_CODEX_ROLES.map((role) => `${id}__${role}`)), repoPath: workspacePath, targetPath: workspacePath },
  contextGovernorOptions: { enabled: true, hardGate: false, maxWorkerTokens: 6000, workerPromptMode: 'compact' }
});

const scores = collectScores({ root: artifactRoot, liveRun, ids });
const observedAgentIds = stableList(liveRun.metrics?.observedAgentIds || []);
const mergedShardCount = liveRun.patchQueue?.merged?.length || 0;
const realCodexMergedCount = (liveRun.patchQueue?.merged || []).filter((patch) => patch.metadata?.implementation?.metadata?.realCodex === true).length;
const shardCount = ids.length * REAL_CODEX_ROLES.length;
const observedAgentCount = observedAgentIds.length || liveRun.metrics?.observedAgentCount || 0;
const mechanicalGreen = mergedShardCount === shardCount;
const executionCoverageGreen = scores.realCodexResultCount >= shardCount && observedAgentCount >= Math.min(args.agentCount, shardCount);
const tournamentGreen = executionCoverageGreen && Boolean(scores.winner);
const summary = {
  schemaVersion: 'clawd.webhook_real_codex_showcase_summary.v1',
  generatedAt: new Date().toISOString(),
  artifactRoot,
  workspacePath,
  variantCount: ids.length,
  agentCount: args.agentCount,
  shardCount,
  mergedShardCount,
  rejectedPatchCount: liveRun.patchQueue?.rejected?.length || 0,
  mechanicalGreen,
  tournamentGreen,
  executionCoverageGreen,
  thresholdPass: false,
  thresholdPassReason: 'showcase_tournament_has_no_benchmark_threshold; report tournamentGreen, mechanicalGreen, winner evidence, and rejected candidates separately',
  observedAgentCount,
  observedAgentIds,
  realCodexMergedCount,
  realCodexResultCount: scores.realCodexResultCount,
  okResultShardCount: scores.okResultShardCount,
  failedResultShardCount: scores.failedResultShardCount,
  realCodexEvidenceGreen: executionCoverageGreen,
  architectureWinnerSelected: scores.winner ? 1 : 0,
  winner: scores.winner,
  metrics: liveRun.metrics,
  truthBoundary: 'Real Codex architecture tournament if tournamentGreen=true; mechanicalGreen remains separate and may be false when candidate designs are correctly rejected. This is a production-slice demo, not production deployment.'
};
writeJson(path.join(artifactRoot, 'architecture_scores.json'), scores);
writeJson(path.join(artifactRoot, 'completion_summary.json'), summary);
renderReviewPack({ root: artifactRoot, summary, scores });
console.log(JSON.stringify({ ok: summary.tournamentGreen, tournamentGreen: summary.tournamentGreen, mechanicalGreen: summary.mechanicalGreen, artifactRoot, winner: scores.winner, mergedShardCount, shardCount: summary.shardCount, observedAgentCount: summary.observedAgentCount, realCodexMergedCount, realCodexResultCount: summary.realCodexResultCount, peakConcurrentWorkers: summary.metrics?.peakConcurrentWorkers || 0 }, null, 2));
process.exit(summary.tournamentGreen ? 0 : 1);
