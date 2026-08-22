#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_TIER_THRESHOLDS } from '../../packages/system-benchmark/index.mjs';
import {
  GAME_100_AGENT_ADMISSION_GATES,
  GAME_100_AGENT_READINESS_LADDER,
  GAME_100_AGENT_REPAIR_LANE,
  GAME_100_AGENT_SCHEDULER_POLICY,
  GAME_100_AGENT_VERIFICATION_POLICY
} from './game-100-agent-surfaces.mjs';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const args = { launch: false, contractOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--launch') { args.launch = true; continue; }
    if (token === '--contract-only') { args.contractOnly = true; continue; }
    if (token === '--require-repo') { args.requireRepo = true; continue; }
    if (token === '--allow-missing-repo') { args.requireRepo = false; continue; }
    if (!args.contractPath && !token.startsWith('--')) args.contractPath = token;
  }
  return args;
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}

function check(checks, ok, id, message, details = {}, severity = 'blocking') {
  checks.push({ ok: Boolean(ok), id, message, severity, ...details });
}

function boolAtPath(root, dottedPath) {
  const parts = dottedPath.split('.');
  let cursor = root;
  for (const part of parts) cursor = cursor?.[part];
  return cursor === true || cursor?.required === true;
}

function relIsGodotProductPath(rel = '') {
  const value = String(rel || '').replace(/^\.\//, '');
  if (!value || path.isAbsolute(value) || value.includes('..')) return false;
  if (/(^|\/)(?:docs?|tests?|__tests__|artifacts?|benchmarks?|fixtures?|mocks?)\//i.test(value)) return false;
  if (value === 'project.godot') return true;
  return /^(?:scripts|scenes|ui|assets|autoload|addons|tools\/editor|tools\/qa)\//.test(value)
    && /\.(?:gd|tscn|tres|res|cfg|json|import|shader|material)$/i.test(value);
}

function surfacePrimaryProductFile(surface = {}) {
  return surface.ownership?.primaryProductFile
    || surface.metadata?.primaryProductFile
    || surface.productFile
    || surface.targetFile
    || stableList(surface.productFiles || surface.targetFiles || surface.allowedFiles || [])[0]
    || null;
}

function duplicateValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function collectLadderCounts(ladder = []) {
  return new Set((Array.isArray(ladder) ? ladder : []).map((entry) => Number(entry.agentCount)).filter((entry) => Number.isFinite(entry)));
}

function hasRepairTriggers(repairLane = {}) {
  const triggers = stableList(repairLane.triggers || []);
  return [
    /compile|import/i,
    /scene/i,
    /collision|merge/i,
    /test|harness/i,
    /integration|wire/i
  ].every((pattern) => triggers.some((trigger) => pattern.test(trigger)));
}

function evaluateContract(contract, { env = process.env, launch = false, contractOnly = false, requireRepo = null } = {}) {
  const checks = [];
  const scope = contract?.scope || {};
  const surfaces = Array.isArray(scope.surfaces) ? scope.surfaces : [];
  const repoPath = contract?.repoPath ? path.resolve(contract.repoPath) : null;
  const repoExists = Boolean(repoPath && fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory());
  const effectiveRequireRepo = requireRepo ?? !contractOnly;
  const primaryProductFiles = surfaces.map(surfacePrimaryProductFile).filter(Boolean);
  const duplicatePrimaryProductFiles = duplicateValues(primaryProductFiles);
  const surfaceIds = surfaces.map((surface) => surface.id).filter(Boolean);
  const duplicateSurfaceIds = duplicateValues(surfaceIds);
  const lanes = new Set(surfaces.map((surface) => surface.lane || surface.productLane).filter(Boolean));
  const domains = new Set(surfaces.map((surface) => surface.domain).filter(Boolean));
  const ladderCounts = collectLadderCounts(scope.proofLadder || []);
  const schedulerPolicy = scope.schedulerPolicy || {};
  const admissionGates = scope.admissionGates || {};
  const gameVerification = scope.gameVerification || {};
  const repairLane = scope.repairLane || {};
  const contextGovernor = scope.contextGovernor || {};
  const creativeProductWork = scope.creativeProductWork || {};
  const workerWorkspace = scope.workerWorkspace || {};
  const surfaceReliability = scope.surfaceReliability || scope.successTolerance || {};
  const threshold = BENCHMARK_TIER_THRESHOLDS[contract?.benchmarkTier] || null;

  check(checks, Boolean(contract), 'contract_readable', 'run contract is readable JSON');
  check(checks, contract?.benchmarkId === 'maplestory3d_100agent_readiness' || /100agent|100_agent|game/i.test(String(contract?.benchmarkId || '')), 'benchmark_id_declares_game_100agent_scope', 'benchmark id declares the game 100-agent readiness scope', { benchmarkId: contract?.benchmarkId || null });
  check(checks, contract?.benchmarkTier === 'tier3_game_vertical_slice_100agent', 'benchmark_tier_is_game_100agent', 'benchmark tier is the 100-agent game vertical-slice gate', { benchmarkTier: contract?.benchmarkTier || null });
  check(checks, Boolean(threshold), 'benchmark_tier_threshold_known', 'benchmark tier has declared threshold rules', { benchmarkTier: contract?.benchmarkTier || null });
  check(checks, Number(contract?.requestedAgentCount || 0) >= 100, 'requested_100_agents', 'contract requests at least 100 agents', { requestedAgentCount: contract?.requestedAgentCount || null });
  check(checks, contract?.executionBoundary === 'remote_execution_required', 'remote_execution_required', 'contract requires remote execution', { executionBoundary: contract?.executionBoundary || null });
  check(checks, !launch || env.BENCHMARK_HOST_ROLE === 'execution_plane' || env.HOST_ROLE === 'execution_plane', 'execution_plane_launch_marker', 'launch mode requires execution-plane host marker', { BENCHMARK_HOST_ROLE: env.BENCHMARK_HOST_ROLE || null, HOST_ROLE: env.HOST_ROLE || null });
  check(checks, contract?.stopCondition === 'supervisor_green_or_blocker_report' || scope.stopCondition === 'supervisor_green_or_blocker_report', 'supervisor_green_or_blocker_stop_condition', 'run may stop only on supervisor green or blocker report', { contractStopCondition: contract?.stopCondition || null, scopeStopCondition: scope.stopCondition || null });
  check(checks, !effectiveRequireRepo || repoExists, 'game_repo_exists_before_launch', 'game repo exists before launch/readiness claim', { repoPath, contractOnly, effectiveRequireRepo });
  check(checks, !effectiveRequireRepo || !repoExists || fs.existsSync(path.join(repoPath, 'project.godot')), 'godot_project_present_before_launch', 'Godot project.godot exists in the target repo', { projectPath: repoPath ? path.join(repoPath, 'project.godot') : null });

  check(checks, surfaces.length >= 100, 'surface_matrix_has_100_surfaces', 'surface matrix has at least 100 low-overlap surfaces', { surfaceCount: surfaces.length });
  check(checks, duplicateSurfaceIds.length === 0 && surfaceIds.length === surfaces.length, 'surface_ids_unique', 'every surface has a unique id', { duplicateSurfaceIds, missingIdCount: surfaces.length - surfaceIds.length });
  check(checks, primaryProductFiles.length === surfaces.length, 'surfaces_have_primary_product_files', 'every surface declares a primary product file', { primaryProductFileCount: primaryProductFiles.length, surfaceCount: surfaces.length });
  check(checks, duplicatePrimaryProductFiles.length === 0, 'primary_product_files_low_overlap', 'primary product files are unique across surfaces', { duplicatePrimaryProductFiles: duplicatePrimaryProductFiles.slice(0, 20), duplicateCount: duplicatePrimaryProductFiles.length });
  check(checks, primaryProductFiles.every(relIsGodotProductPath), 'primary_files_are_godot_product_paths', 'primary files are Godot product/runtime paths, not docs/tests/artifacts', { invalid: primaryProductFiles.filter((file) => !relIsGodotProductPath(file)).slice(0, 20) });
  check(checks, lanes.size >= 8, 'surface_matrix_lane_diversity', 'surface matrix covers at least 8 lanes', { laneCount: lanes.size, lanes: [...lanes].sort() });
  check(checks, domains.size >= 5, 'surface_matrix_domain_diversity', 'surface matrix covers at least 5 domains', { domainCount: domains.size, domains: [...domains].sort() });
  check(checks, surfaces.every((surface) => stableList(surface.verification || []).length > 0), 'surfaces_have_verifier_commands', 'every surface has verifier commands', { missingVerifierSurfaceIds: surfaces.filter((surface) => stableList(surface.verification || []).length === 0).map((surface) => surface.id).slice(0, 20) });
  check(checks, surfaces.every((surface) => surface.ownership?.exclusive === true), 'exclusive_file_ownership_declared', 'every surface declares exclusive file ownership', { missingOwnership: surfaces.filter((surface) => surface.ownership?.exclusive !== true).map((surface) => surface.id).slice(0, 20) });

  check(checks, surfaceReliability.enabled === true, 'surface_reliability_policy_enabled', '100-agent game scoring declares a surface reliability tolerance policy', { surfaceReliability });
  check(checks, Number(surfaceReliability.greenMinVerifiedProductiveRatio || 0) >= 0.95, 'surface_reliability_green_floor_95pct', 'green threshold allows small wiggle room but requires at least 95% verified productive surfaces', { greenMinVerifiedProductiveRatio: surfaceReliability.greenMinVerifiedProductiveRatio || null });
  check(checks, Number(surfaceReliability.yellowMinVerifiedProductiveRatio || 0) >= 0.90, 'surface_reliability_yellow_floor_90pct', 'yellow/near-green threshold requires at least 90% verified productive surfaces', { yellowMinVerifiedProductiveRatio: surfaceReliability.yellowMinVerifiedProductiveRatio || null });
  check(checks, Number(surfaceReliability.perfectVerifiedProductiveSurfaces || 0) >= 100, 'surface_reliability_perfect_100_surfaces', 'perfect-run badge remains 100/100 verified productive surfaces', { perfectVerifiedProductiveSurfaces: surfaceReliability.perfectVerifiedProductiveSurfaces || null });
  check(checks, surfaceReliability.requireClassifiedFailures === true, 'surface_reliability_classified_failures_required', 'residual failures must be classified before tolerance credit is allowed', { requireClassifiedFailures: surfaceReliability.requireClassifiedFailures ?? null });

  check(checks, scope.productDiffMode === 'creative_product_work' && creativeProductWork.required === true, 'creative_product_work_required', '100-agent readiness requires real creative product-work mode', { productDiffMode: scope.productDiffMode || null, creativeRequired: creativeProductWork.required === true });
  check(checks, contextGovernor.enabled === true && contextGovernor.hardGate === true, 'context_governor_hard_gate', 'context governor is enabled and hard-gated at 100-agent scale', { contextGovernor });
  check(checks, /isolated/.test(String(workerWorkspace.mode || scope.workerWorkspaceMode || '')), 'isolated_worker_workspace_mode', 'worker workspace mode is isolated to prevent cross-agent file collisions', { workerWorkspaceMode: workerWorkspace.mode || scope.workerWorkspaceMode || null });

  for (const dottedPath of ['leases', 'retries', 'staleWorkerRecovery', 'activeCodexCallThrottle', 'usageLimitBackoff', 'workStealing', 'noFakeDone']) {
    check(checks, boolAtPath(schedulerPolicy, dottedPath), `scheduler_${dottedPath}_required`, `scheduler policy requires ${dottedPath}`, { observed: schedulerPolicy[dottedPath] || null });
  }
  check(checks, schedulerPolicy.noFakeDone?.terminalCondition === 'supervisor_green_or_blocker_report', 'scheduler_no_fake_done_terminal_condition', 'scheduler no-fake-done policy uses supervisor green or blocker report', { terminalCondition: schedulerPolicy.noFakeDone?.terminalCondition || null });

  for (const [gate, expected] of Object.entries(GAME_100_AGENT_ADMISSION_GATES)) {
    check(checks, admissionGates[gate] === expected, `admission_gate_${gate}`, `admission gate ${gate} is enabled`, { observed: admissionGates[gate] ?? null });
  }

  check(checks, gameVerification.required === true, 'game_verification_required', 'game-specific verification policy is required', { gameVerificationRequired: gameVerification.required === true });
  for (const dottedPath of ['godotProjectImport', 'headlessSceneLoad', 'movementCombatHarness', 'assetManifest', 'surfaceStaticGate']) {
    check(checks, boolAtPath(gameVerification, dottedPath), `game_verification_${dottedPath}_required`, `game verification requires ${dottedPath}`, { observed: gameVerification[dottedPath] || null });
  }
  check(checks, gameVerification.screenshotCapture?.required === false && Boolean(gameVerification.screenshotCapture?.enabledByEnv), 'screenshot_capture_optional_hook_declared', 'screenshot/video capture is wired as an optional env-enabled hook', { screenshotCapture: gameVerification.screenshotCapture || null });

  check(checks, repairLane.enabled === true && repairLane.spawnAfterFeatureWave === true, 'automatic_repair_lane_enabled', 'automatic repair lane is enabled after feature waves', { repairLaneEnabled: repairLane.enabled === true, spawnAfterFeatureWave: repairLane.spawnAfterFeatureWave === true });
  check(checks, hasRepairTriggers(repairLane), 'repair_lane_covers_required_failures', 'repair lane covers compile/import, scene, collision, test, and integration-wire failures', { triggers: stableList(repairLane.triggers || []) });
  check(checks, repairLane.stopCondition === 'repair_green_or_blocker_report', 'repair_lane_stop_condition', 'repair lane stops only on green or blocker report', { stopCondition: repairLane.stopCondition || null });

  for (const expected of [10, 25, 50, 100]) {
    check(checks, ladderCounts.has(expected), `proof_ladder_${expected}_agents`, `proof ladder includes ${expected}-agent rung`, { ladderCounts: [...ladderCounts].sort((a, b) => a - b) });
  }
  const hundredRung = (scope.proofLadder || []).find((entry) => Number(entry.agentCount) === 100);
  check(checks, stableList(hundredRung?.requiredEvidence || []).some((entry) => /threshold/i.test(entry)), 'proof_ladder_100_has_threshold_gate', '100-agent rung requires threshold-gate evidence', { hundredRung: hundredRung || null });

  const blockingFailures = checks.filter((entry) => entry.severity !== 'non_blocking' && !entry.ok);
  return {
    schemaVersion: 'clawd.game_100agent_readiness_preflight.v1',
    generatedAt: new Date().toISOString(),
    ok: blockingFailures.length === 0,
    launchMode: launch,
    contractOnly,
    benchmarkId: contract?.benchmarkId || null,
    runId: contract?.runId || null,
    repoPath,
    requestedAgentCount: contract?.requestedAgentCount || null,
    surfaceCount: surfaces.length,
    laneCount: lanes.size,
    domainCount: domains.size,
    failedCheckCount: blockingFailures.length,
    blockingFailures,
    referencePolicies: {
      schedulerPolicy: GAME_100_AGENT_SCHEDULER_POLICY,
      admissionGates: GAME_100_AGENT_ADMISSION_GATES,
      gameVerification: GAME_100_AGENT_VERIFICATION_POLICY,
      repairLane: GAME_100_AGENT_REPAIR_LANE,
      proofLadder: GAME_100_AGENT_READINESS_LADDER
    },
    checks
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.contractPath) {
  console.error('usage: node verify-game-100agent-readiness.mjs <run_contract.json> [--launch] [--contract-only|--require-repo|--allow-missing-repo]');
  process.exit(2);
}

const contractPath = path.resolve(args.contractPath);
const contract = readJson(contractPath, null);
const result = evaluateContract(contract, {
  env: process.env,
  launch: args.launch,
  contractOnly: args.contractOnly,
  requireRepo: args.requireRepo
});
console.log(JSON.stringify({ ...result, contractPath }, null, 2));
process.exit(result.ok ? 0 : 1);
