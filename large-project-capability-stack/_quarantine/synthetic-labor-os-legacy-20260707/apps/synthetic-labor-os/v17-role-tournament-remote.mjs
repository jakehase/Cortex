#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import {
  SLOS_V17_ROLES,
  allowedFilesForRole,
  candidateIds,
  candidatePatchPath,
  candidateRoot,
  candidateSeed,
  candidateTarget,
  candidateTestPath,
  roleDependencies,
  roleVerifiers
} from './v17-role-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v17.role_agent_tournament_remote_summary';

function timestamp() { return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; }
function parseArgs(argv) {
  const args = {
    artifactRoot: null,
    candidateCount: Number(process.env.SLOS_V17_CANDIDATE_COUNT || 20),
    agentCount: Number(process.env.SLOS_V17_AGENT_COUNT || 100),
    maxRuntimeMs: Number(process.env.SLOS_V17_MAX_RUNTIME_MS || 35 * 60_000),
    workerTimeoutMs: Number(process.env.SLOS_V17_WORKER_TIMEOUT_MS || 6 * 60_000),
    maxSpawnsPerTick: Number(process.env.SLOS_V17_MAX_SPAWNS_PER_TICK || 20),
    maxAttemptsPerTask: Number(process.env.SLOS_V17_MAX_ATTEMPTS || 1),
    runStamp: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i], next = argv[i + 1];
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); i += 1; continue; }
    if (token === '--candidate-count') { args.candidateCount = Number(next); i += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); i += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); i += 1; continue; }
    if (token === '--worker-timeout-ms') { args.workerTimeoutMs = Number(next); i += 1; continue; }
    if (token === '--max-spawns-per-tick') { args.maxSpawnsPerTick = Number(next); i += 1; continue; }
    if (token === '--max-attempts-per-task') { args.maxAttemptsPerTask = Number(next); i += 1; continue; }
    if (token === '--run-stamp') { args.runStamp = String(next); i += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v17-role-tournament-remote.mjs [--artifact-root ROOT] [--candidate-count 20] [--agent-count 100]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  args.candidateCount = Math.max(1, Math.min(20, Number(args.candidateCount || 20)));
  args.agentCount = Math.max(1, Number(args.agentCount || args.candidateCount * SLOS_V17_ROLES.length));
  args.runStamp ||= timestamp().replace(/[^0-9A-Za-z]/g, '');
  args.artifactRoot ||= path.join(STACK_ROOT, 'artifacts', 'synthetic-labor-os-v17', `role-tournament-${args.runStamp}`);
  return args;
}
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); return value; }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function stableList(value) { return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort(); }
function parseVerifierStdout(result) { try { return result?.stdout ? JSON.parse(result.stdout) : null; } catch { return null; } }

function buildWorkGraph({ ids, workspacePath, runStamp }) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v17.role_tournament_work_graph',
    generatedAt: new Date().toISOString(),
    targetPath: workspacePath,
    workUnits: ids.flatMap((id) => SLOS_V17_ROLES.map((role) => ({
      id: `${id}__${role}`,
      title: `${id} real Codex ${role.replace(/_/g, ' ')}`,
      goal: `Real Codex ${role} contributes to ${id} SLOS role-agent tournament candidate.`,
      lane: role,
      domain: 'synthetic_labor_os_v17_role_tournament',
      deps: roleDependencies(id, role),
      fileAreas: allowedFilesForRole(id, role),
      allowedFiles: allowedFilesForRole(id, role),
      acceptanceChecks: role === 'scorer_refiner'
        ? ['role artifact exists', 'candidate patch applies', 'score verifier passes']
        : ['role artifact exists'],
      requiredVerifiers: roleVerifiers(role),
      metadata: {
        fixtureModuleId: `${id}::${role}`,
        candidateId: id,
        role,
        explorationSeed: candidateSeed(id),
        runStamp,
        candidateTarget: candidateTarget(id, runStamp),
        assignmentContract: {
          artifactKind: 'slos_role_agent_candidate',
          targetFiles: allowedFilesForRole(id, role),
          targetModules: [candidateRoot(id)],
          verifierRequirements: roleVerifiers(role),
          successPredicate: role === 'scorer_refiner'
            ? ['candidate patch applies and score verifier passes']
            : [`real Codex ${role} artifact exists and is in scope`]
        }
      }
    })))
  };
}

function buildSurfaceMatrix(ids, runStamp) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v17.role_tournament_surface_matrix',
    generatedAt: new Date().toISOString(),
    surfaces: ids.flatMap((id) => SLOS_V17_ROLES.map((role) => ({
      id: `${id}__${role}`,
      label: `${id} / ${role}`,
      status: 'pending',
      productFiles: allowedFilesForRole(id, role),
      requiredArtifacts: roleVerifiers(role).map((verifier) => ({ kind: 'verifier_command', command: verifier })),
      metadata: { candidateId: id, role, explorationSeed: candidateSeed(id), runStamp, candidateTarget: candidateTarget(id, runStamp) }
    })))
  };
}

function writeAgentWorkSpec(root, workspacePath, ids, runStamp) {
  const lines = [
    'goal SLOSV17RoleAgentTournament',
    'outcome Real Codex role-agents invent, patch, test, review, score, and select SLOS production-slice documentation candidates.',
    `repo ${workspacePath}`,
    'fidelity production_slice',
    `agents ${ids.length * SLOS_V17_ROLES.length}`,
    'forbid external_send, merge, publish, deploy',
    'done all_role_agents_observed, winner_selected, winner_patch_apply_ready, no_truth_layer_overclaim',
    '',
    'budget',
    `  global_calls: ${ids.length * SLOS_V17_ROLES.length}`,
    '  worker_prompt_tokens: 6000',
    '',
    ...ids.flatMap((id) => SLOS_V17_ROLES.flatMap((role) => [
      `surface ${id}__${role}`,
      `  label: ${id} / ${role}`,
      `  goal: Real Codex ${role} role for SLOS v17 candidate seed ${candidateSeed(id)}.`,
      `  lane: ${role}`,
      '  domain: synthetic_labor_os_v17_role_tournament',
      `  files: ${allowedFilesForRole(id, role).join(', ')}`,
      `  verify: ${roleVerifiers(role).join(', ')}`,
      `  candidateTarget: ${candidateTarget(id, runStamp)}`,
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
    const roleStatus = Object.fromEntries(SLOS_V17_ROLES.map((role) => [`${role}Merged`, merged.has(`${id}__${role}`)]));
    const scorer = results.find((entry) => entry.shardId === `${id}__scorer_refiner`) || null;
    const patchVerifier = scorer?.verifierResults?.find((entry) => entry.verifier === 'patch') || null;
    const scoreVerifier = scorer?.verifierResults?.find((entry) => entry.verifier === 'score') || null;
    const scoreParsed = parseVerifierStdout(scoreVerifier);
    const metrics = scoreVerifier?.metadata || scoreParsed?.metadata || {};
    const scorecard = readJson(path.join(root, 'workspace', candidateRoot(id), 'role-artifacts/scorecard.json'), {});
    const architecture = readJson(path.join(root, 'workspace', candidateRoot(id), 'architecture.json'), {});
    const finalScore = Number(metrics.finalScore ?? scorecard.score ?? 0);
    const allRolesMerged = SLOS_V17_ROLES.every((role) => merged.has(`${id}__${role}`));
    return {
      id,
      title: architecture.title || scorecard.title || `${id} SLOS v17 candidate`,
      pattern: architecture.pattern || candidateSeed(id),
      explorationSeed: candidateSeed(id),
      status: allRolesMerged ? 'all_roles_merged' : 'incomplete_roles',
      ...roleStatus,
      patchOk: patchVerifier?.ok === true,
      scoreOk: scoreVerifier?.ok === true,
      score: finalScore,
      declaredScore: Number(metrics.declaredScore ?? scorecard.score ?? 0),
      rubricScore: Number(metrics.rubricScore ?? 0),
      candidateTarget: metrics.candidateTarget || architecture.candidateTarget || scorecard.candidateTarget || null,
      patchPath: candidatePatchPath(id),
      productRoot: candidateRoot(id),
      testPath: candidateTestPath(id),
      scoreDetails: metrics,
      rationale: scorecard.rationale || scorecard.whyThisShouldWin || architecture.rationale || null,
      strengths: scorecard.strengths || null,
      weaknesses: scorecard.weaknesses || null
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const winner = rows.find((row) => row.status === 'all_roles_merged' && row.patchOk && row.scoreOk && row.score > 0) || rows[0] || null;
  const realCodexShardIds = new Set(results.filter((entry) => entry.implementation?.metadata?.realCodex === true).map((entry) => entry.shardId).filter(Boolean));
  const okShardIds = new Set(results.filter((entry) => entry.ok === true).map((entry) => entry.shardId).filter(Boolean));
  const failedShardIds = new Set(results.filter((entry) => entry.ok !== true).map((entry) => entry.shardId).filter(Boolean));
  return { rows, winner, resultCount: results.length, realCodexResultCount: realCodexShardIds.size, okResultShardCount: okShardIds.size, failedResultShardCount: failedShardIds.size };
}

function renderReviewPack({ summary, scores }) {
  const winner = scores.winner;
  const greenFinalists = scores.rows.filter((row) => row.status === 'all_roles_merged' && row.patchOk && row.scoreOk);
  const rejected = scores.rows.filter((row) => !(row.status === 'all_roles_merged' && row.patchOk && row.scoreOk));
  const lines = [
    '# Synthetic Labor OS v17 Role-Agent Tournament', '',
    '## What this proves', '',
    `- ${summary.shardCount} real Codex role-agent shards were orchestrated across ${summary.candidateCount} SLOS candidates.`,
    '- Roles: strategist, patch_author, test_writer, adversarial_reviewer, scorer_refiner.',
    '- Scorer/refiner for each candidate had to pass patch and score verifiers.',
    '- The winning candidate is review/apply-ready, not merged/published/deployed.', '',
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
    winner ? `- Candidate target: \`${winner.candidateTarget}\`` : '',
    winner ? `- Patch path: \`${winner.patchPath}\`` : '', '',
    '## Top green finalists', '',
    ...greenFinalists.slice(0, 5).map((row, index) => `${index + 1}. **${row.title}** (\`${row.id}\`) — score ${row.score}, target=${row.candidateTarget}`), '',
    '## Highest-scoring rejected candidates', '',
    ...rejected.slice(0, 5).map((row, index) => `${index + 1}. **${row.title}** (\`${row.id}\`) — score ${row.score}, status=${row.status}, patchOk=${row.patchOk}, scoreOk=${row.scoreOk}`), '',
    '## Truth boundary', '',
    'This is a real-Codex role-agent tournament for an internal SLOS production slice. It is not a merge, publish, deploy, external send, or unlimited autonomous labor claim.'
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(path.join(summary.artifactRoot, 'review_pack.md'), `${lines}\n`);
}

const args = parseArgs(process.argv.slice(2));
const ids = candidateIds(args.candidateCount);
const artifactRoot = path.resolve(args.artifactRoot);
const workspacePath = path.join(artifactRoot, 'workspace');
fs.mkdirSync(path.join(workspacePath, 'docs'), { recursive: true });
if (!fs.existsSync(path.join(workspacePath, '.git'))) spawnSync('git', ['init', '-q'], { cwd: workspacePath });
const workGraph = buildWorkGraph({ ids, workspacePath, runStamp: args.runStamp });
const surfaceMatrix = buildSurfaceMatrix(ids, args.runStamp);
writeJson(path.join(artifactRoot, 'work_graph.json'), workGraph);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), surfaceMatrix);
writeAgentWorkSpec(artifactRoot, workspacePath, ids, args.runStamp);
writeJson(path.join(artifactRoot, 'launch_config.json'), { generatedAt: new Date().toISOString(), ids, args, roles: SLOS_V17_ROLES, codexBin: process.env.CODEX_BIN || '/home/jake/.local/bin/codex', model: process.env.SLOS_V17_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5' });

const liveRun = await runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount: args.agentCount,
  workerScriptPath: path.join(STACK_ROOT, 'apps/orchestrator-qualification/live-worker.mjs'),
  verifierScriptPath: path.join(SCRIPT_DIR, 'v17-role-verifier.mjs'),
  implementationScriptPath: path.join(SCRIPT_DIR, 'v17-role-implementation.mjs'),
  workspacePath,
  runRoot: path.join(artifactRoot, 'orchestrator_run'),
  maxRuntimeMs: Math.max(60_000, Number(args.maxRuntimeMs || 35 * 60_000)),
  workerTimeoutMs: Math.max(30_000, Number(args.workerTimeoutMs || 6 * 60_000)),
  leaseTtlMs: 60_000,
  maxAttemptsPerTask: Math.max(1, Number(args.maxAttemptsPerTask || 1)),
  maxSpawnsPerTick: Math.max(1, Number(args.maxSpawnsPerTick || 20)),
  plannerOptions: { maxFileAreasPerShard: 100, maxFilesPerShard: 100, maxAcceptanceChecksPerShard: 10 },
  executionMode: 'slos_v17_real_codex_role_agent_tournament',
  campaignContract: { fidelity: 'production_slice', requestedScope: ids.flatMap((id) => SLOS_V17_ROLES.map((role) => `${id}__${role}`)), repoPath: workspacePath, targetPath: workspacePath },
  contextGovernorOptions: { enabled: true, hardGate: false, maxWorkerTokens: 6000, workerPromptMode: 'compact' }
});

const scores = collectScores({ root: artifactRoot, liveRun, ids });
const observedAgentIds = stableList(liveRun.metrics?.observedAgentIds || []);
const mergedShardCount = liveRun.patchQueue?.merged?.length || 0;
const shardCount = ids.length * SLOS_V17_ROLES.length;
const observedAgentCount = observedAgentIds.length || liveRun.metrics?.observedAgentCount || 0;
const mechanicalGreen = mergedShardCount === shardCount;
const executionCoverageGreen = scores.realCodexResultCount >= shardCount && observedAgentCount >= Math.min(args.agentCount, shardCount);
const tournamentGreen = executionCoverageGreen && Boolean(scores.winner) && scores.winner.patchOk === true && scores.winner.scoreOk === true;
const summary = {
  schemaVersion: SUMMARY_SCHEMA,
  generatedAt: new Date().toISOString(),
  artifactRoot,
  workspacePath,
  runStamp: args.runStamp,
  candidateCount: ids.length,
  agentCount: args.agentCount,
  shardCount,
  mergedShardCount,
  rejectedPatchCount: liveRun.patchQueue?.rejected?.length || 0,
  mechanicalGreen,
  tournamentGreen,
  executionCoverageGreen,
  thresholdPass: false,
  thresholdPassReason: 'role-agent tournament showcase has no benchmark threshold; report tournamentGreen, coverage, winner evidence, and rejected candidates separately',
  observedAgentCount,
  observedAgentIds,
  realCodexResultCount: scores.realCodexResultCount,
  okResultShardCount: scores.okResultShardCount,
  failedResultShardCount: scores.failedResultShardCount,
  workerSpawnCount: liveRun.metrics?.workerSpawnCount || null,
  peakConcurrentWorkers: liveRun.metrics?.peakConcurrentWorkers || null,
  metrics: liveRun.metrics || {},
  winner: scores.winner,
  candidateScoresPath: path.join(artifactRoot, 'candidate_scores.json'),
  reviewPackPath: path.join(artifactRoot, 'review_pack.md'),
  liveRunSummary: liveRun.summary || null,
  truthBoundary: tournamentGreen
    ? 'This proves a real-Codex SLOS role-agent tournament with observed worker fanout and a review-ready winner. It does not merge, publish, deploy, externally send, or claim unlimited autonomous labor capability.'
    : 'Tournament is not green; do not claim a successful role-agent showcase winner.'
};
writeJson(path.join(artifactRoot, 'candidate_scores.json'), { rows: scores.rows });
renderReviewPack({ summary, scores });
writeJson(path.join(artifactRoot, 'v17_role_tournament_remote_summary.json'), summary);
console.log(JSON.stringify(summary, null, 2));
if (!tournamentGreen) process.exitCode = 1;
