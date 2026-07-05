#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import {
  SLOS_V18_ALLOWED_PATCH_PATHS,
  SLOS_V18_ROLES,
  SLOS_V18_SOURCE_SNAPSHOT_FILES,
  allowedFilesForRole,
  candidateIds,
  candidatePatchPath,
  candidateRoot,
  candidateTestPlanPath,
  candidateTheme,
  roleDependencies,
  roleVerifiers
} from './v18-whole-os-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v18.whole_os_tournament_remote_summary';

function timestamp() { return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; }
function parseArgs(argv) {
  const args = {
    artifactRoot: null,
    candidateCount: Number(process.env.SLOS_V18_CANDIDATE_COUNT || 20),
    agentCount: Number(process.env.SLOS_V18_AGENT_COUNT || 100),
    maxRuntimeMs: Number(process.env.SLOS_V18_MAX_RUNTIME_MS || 60 * 60_000),
    workerTimeoutMs: Number(process.env.SLOS_V18_WORKER_TIMEOUT_MS || 12 * 60_000),
    maxSpawnsPerTick: Number(process.env.SLOS_V18_MAX_SPAWNS_PER_TICK || 20),
    maxAttemptsPerTask: Number(process.env.SLOS_V18_MAX_ATTEMPTS || 2),
    runStamp: null,
    validationCommands: []
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
    if (token === '--validation-command') { args.validationCommands.push(String(next)); i += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v18-whole-os-tournament-remote.mjs [--artifact-root ROOT] [--candidate-count 20] [--agent-count 100]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  args.candidateCount = Math.max(1, Math.min(20, Number(args.candidateCount || 20)));
  args.agentCount = Math.max(1, Number(args.agentCount || args.candidateCount * SLOS_V18_ROLES.length));
  args.runStamp ||= timestamp().replace(/[^0-9A-Za-z]/g, '');
  args.artifactRoot ||= path.join(STACK_ROOT, 'artifacts', 'synthetic-labor-os-v18', `whole-os-tournament-${args.runStamp}`);
  if (!args.validationCommands.length) args.validationCommands = ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  return args;
}
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); return value; }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function stableList(value) { return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort(); }
function parseVerifierStdout(result) { try { return result?.stdout ? JSON.parse(result.stdout) : null; } catch { return null; } }
function sha256File(filePath) { const crypto = require('node:crypto'); return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }

function copySourceSnapshot({ workspacePath, validationCommands }) {
  const snapshotRoot = path.join(workspacePath, 'source_snapshot');
  const files = [];
  const missing = [];
  for (const rel of SLOS_V18_SOURCE_SNAPSHOT_FILES) {
    const source = path.join(STACK_ROOT, rel);
    const target = path.join(snapshotRoot, rel);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) { missing.push(rel); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    files.push({ path: rel, sizeBytes: fs.statSync(target).size });
  }
  return writeJson(path.join(workspacePath, 'v18_source_manifest.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v18.source_manifest',
    generatedAt: new Date().toISOString(),
    sourceRepoPath: STACK_ROOT,
    sourceSnapshotRoot: snapshotRoot,
    allowedPatchPaths: SLOS_V18_ALLOWED_PATCH_PATHS,
    sourceSnapshotFiles: files,
    missing,
    validationCommands,
    truthBoundary: 'Role agents read source_snapshot context and write candidate artifacts/patches. The winning patch is applied later through the apply gate; non-winners are quarantined in artifacts.'
  });
}

function buildWorkGraph({ ids, workspacePath, runStamp }) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v18.whole_os_work_graph',
    generatedAt: new Date().toISOString(),
    targetPath: workspacePath,
    workUnits: ids.flatMap((id) => SLOS_V18_ROLES.map((role) => ({
      id: `${id}__${role}`,
      title: `${id} real Codex whole-SLOS ${role.replace(/_/g, ' ')}`,
      goal: `Real Codex ${role} contributes to ${id}, a whole-Synthetic-Labor-OS variant focused on ${candidateTheme(id)}.`,
      lane: role,
      domain: 'synthetic_labor_os_v18_whole_os_variant_tournament',
      deps: roleDependencies(id, role),
      fileAreas: allowedFilesForRole(id, role),
      allowedFiles: allowedFilesForRole(id, role),
      acceptanceChecks: role === 'release_scorer'
        ? ['role artifact exists', 'whole OS patch applies', 'isolated validation passes', 'score verifier passes']
        : ['role artifact exists', 'patch shape is not docs-only when patch exists'],
      requiredVerifiers: roleVerifiers(role),
      metadata: {
        fixtureModuleId: `${id}::${role}`,
        candidateId: id,
        role,
        variantTheme: candidateTheme(id),
        runStamp,
        sourceRepoPath: STACK_ROOT,
        allowedPatchPaths: SLOS_V18_ALLOWED_PATCH_PATHS,
        assignmentContract: {
          artifactKind: 'slos_whole_os_variant',
          targetFiles: allowedFilesForRole(id, role),
          targetModules: [candidateRoot(id)],
          verifierRequirements: roleVerifiers(role),
          successPredicate: role === 'release_scorer'
            ? ['candidate patch changes real SLOS runtime/tests and validation passes']
            : [`real Codex ${role} artifact exists and remains in scope`]
        }
      }
    })))
  };
}

function buildSurfaceMatrix(ids, runStamp) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v18.whole_os_surface_matrix',
    generatedAt: new Date().toISOString(),
    surfaces: ids.flatMap((id) => SLOS_V18_ROLES.map((role) => ({
      id: `${id}__${role}`,
      label: `${id} / ${role}`,
      status: 'pending',
      productFiles: allowedFilesForRole(id, role),
      requiredArtifacts: roleVerifiers(role).map((verifier) => ({ kind: 'verifier_command', command: verifier })),
      metadata: { candidateId: id, role, theme: candidateTheme(id), runStamp }
    })))
  };
}

function writeAgentWorkSpec(root, workspacePath, ids) {
  const lines = [
    'goal SLOSV18WholeSyntheticLaborOSVariantTournament',
    'outcome Real Codex role-agents create, test, review, score, and select whole-Synthetic-Labor-OS implementation variants.',
    `repo ${workspacePath}`,
    'fidelity production_slice',
    `agents ${ids.length * SLOS_V18_ROLES.length}`,
    'forbid external_send, merge, publish, deploy, dependency_install',
    'done all_role_agents_observed, whole_os_winner_selected, selected_patch_validated, non_winners_quarantined, no_truth_layer_overclaim',
    '',
    'budget',
    `  global_calls: ${ids.length * SLOS_V18_ROLES.length}`,
    '  worker_prompt_tokens: 7000',
    '',
    ...ids.flatMap((id) => SLOS_V18_ROLES.flatMap((role) => [
      `surface ${id}__${role}`,
      `  label: ${id} / ${role}`,
      `  goal: Real Codex ${role} role for whole-SLOS variant theme ${candidateTheme(id)}.`,
      `  lane: ${role}`,
      '  domain: synthetic_labor_os_v18_whole_os_variant_tournament',
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
    const roleStatus = Object.fromEntries(SLOS_V18_ROLES.map((role) => [`${role}Merged`, merged.has(`${id}__${role}`)]));
    const scorer = results.find((entry) => entry.shardId === `${id}__release_scorer`) || null;
    const scoreVerifier = scorer?.verifierResults?.find((entry) => entry.verifier === 'score') || null;
    const patchVerifier = scorer?.verifierResults?.find((entry) => entry.verifier === 'patch') || null;
    const validationVerifier = scorer?.verifierResults?.find((entry) => entry.verifier === 'validation') || null;
    const scoreParsed = parseVerifierStdout(scoreVerifier);
    const patchParsed = parseVerifierStdout(patchVerifier);
    const validationParsed = parseVerifierStdout(validationVerifier);
    const metrics = scoreParsed?.metadata || scoreParsed || {};
    const patchMetrics = patchParsed?.metadata || patchParsed || metrics.patch || {};
    const validationMetrics = validationParsed?.metadata || validationParsed || metrics.validation || {};
    const scorecard = readJson(path.join(root, 'workspace', candidateRoot(id), 'role-artifacts/scorecard.json'), {});
    const architecture = readJson(path.join(root, 'workspace', candidateRoot(id), 'architecture.json'), {});
    const finalScore = Number(metrics.finalScore ?? scorecard.score ?? 0);
    const allRolesMerged = SLOS_V18_ROLES.every((role) => merged.has(`${id}__${role}`));
    return {
      id,
      title: metrics.title || architecture.title || scorecard.title || `${id} whole-SLOS variant`,
      theme: metrics.theme || architecture.theme || candidateTheme(id),
      status: allRolesMerged ? 'all_roles_merged' : 'incomplete_roles',
      ...roleStatus,
      patchOk: patchVerifier?.ok === true || metrics.patch?.ok === true,
      validationOk: validationVerifier?.ok === true || metrics.validation?.ok === true,
      scoreOk: scoreVerifier?.ok === true,
      score: finalScore,
      declaredScore: Number(metrics.declaredScore ?? scorecard.score ?? 0),
      rubricScore: Number(metrics.rubricScore ?? 0),
      patchPath: candidatePatchPath(id),
      productRoot: candidateRoot(id),
      testPlanPath: candidateTestPlanPath(id),
      diffPaths: patchMetrics.diffPaths || metrics.patch?.diffPaths || [],
      runtimePaths: metrics.runtimePaths || patchMetrics.runtimePaths || [],
      testPaths: metrics.testPaths || patchMetrics.testPaths || [],
      validation: validationMetrics,
      scoreDetails: metrics,
      rationale: metrics.rationale || scorecard.rationale || scorecard.whyThisShouldWin || architecture.rationale || null,
      strengths: metrics.strengths || scorecard.strengths || null,
      weaknesses: metrics.weaknesses || scorecard.weaknesses || null
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const winner = rows.find((row) => row.status === 'all_roles_merged' && row.patchOk && row.validationOk && row.scoreOk && row.score > 0) || null;
  const realCodexShardIds = new Set(results.filter((entry) => entry.implementation?.metadata?.realCodex === true).map((entry) => entry.shardId).filter(Boolean));
  const okShardIds = new Set(results.filter((entry) => entry.ok === true).map((entry) => entry.shardId).filter(Boolean));
  const failedShardIds = new Set(results.filter((entry) => entry.ok !== true).map((entry) => entry.shardId).filter(Boolean));
  return { rows, winner, resultCount: results.length, realCodexResultCount: realCodexShardIds.size, okResultShardCount: okShardIds.size, failedResultShardCount: failedShardIds.size };
}

function renderReviewPack({ summary, scores }) {
  const winner = scores.winner;
  const greenFinalists = scores.rows.filter((row) => row.status === 'all_roles_merged' && row.patchOk && row.validationOk && row.scoreOk);
  const lines = [
    '# Synthetic Labor OS v18 Whole-OS Variant Tournament', '',
    '## What this proves', '',
    `- ${summary.shardCount} real Codex role-agent shards were orchestrated across ${summary.candidateCount} whole-SLOS variants.`,
    '- Candidates were required to produce real SLOS runtime/CLI/core patches plus tests.',
    '- Docs-only candidates were invalid.',
    '- The selected winner passed patch, isolated validation, and scoring verifiers.', '',
    '## Run truth', '',
    `- Whole-OS tournament green: ${summary.wholeOsTournamentGreen}`,
    `- Mechanical all-merged green: ${summary.mechanicalGreen}`,
    `- Real Codex result coverage: ${summary.realCodexResultCount}/${summary.shardCount}`,
    `- Role shards merged: ${summary.mergedShardCount}/${summary.shardCount}`,
    `- Requested agents: ${summary.agentCount}`,
    `- Observed unique agent IDs: ${summary.observedAgentCount}`,
    `- Peak concurrent workers: ${summary.metrics?.peakConcurrentWorkers ?? 'n/a'}`, '',
    '## Winner', '',
    winner ? `**${winner.title}** (\`${winner.id}\`) — score ${winner.score}` : 'No validated winner selected.',
    winner ? `- Theme: ${winner.theme}` : '',
    winner ? `- Patch path: \`${winner.patchPath}\`` : '',
    winner ? `- Runtime paths: ${winner.runtimePaths.join(', ')}` : '',
    winner ? `- Test paths: ${winner.testPaths.join(', ')}` : '', '',
    '## Top green finalists', '',
    ...greenFinalists.slice(0, 5).map((row, index) => `${index + 1}. **${row.title}** (\`${row.id}\`) — score ${row.score}, runtime=${row.runtimePaths.join(', ')}`), '',
    '## Truth boundary', '',
    'This is a real-Codex whole-SLOS variant tournament for an internal production slice. It is not a merge, publish, deploy, external send, or unlimited autonomous labor claim.'
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(path.join(summary.artifactRoot, 'review_pack.md'), `${lines}\n`);
}

const args = parseArgs(process.argv.slice(2));
const ids = candidateIds(args.candidateCount);
const artifactRoot = path.resolve(args.artifactRoot);
// `latest` is intentionally reused by the launcher, so clear the whole run root
// before each remote attempt. Otherwise old result JSON can pollute coverage,
// winner selection, and returned-artifact truth.
fs.rmSync(artifactRoot, { recursive: true, force: true });
fs.mkdirSync(artifactRoot, { recursive: true });
const workspacePath = path.join(artifactRoot, 'workspace');
fs.mkdirSync(workspacePath, { recursive: true });
copySourceSnapshot({ workspacePath, validationCommands: args.validationCommands });
const workGraph = buildWorkGraph({ ids, workspacePath, runStamp: args.runStamp });
const surfaceMatrix = buildSurfaceMatrix(ids, args.runStamp);
writeJson(path.join(artifactRoot, 'work_graph.json'), workGraph);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), surfaceMatrix);
writeAgentWorkSpec(artifactRoot, workspacePath, ids);
writeJson(path.join(artifactRoot, 'launch_config.json'), { generatedAt: new Date().toISOString(), ids, args, roles: SLOS_V18_ROLES, allowedPatchPaths: SLOS_V18_ALLOWED_PATCH_PATHS, codexBin: process.env.CODEX_BIN || '/home/jake/.local/bin/codex', model: process.env.SLOS_V18_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5' });

const liveRun = await runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount: args.agentCount,
  workerScriptPath: path.join(STACK_ROOT, 'apps/orchestrator-qualification/live-worker.mjs'),
  verifierScriptPath: path.join(SCRIPT_DIR, 'v18-whole-os-verifier.mjs'),
  implementationScriptPath: path.join(SCRIPT_DIR, 'v18-whole-os-implementation.mjs'),
  workspacePath,
  runRoot: path.join(artifactRoot, 'orchestrator_run'),
  maxRuntimeMs: Math.max(60_000, Number(args.maxRuntimeMs || 60 * 60_000)),
  workerTimeoutMs: Math.max(30_000, Number(args.workerTimeoutMs || 9 * 60_000)),
  leaseTtlMs: 90_000,
  maxAttemptsPerTask: Math.max(1, Number(args.maxAttemptsPerTask || 1)),
  maxSpawnsPerTick: Math.max(1, Number(args.maxSpawnsPerTick || 20)),
  plannerOptions: { maxFileAreasPerShard: 100, maxFilesPerShard: 100, maxAcceptanceChecksPerShard: 10 },
  executionMode: 'slos_v18_real_codex_whole_os_variant_tournament',
  campaignContract: { fidelity: 'production_slice', requestedScope: ids.flatMap((id) => SLOS_V18_ROLES.map((role) => `${id}__${role}`)), repoPath: STACK_ROOT, targetPath: STACK_ROOT },
  contextGovernorOptions: { enabled: true, hardGate: false, maxWorkerTokens: 7000, workerPromptMode: 'compact' }
});

const scores = collectScores({ root: artifactRoot, liveRun, ids });
const observedAgentIds = stableList(liveRun.metrics?.observedAgentIds || []);
const mergedShardCount = liveRun.patchQueue?.merged?.length || 0;
const shardCount = ids.length * SLOS_V18_ROLES.length;
const observedAgentCount = observedAgentIds.length || liveRun.metrics?.observedAgentCount || 0;
const mechanicalGreen = mergedShardCount === shardCount;
const executionCoverageGreen = scores.realCodexResultCount >= shardCount && observedAgentCount >= Math.min(args.agentCount, shardCount);
const wholeOsTournamentGreen = executionCoverageGreen && Boolean(scores.winner) && scores.winner.patchOk === true && scores.winner.validationOk === true && scores.winner.scoreOk === true;
const summary = {
  schemaVersion: SUMMARY_SCHEMA,
  generatedAt: new Date().toISOString(),
  artifactRoot,
  workspacePath,
  sourceRepoPath: STACK_ROOT,
  runStamp: args.runStamp,
  candidateCount: ids.length,
  agentCount: args.agentCount,
  shardCount,
  mergedShardCount,
  rejectedPatchCount: liveRun.patchQueue?.rejected?.length || 0,
  mechanicalGreen,
  wholeOsTournamentGreen,
  executionCoverageGreen,
  thresholdPass: false,
  thresholdPassReason: 'whole-SLOS variant tournament has no external benchmark threshold; report wholeOsTournamentGreen, execution coverage, winner validation, and mechanical green separately',
  observedAgentCount,
  observedAgentIds,
  realCodexResultCount: scores.realCodexResultCount,
  okResultShardCount: scores.okResultShardCount,
  failedResultShardCount: scores.failedResultShardCount,
  workerSpawnCount: liveRun.metrics?.workerSpawnCount || null,
  peakConcurrentWorkers: liveRun.metrics?.peakConcurrentWorkers || null,
  metrics: liveRun.metrics || {},
  winner: scores.winner,
  allowedPatchPaths: SLOS_V18_ALLOWED_PATCH_PATHS,
  candidateScoresPath: path.join(artifactRoot, 'candidate_scores.json'),
  reviewPackPath: path.join(artifactRoot, 'review_pack.md'),
  liveRunSummary: liveRun.summary || null,
  truthBoundary: wholeOsTournamentGreen
    ? 'This proves a real-Codex whole-SLOS variant tournament with observed worker fanout, validated whole-OS patch candidates, and one selected winner. It does not merge, publish, deploy, externally send, or claim unlimited autonomous labor capability.'
    : 'Whole-SLOS tournament is not green; do not claim a successful whole-OS winner.'
};
writeJson(path.join(artifactRoot, 'candidate_scores.json'), { rows: scores.rows });
renderReviewPack({ summary, scores });
writeJson(path.join(artifactRoot, 'v18_whole_os_tournament_remote_summary.json'), summary);
console.log(JSON.stringify(summary, null, 2));
if (!wholeOsTournamentGreen) process.exitCode = 1;
