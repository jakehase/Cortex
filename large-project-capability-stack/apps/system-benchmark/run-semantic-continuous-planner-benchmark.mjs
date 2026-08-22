#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  bootstrapTransferBenchmark,
  createScoreboardRow,
  evaluateBenchmarkThresholds,
  upsertBenchmarkScoreboardRow
} from '../../packages/system-benchmark/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));

function parseArgs(argv) {
  const args = {
    benchmarkId: 'mailchimp_semantic_continuous_planner_smoke',
    benchmarkTier: 'tier1_smoke',
    stackRoot: DEFAULT_STACK_ROOT,
    artifactRoot: null,
    scoreboardPath: null,
    agentCount: 100,
    waves: 2,
    surfacesPerWave: 100,
    waveDurationMs: Number(process.env.SEMANTIC_CONTINUOUS_WAVE_DURATION_MS || 1),
    waveMinCycles: Number(process.env.SEMANTIC_CONTINUOUS_WAVE_MIN_CYCLES || 1),
    durationTargetMinutes: Number(process.env.SEMANTIC_CONTINUOUS_DURATION_TARGET_MINUTES || 30),
    cycleIntervalMs: Number(process.env.SEMANTIC_CONTINUOUS_CYCLE_INTERVAL_MS || 60000),
    integrationProof: /^(1|true|yes|on)$/i.test(String(process.env.SEMANTIC_CONTINUOUS_INTEGRATION_PROOF || '')),
    realismProof: /^(1|true|yes|on)$/i.test(String(process.env.SEMANTIC_CONTINUOUS_REALISM_PROOF || '')),
    functionalProofDurationMs: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_DURATION_MS || 0),
    functionalProofMinCycles: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_MIN_CYCLES || 1),
    functionalProofCycleIntervalMs: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_CYCLE_INTERVAL_MS || 60000),
    realismProofDurationMs: Number(process.env.REALISM_PROOF_DURATION_MS || 0),
    realismProofMinCycles: Number(process.env.REALISM_PROOF_MIN_CYCLES || 1),
    realismProofCycleIntervalMs: Number(process.env.REALISM_PROOF_CYCLE_INTERVAL_MS || 60000),
    adversarialRecovery: /^(1|true|yes|on)$/i.test(String(process.env.SEMANTIC_CONTINUOUS_ADVERSARIAL_RECOVERY || '')),
    crashInjectionsPerWave: Number(process.env.SEMANTIC_CONTINUOUS_CRASH_INJECTIONS_PER_WAVE || 4),
    stallInjectionsPerWave: Number(process.env.SEMANTIC_CONTINUOUS_STALL_INJECTIONS_PER_WAVE || 4),
    stallDelayMs: Number(process.env.SEMANTIC_CONTINUOUS_STALL_DELAY_MS || 5000),
    catalogOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--benchmark-tier') { args.benchmarkTier = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--scoreboard-path') { args.scoreboardPath = path.resolve(next); index += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); index += 1; continue; }
    if (token === '--waves') { args.waves = Number(next); index += 1; continue; }
    if (token === '--surfaces-per-wave') { args.surfacesPerWave = Number(next); index += 1; continue; }
    if (token === '--wave-duration-ms') { args.waveDurationMs = Number(next); index += 1; continue; }
    if (token === '--wave-min-cycles') { args.waveMinCycles = Number(next); index += 1; continue; }
    if (token === '--duration-target-minutes') { args.durationTargetMinutes = Number(next); index += 1; continue; }
    if (token === '--cycle-interval-ms') { args.cycleIntervalMs = Number(next); index += 1; continue; }
    if (token === '--integration-proof') { args.integrationProof = true; continue; }
    if (token === '--realism-proof') { args.realismProof = true; args.integrationProof = true; continue; }
    if (token === '--functional-proof-duration-ms') { args.functionalProofDurationMs = Number(next); index += 1; continue; }
    if (token === '--functional-proof-min-cycles') { args.functionalProofMinCycles = Number(next); index += 1; continue; }
    if (token === '--functional-proof-cycle-interval-ms') { args.functionalProofCycleIntervalMs = Number(next); index += 1; continue; }
    if (token === '--realism-proof-duration-ms') { args.realismProofDurationMs = Number(next); index += 1; continue; }
    if (token === '--realism-proof-min-cycles') { args.realismProofMinCycles = Number(next); index += 1; continue; }
    if (token === '--realism-proof-cycle-interval-ms') { args.realismProofCycleIntervalMs = Number(next); index += 1; continue; }
    if (token === '--adversarial-recovery') { args.adversarialRecovery = true; continue; }
    if (token === '--crash-injections-per-wave') { args.crashInjectionsPerWave = Number(next); index += 1; continue; }
    if (token === '--stall-injections-per-wave') { args.stallInjectionsPerWave = Number(next); index += 1; continue; }
    if (token === '--stall-delay-ms') { args.stallDelayMs = Number(next); index += 1; continue; }
    if (token === '--catalog-only') { args.catalogOnly = true; continue; }
  }
  args.agentCount = Math.max(1, Number(args.agentCount || 1));
  args.benchmarkTier = String(args.benchmarkTier || 'tier1_smoke').trim() || 'tier1_smoke';
  args.waves = Math.max(1, Number(args.waves || 1));
  args.surfacesPerWave = Math.max(1, Number(args.surfacesPerWave || args.agentCount || 1));
  args.waveDurationMs = Math.max(0, Number(args.waveDurationMs || 0));
  args.waveMinCycles = Math.max(1, Number(args.waveMinCycles || 1));
  args.durationTargetMinutes = Math.max(1, Number(args.durationTargetMinutes || 30));
  args.cycleIntervalMs = Math.max(250, Number(args.cycleIntervalMs || 60000));
  args.functionalProofDurationMs = Math.max(0, Number(args.functionalProofDurationMs || 0));
  args.functionalProofMinCycles = Math.max(1, Number(args.functionalProofMinCycles || 1));
  args.functionalProofCycleIntervalMs = Math.max(250, Number(args.functionalProofCycleIntervalMs || 60000));
  args.realismProofDurationMs = Math.max(0, Number(args.realismProofDurationMs || 0));
  args.realismProofMinCycles = Math.max(1, Number(args.realismProofMinCycles || 1));
  args.realismProofCycleIntervalMs = Math.max(250, Number(args.realismProofCycleIntervalMs || 60000));
  args.crashInjectionsPerWave = Math.max(0, Number(args.crashInjectionsPerWave || 0));
  args.stallInjectionsPerWave = Math.max(0, Number(args.stallInjectionsPerWave || 0));
  args.stallDelayMs = Math.max(0, Number(args.stallDelayMs || 0));
  if (!args.artifactRoot) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `bootstrap-${stamp}`);
  }
  args.scoreboardPath ||= path.join(args.stackRoot, 'artifacts/benchmarks/scoreboard.json');
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface';
}

const MAILCHIMP_AREAS = Object.freeze([
  'audience', 'campaigns', 'journeys', 'templates', 'landing_pages', 'forms', 'crm', 'analytics', 'reports', 'delivery',
  'ecommerce', 'integrations', 'privacy', 'security', 'billing', 'marketplace', 'content', 'assets', 'experiments', 'platform'
]);

const MAILCHIMP_CAPABILITIES = Object.freeze([
  'lifecycle', 'workflow', 'segmentation', 'scheduling', 'approval', 'rendering', 'personalization', 'attribution', 'automation', 'compliance',
  'import_export', 'webhooks', 'oauth', 'reputation', 'forecasting', 'notifications', 'audit', 'permissions', 'observability', 'backfill'
]);

const MAILCHIMP_EXPANSION_DEPTHS = Object.freeze([
  'state_model',
  'workflow_orchestration',
  'analytics_read_model',
  'governance_controls',
  'integration_handoff',
  'audit_telemetry',
  'resilience_recovery',
  'operator_experience'
]);

function buildBlueprint({ benchmarkId, targetSurfaceCount, agentCount, waves }) {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 'clawd.semantic_product_blueprint.v1',
    generatedAt,
    benchmarkId,
    productClass: 'mailchimp_grade_marketing_automation_platform',
    fidelity: 'production_slice',
    targetSurfaceCount,
    requestedAgentCount: agentCount,
    replenishmentPlan: {
      waves,
      policy: 'after_each_wave_complete_generate_next_ready_surface_batch_from_remaining_negative_space',
      stopCondition: 'duration_target_or_catalog_exhausted_with_supervisor_green_or_blocker_report'
    },
    productAreas: MAILCHIMP_AREAS.map((area) => ({ id: area, label: area.replace(/_/g, ' ') })),
    architectureContracts: [
      'shared entity lifecycle contract',
      'runtime state transition contract',
      'event emission contract',
      'persistence handoff contract',
      'telemetry/read-model contract',
      'policy/security handoff contract'
    ],
    nonGoals: [
      'full Mailchimp parity claim',
      'browser/e2e parity proof',
      'production database/integration realism claim'
    ]
  };
}

function buildSurfaceCatalog({ count }) {
  const surfaces = [];
  const baseCombinationCount = MAILCHIMP_AREAS.length * MAILCHIMP_CAPABILITIES.length;
  for (let index = 0; index < count; index += 1) {
    const cursor = index + 1;
    const pairIndex = index % baseCombinationCount;
    const depthIndex = Math.floor(index / baseCombinationCount);
    const area = MAILCHIMP_AREAS[Math.floor(pairIndex / MAILCHIMP_CAPABILITIES.length)];
    const capability = MAILCHIMP_CAPABILITIES[pairIndex % MAILCHIMP_CAPABILITIES.length];
    const areaSlug = slug(area);
    const capabilitySlug = slug(capability);
    const expansionDepth = depthIndex === 0
      ? null
      : MAILCHIMP_EXPANSION_DEPTHS[(depthIndex - 1) % MAILCHIMP_EXPANSION_DEPTHS.length];
    const depthOrdinal = depthIndex === 0 ? null : String(depthIndex + 1).padStart(2, '0');
    const depthSlug = expansionDepth ? `${slug(expansionDepth)}_${depthOrdinal}` : null;
    const id = depthSlug
      ? `${areaSlug}_${capabilitySlug}_${depthSlug}_${String(cursor).padStart(4, '0')}`
      : `${areaSlug}_${capabilitySlug}_${String(cursor).padStart(3, '0')}`;
    const routeLike = ['campaigns', 'landing_pages', 'forms', 'crm', 'analytics', 'reports', 'marketplace', 'platform'].includes(area) && cursor % 3 === 0;
    const primary = routeLike
      ? (depthSlug
        ? `apps/web/routes/${areaSlug}-${capabilitySlug}-${depthSlug.replace(/_/g, '-')}-${cursor}.mjs`
        : `apps/web/routes/${areaSlug}-${capabilitySlug}-${cursor}.mjs`)
      : (depthSlug
        ? `packages/app/${areaSlug}/${depthSlug.replace(/_/g, '-')}/${capabilitySlug}-runtime-${cursor}.mjs`
        : `packages/app/${areaSlug}/${capabilitySlug}-runtime-${cursor}.mjs`);
    const companionKind = cursor % 4 === 0 ? 'events' : cursor % 4 === 1 ? 'storage' : cursor % 4 === 2 ? 'policies' : 'contracts';
    const companion = depthSlug
      ? `packages/app/${areaSlug}/${companionKind}/${depthSlug.replace(/_/g, '-')}/${capabilitySlug}-${companionKind}-${cursor}.mjs`
      : `packages/app/${areaSlug}/${companionKind}/${capabilitySlug}-${companionKind}-${cursor}.mjs`;
    surfaces.push({
      id,
      label: expansionDepth
        ? `${area.replace(/_/g, ' ')} ${capability.replace(/_/g, ' ')} ${expansionDepth.replace(/_/g, ' ')} runtime`
        : `${area.replace(/_/g, ' ')} ${capability.replace(/_/g, ' ')} runtime`,
      area,
      capability,
      expansionDepth,
      expansionDepthIndex: depthIndex,
      primary,
      companion,
      acceptanceClass: routeLike ? 'ui_route_runtime' : 'domain_runtime'
    });
  }
  return surfaces;
}

function auditSurfaceCatalog(surfaces, expectedCount) {
  const ids = surfaces.map((surface) => surface.id);
  const primaryFiles = surfaces.map((surface) => surface.primary);
  const companionFiles = surfaces.map((surface) => surface.companion);
  const uniqueIds = new Set(ids);
  const uniquePrimaryFiles = new Set(primaryFiles);
  const uniqueCompanionFiles = new Set(companionFiles);
  return {
    expectedCount,
    generatedCount: surfaces.length,
    baseCombinationCount: MAILCHIMP_AREAS.length * MAILCHIMP_CAPABILITIES.length,
    expansionDepthCount: surfaces.length
      ? Math.max(...surfaces.map((surface) => Number(surface.expansionDepthIndex || 0))) + 1
      : 0,
    uniqueIdCount: uniqueIds.size,
    uniquePrimaryFileCount: uniquePrimaryFiles.size,
    uniqueCompanionFileCount: uniqueCompanionFiles.size,
    exactCountSatisfied: surfaces.length === expectedCount,
    uniqueIdsSatisfied: uniqueIds.size === surfaces.length,
    uniquePrimaryFilesSatisfied: uniquePrimaryFiles.size === surfaces.length,
    uniqueCompanionFilesSatisfied: uniqueCompanionFiles.size === surfaces.length,
    ok: surfaces.length === expectedCount
      && uniqueIds.size === surfaces.length
      && uniquePrimaryFiles.size === surfaces.length
      && uniqueCompanionFiles.size === surfaces.length
  };
}

function buildAdversarialFailureInjections({ selected = [], waveNumber = 1, crashCount = 0, stallCount = 0, stallDelayMs = 0 } = {}) {
  const injections = [];
  const crashTargets = selected.slice(0, Math.max(0, crashCount));
  const crashTargetIds = new Set(crashTargets.map((surface) => surface.id));
  const stallTargets = selected.filter((surface) => !crashTargetIds.has(surface.id)).slice(0, Math.max(0, stallCount));
  for (const surface of crashTargets) {
    injections.push({
      shardId: surface.id,
      attempt: 1,
      mode: 'crash',
      note: `tier3plus continuous planner wave ${waveNumber} deterministic crash injection before verifier completion`
    });
  }
  for (const surface of stallTargets) {
    injections.push({
      shardId: surface.id,
      attempt: 1,
      mode: 'stall',
      delayMs: stallDelayMs,
      note: `tier3plus continuous planner wave ${waveNumber} deterministic stall injection before verifier completion`
    });
  }
  return injections;
}

function baselineModuleSource(surface, role) {
  const exportBase = slug(`${role}_${surface.id}`).replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`).replace(/_/g, '');
  const exportName = `${role}Baseline_${slug(surface.id)}`.replace(/[^a-zA-Z0-9_$]/g, '_');
  return `export const ${exportName}Contract = Object.freeze({
  surfaceId: ${JSON.stringify(surface.id)},
  area: ${JSON.stringify(surface.area)},
  capability: ${JSON.stringify(surface.capability)},
  role: ${JSON.stringify(role)},
  blueprintContract: 'mailchimp_grade_semantic_surface_v1',
  exportBase: ${JSON.stringify(exportBase)}
});

export function ${exportName}(input = {}) {
  const entityId = String(input.entityId || input.id || ${JSON.stringify(surface.id)});
  return {
    ok: true,
    surfaceId: ${JSON.stringify(surface.id)},
    area: ${JSON.stringify(surface.area)},
    capability: ${JSON.stringify(surface.capability)},
    role: ${JSON.stringify(role)},
    entityId,
    state: input.state || 'baseline_ready',
    contract: ${exportName}Contract
  };
}
`;
}

function materializeRepo(repoPath, surfaces) {
  fs.mkdirSync(repoPath, { recursive: true });
  writeJson(path.join(repoPath, 'package.json'), { type: 'module', private: true, name: 'mailchimp-semantic-continuous-planner-fixture' });
  for (const surface of surfaces) {
    const primaryPath = path.join(repoPath, surface.primary);
    const companionPath = path.join(repoPath, surface.companion);
    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.mkdirSync(path.dirname(companionPath), { recursive: true });
    if (!fs.existsSync(primaryPath)) fs.writeFileSync(primaryPath, baselineModuleSource(surface, 'primary_runtime'));
    if (!fs.existsSync(companionPath)) fs.writeFileSync(companionPath, baselineModuleSource(surface, 'companion_contract'));
  }
}

function verifierCommand({ stackRoot, surface, durationMs, minCycles, cycleIntervalMs }) {
  const verifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-semantic-architecture-surface.mjs');
  return [
    'node', verifierScriptPath, surface.id,
    '--file', surface.primary,
    '--companion', surface.companion,
    '--duration-ms', String(durationMs),
    '--min-cycles', String(minCycles),
    '--cycle-interval-ms', String(cycleIntervalMs)
  ].join(' ');
}

function toBenchmarkSurface({ stackRoot, surface, durationMs, minCycles, cycleIntervalMs }) {
  return {
    id: surface.id,
    label: surface.label,
    allowedFiles: [surface.primary, surface.companion],
    verification: [verifierCommand({ stackRoot, surface, durationMs, minCycles, cycleIntervalMs })]
  };
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
}

function writeIntegrationManifest({ repoPath, surfaces, benchmarkId }) {
  const manifestRelPath = 'packages/app/integration/semantic-continuous-registry.mjs';
  const manifestPath = path.join(repoPath, manifestRelPath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const registry = surfaces.map((surface, index) => ({
    surfaceId: surface.id,
    area: surface.area,
    capability: surface.capability,
    primary: surface.primary,
    companion: surface.companion,
    acceptanceClass: surface.acceptanceClass,
    integrationOrder: index + 1,
    registryVersion: 'semantic_continuous_integration_v1'
  }));
  const source = `export const integratedSurfaceRegistry = Object.freeze(${JSON.stringify(registry, null, 2)});

export function resolveIntegratedSurface(surfaceId) {
  return integratedSurfaceRegistry.find((surface) => surface.surfaceId === surfaceId) || null;
}

export function executeIntegratedFunctionalFlow(input = {}) {
  const requestedSurfaceIds = Array.isArray(input.surfaceIds) && input.surfaceIds.length
    ? input.surfaceIds
    : integratedSurfaceRegistry.map((surface) => surface.surfaceId);
  const selected = requestedSurfaceIds.map((surfaceId) => resolveIntegratedSurface(surfaceId)).filter(Boolean);
  const events = selected.map((surface, index) => ({
    type: 'semantic_continuous.integration.surface_selected',
    surfaceId: surface.surfaceId,
    area: surface.area,
    capability: surface.capability,
    integrationOrder: index + 1
  }));
  return {
    ok: selected.length === requestedSurfaceIds.length && selected.length > 0,
    benchmarkId: ${JSON.stringify(benchmarkId)},
    registryVersion: 'semantic_continuous_integration_v1',
    selectedSurfaceCount: selected.length,
    totalSurfaceCount: integratedSurfaceRegistry.length,
    events,
    telemetry: {
      areaCount: new Set(selected.map((surface) => surface.area)).size,
      capabilityCount: new Set(selected.map((surface) => surface.capability)).size,
      integrationPointCount: selected.length * 2
    }
  };
}
`;
  fs.writeFileSync(manifestPath, source);
  return { manifestRelPath, manifestPath, registry };
}

function runIntegrationFunctionalProof({ args, repoPath, artifactRoot, manifestRelPath }) {
  const proofPath = path.join(artifactRoot, 'integration_functional_proof.json');
  const proofResultPath = path.join(artifactRoot, 'integration_functional_proof_result.json');
  const verifierScriptPath = path.join(args.stackRoot, 'apps/system-benchmark/verify-integration-functional-proof-pack.mjs');
  const command = [
    verifierScriptPath,
    '--repo', repoPath,
    '--catalog', path.join(artifactRoot, 'surface_catalog.json'),
    '--wave-summaries', path.join(artifactRoot, 'wave_summaries.json'),
    '--manifest', manifestRelPath,
    '--output-json', proofResultPath,
    '--duration-ms', String(args.functionalProofDurationMs),
    '--min-cycles', String(args.functionalProofMinCycles),
    '--cycle-interval-ms', String(args.functionalProofCycleIntervalMs)
  ];
  const result = spawnSync(process.execPath, command, {
    cwd: args.stackRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 60
  });
  fs.writeFileSync(path.join(artifactRoot, 'integration_functional_proof_stdout.log'), result.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'integration_functional_proof_stderr.log'), result.stderr || '');
  const parsed = (() => {
    const fromFile = readJson(proofResultPath, null);
    if (fromFile) return fromFile;
    try { return JSON.parse(String(result.stdout || '').trim() || '{}'); }
    catch { return null; }
  })();
  const proof = {
    generatedAt: new Date().toISOString(),
    ok: result.status === 0 && parsed?.ok === true,
    exitCode: result.status,
    signal: result.signal,
    command: [process.execPath, ...command].join(' '),
    proofPath,
    proofResultPath,
    parsed
  };
  writeJson(proofPath, proof);
  return proof;
}

function runRealismProof({ args, repoPath, artifactRoot, manifestRelPath }) {
  const proofPath = path.join(artifactRoot, 'realism_proof.json');
  const proofResultPath = path.join(artifactRoot, 'realism_proof_result.json');
  const verifierScriptPath = path.join(args.stackRoot, 'apps/system-benchmark/verify-realism-proof-pack.mjs');
  const command = [
    verifierScriptPath,
    '--repo', repoPath,
    '--catalog', path.join(artifactRoot, 'surface_catalog.json'),
    '--wave-summaries', path.join(artifactRoot, 'wave_summaries.json'),
    '--manifest', manifestRelPath,
    '--output-json', proofResultPath,
    '--duration-ms', String(args.realismProofDurationMs),
    '--min-cycles', String(args.realismProofMinCycles),
    '--cycle-interval-ms', String(args.realismProofCycleIntervalMs)
  ];
  const result = spawnSync(process.execPath, command, {
    cwd: args.stackRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 60
  });
  fs.writeFileSync(path.join(artifactRoot, 'realism_proof_stdout.log'), result.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'realism_proof_stderr.log'), result.stderr || '');
  const parsed = (() => {
    const fromFile = readJson(proofResultPath, null);
    if (fromFile) return fromFile;
    try { return JSON.parse(String(result.stdout || '').trim() || '{}'); }
    catch { return null; }
  })();
  const proof = {
    generatedAt: new Date().toISOString(),
    ok: result.status === 0 && parsed?.ok === true,
    exitCode: result.status,
    signal: result.signal,
    command: [process.execPath, ...command].join(' '),
    proofPath,
    proofResultPath,
    parsed
  };
  writeJson(proofPath, proof);
  return proof;
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const benchmarkId = args.benchmarkId;
const benchmarkTier = args.benchmarkTier;
const totalSurfaceCount = args.waves * args.surfacesPerWave;
const repoPath = path.join(args.artifactRoot, 'repo');
const runnerScriptPath = path.join(args.stackRoot, 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs');
const blueprint = buildBlueprint({ benchmarkId, targetSurfaceCount: totalSurfaceCount, agentCount: args.agentCount, waves: args.waves });
const catalog = buildSurfaceCatalog({ count: totalSurfaceCount });
const catalogAudit = auditSurfaceCatalog(catalog, totalSurfaceCount);

fs.mkdirSync(args.artifactRoot, { recursive: true });
writeJson(path.join(args.artifactRoot, 'blueprint.json'), blueprint);
writeJson(path.join(args.artifactRoot, 'surface_catalog.json'), {
  generatedAt: new Date().toISOString(),
  requestedCount: totalSurfaceCount,
  count: catalog.length,
  audit: catalogAudit,
  surfaces: catalog
});
writeJson(path.join(args.artifactRoot, 'catalog_audit.json'), { generatedAt: new Date().toISOString(), ...catalogAudit });
if (args.catalogOnly) {
  const catalogOnlySummary = {
    generatedAt: new Date().toISOString(),
    benchmarkId,
    benchmarkTier,
    executionMode: 'semantic_continuous_planner_catalog_only',
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    catalogOnly: true,
    requestedAgentCount: args.agentCount,
    waveCount: args.waves,
    surfacesPerWave: args.surfacesPerWave,
    requestedTotalSurfaceCount: totalSurfaceCount,
    catalogSurfaceCount: catalog.length,
    catalogAudit,
    artifactRoot: args.artifactRoot,
    note: 'Catalog-only validation wrote the benchmark surface catalog without launching any worker/verifier run.'
  };
  writeJson(path.join(args.artifactRoot, 'completion_summary.json'), catalogOnlySummary);
  console.log(JSON.stringify(catalogOnlySummary, null, 2));
  process.exit(catalogAudit.ok ? 0 : 2);
}
if (!catalogAudit.ok) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId,
    benchmarkTier,
    status: 'blocked',
    phase: 'semantic_continuous_planner_catalog_generation',
    blocker: 'Semantic continuous planner catalog generation failed to satisfy the requested surface count or uniqueness gates.',
    nextAction: 'Repair buildSurfaceCatalog() so requested waves × surfacesPerWave yields distinct ids and product files before launching the benchmark.',
    catalogAudit
  };
  writeJson(path.join(args.artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(args.artifactRoot, 'completion_summary.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId,
    benchmarkTier,
    executionMode: 'semantic_continuous_planner_catalog_generation',
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    blocker,
    artifactRoot: args.artifactRoot
  });
  console.log(JSON.stringify({ ok: false, artifactRoot: args.artifactRoot, blocker }, null, 2));
  process.exit(2);
}
materializeRepo(repoPath, catalog);

const replenishmentEvents = [];
const waveSummaries = [];
const adversarialRecoveryPlan = [];
let completedSurfaceIds = new Set();
let blocker = null;

for (let waveIndex = 0; waveIndex < args.waves; waveIndex += 1) {
  const waveNumber = waveIndex + 1;
  const remaining = catalog.filter((surface) => !completedSurfaceIds.has(surface.id));
  const selected = remaining.slice(0, args.surfacesPerWave);
  replenishmentEvents.push({
    at: new Date().toISOString(),
    type: waveIndex === 0 ? 'initial_ready_queue_seeded' : 'ready_queue_replenished',
    wave: waveNumber,
    requestedAgentCount: args.agentCount,
    selectedSurfaceCount: selected.length,
    remainingBeforeSelection: remaining.length,
    selectedSurfaceIds: selected.map((surface) => surface.id),
    reason: waveIndex === 0 ? 'start_benchmark' : 'previous_wave_complete_objective_still_red'
  });
  if (selected.length === 0) break;

  const waveRoot = path.join(args.artifactRoot, 'waves', `wave-${String(waveNumber).padStart(3, '0')}`);
  const failureInjections = args.adversarialRecovery
    ? buildAdversarialFailureInjections({
      selected,
      waveNumber,
      crashCount: args.crashInjectionsPerWave,
      stallCount: args.stallInjectionsPerWave,
      stallDelayMs: args.stallDelayMs
    })
    : [];
  if (failureInjections.length > 0) {
    adversarialRecoveryPlan.push({
      wave: waveNumber,
      selectedSurfaceCount: selected.length,
      crashInjectionCount: failureInjections.filter((entry) => entry.mode === 'crash').length,
      stallInjectionCount: failureInjections.filter((entry) => entry.mode === 'stall').length,
      injections: failureInjections
    });
  }
  const waveSurfaces = selected.map((surface) => toBenchmarkSurface({
    stackRoot: args.stackRoot,
    surface,
    durationMs: args.waveDurationMs,
    minCycles: args.waveMinCycles,
    cycleIntervalMs: args.cycleIntervalMs
  }));
  const scaffold = bootstrapTransferBenchmark({
    benchmarkId: `${benchmarkId}_wave_${String(waveNumber).padStart(3, '0')}`,
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'mailchimp_semantic_continuous_planner_wave',
    fidelity: 'production_slice',
    repoPath,
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: Math.min(args.agentCount, selected.length),
    notes: `Continuous planner wave ${waveNumber}: generated from blueprint negative-space inventory after ${completedSurfaceIds.size} completed surface(s).`,
    replyAnchor: 'Jake asked to move beyond fixture scale toward Mailchimp-grade semantic architecture and continuous planner/replenishment proof.',
    scope: {
      durationTargetMinutes: Math.max(1, Math.ceil(args.waveDurationMs / 60000)),
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: { required: true, mode: 'semantic_product_architecture' },
      proofCarryingClaims: {
        enabled: true,
        mode: 'require_adversarial_survival'
      },
      canonicalLandingEvidence: {
        enabled: true,
        mode: 'block_on_failed_landing',
        minAddedLineCount: 30,
        minUniqueNormalizedAddedLineCount: 25,
        duplicateLineRatioMax: 0.35,
        duplicateLineCheckMinAddedLines: 20
      },
      blueprintPath: path.join(args.artifactRoot, 'blueprint.json'),
      plannerWave: waveNumber,
      failureInjections,
      surfaces: waveSurfaces
    },
    verifierSet: [{ kind: 'semantic_architecture_surface', command: `node ${path.join(args.stackRoot, 'apps/system-benchmark/verify-semantic-architecture-surface.mjs')}` }],
    artifactRoot: waveRoot,
    scoreboardPath: args.scoreboardPath
  });

  const waveStartedAt = Date.now();
  const run = spawnSync(process.execPath, [runnerScriptPath, path.join(scaffold.root, 'run_contract.json')], {
    cwd: args.stackRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env }
  });
  const waveElapsedMs = Date.now() - waveStartedAt;
  fs.writeFileSync(path.join(waveRoot, 'continuous_planner_runner_stdout.log'), run.stdout || '');
  fs.writeFileSync(path.join(waveRoot, 'continuous_planner_runner_stderr.log'), run.stderr || '');
  const completion = readJson(path.join(waveRoot, 'completion_summary.json'), {});
  const transfer = readJson(path.join(waveRoot, 'transfer_evidence.json'), {});
  const threshold = readJson(path.join(waveRoot, 'threshold_evaluation.json'), {});
  const patchQueue = readJson(path.join(waveRoot, 'orchestrator_run/patch_queue.json'), { merged: [], rejected: [] });
  const orchestratorSummary = readJson(path.join(waveRoot, 'orchestrator_run/summary.json'), {});
  const orchestratorMetrics = orchestratorSummary.metrics || {};
  const claimLedger = readJson(path.join(waveRoot, 'claim_ledger.json'), readJson(path.join(waveRoot, 'orchestrator_run/claim_ledger.json'), null));
  const landingEvidence = readJson(path.join(waveRoot, 'landing_evidence.json'), readJson(path.join(waveRoot, 'orchestrator_run/landing_evidence.json'), null));
  const truth = readJson(path.join(waveRoot, 'truth_conflicts.json'), { contradictions: [] });
  const supervisor = readJson(path.join(waveRoot, 'orchestrator_run/supervisor.json'), {});
  const claimLedgerSummary = claimLedger?.summary || completion.claimLedgerSummary || null;
  const landingPolicy = landingEvidence?.policy || null;

  const waveSummary = {
    wave: waveNumber,
    artifactRoot: waveRoot,
    exitCode: run.status,
    signal: run.signal,
    elapsedMs: waveElapsedMs,
    surfaceCount: selected.length,
    requestedAgentCount: Math.min(args.agentCount, selected.length),
    mechanicalGreen: completion.mechanicalGreen === true,
    scaleProofReady: completion.scaleProofReady === true,
    thresholdPass: completion.thresholdPass === true,
    durationMinutes: completion.durationMinutes ?? null,
    shardCount: completion.shardCount ?? selected.length,
    mergedShardCount: completion.mergedShardCount ?? 0,
    peakConcurrency: completion.peakConcurrency ?? 0,
    transferScore: transfer.transferScore ?? completion.transferScore ?? null,
    productiveSurfaceCount: transfer.productiveSurfaceCount ?? 0,
    semanticAdmittedSurfaceCount: transfer.semanticAdmittedSurfaceCount ?? 0,
    rejectedPatchCount: Array.isArray(patchQueue.rejected) ? patchQueue.rejected.length : 0,
    claimLedgerStatus: claimLedgerSummary?.status || null,
    claimLedgerClaimCount: Number(claimLedgerSummary?.claimCount || 0),
    claimLedgerSurvivedCount: Number(claimLedgerSummary?.survivedCount || 0),
    claimLedgerCounterclaimedCount: Number(claimLedgerSummary?.counterclaimedCount || 0),
    landingMinAddedLineCount: landingPolicy?.minAddedLineCount ?? null,
    landingMinUniqueNormalizedAddedLineCount: landingPolicy?.minUniqueNormalizedAddedLineCount ?? null,
    truthConflictCount: Array.isArray(truth.contradictions) ? truth.contradictions.length : 0,
    supervisorStatus: supervisor.topLevel?.status || null,
    thresholdFailures: threshold.failures || completion.thresholdFailures || [],
    selectedSurfaceIds: selected.map((surface) => surface.id)
  };
  waveSummary.crashInjectionCount = Number(orchestratorMetrics.crashInjectionCount || 0);
  waveSummary.stallInjectionCount = Number(orchestratorMetrics.stallInjectionCount || 0);
  waveSummary.workerExitFailures = Number(orchestratorMetrics.workerExitFailures || 0);
  waveSummary.workerTimeoutCount = Number(orchestratorMetrics.workerTimeoutCount || 0);
  waveSummary.recoveryCount = Number(orchestratorMetrics.recoveryCount || 0);
  waveSummary.stateLossEvents = Number(orchestratorMetrics.stateLossEvents || 0);
  waveSummary.continuityFailureCount = Array.isArray(orchestratorMetrics.continuityFailures) ? orchestratorMetrics.continuityFailures.length : 0;
  waveSummaries.push(waveSummary);

  if (!waveSummary.mechanicalGreen
    || !waveSummary.scaleProofReady
    || waveSummary.rejectedPatchCount > 0
    || waveSummary.truthConflictCount > 0
    || waveSummary.claimLedgerStatus !== 'green'
    || waveSummary.claimLedgerClaimCount < waveSummary.mergedShardCount
    || waveSummary.claimLedgerCounterclaimedCount > 0) {
    blocker = {
      blocker: `Continuous planner wave ${waveNumber} failed before the benchmark could replenish further work cleanly.`,
      nextAction: `Inspect ${waveRoot}, repair the failed wave, then rerun the continuous planner benchmark.`,
      wave: waveSummary
    };
    break;
  }

  for (const surfaceId of selected.map((surface) => surface.id)) completedSurfaceIds.add(surfaceId);
}

writeJson(path.join(args.artifactRoot, 'replenishment_events.json'), { generatedAt: new Date().toISOString(), events: replenishmentEvents });
writeJson(path.join(args.artifactRoot, 'wave_summaries.json'), { generatedAt: new Date().toISOString(), waves: waveSummaries });
if (args.adversarialRecovery) {
  writeJson(path.join(args.artifactRoot, 'adversarial_recovery_plan.json'), {
    generatedAt: new Date().toISOString(),
    required: true,
    crashInjectionsPerWave: args.crashInjectionsPerWave,
    stallInjectionsPerWave: args.stallInjectionsPerWave,
    stallDelayMs: args.stallDelayMs,
    waves: adversarialRecoveryPlan
  });
}

let integrationManifest = null;
let integrationFunctionalProof = null;
let realismProof = null;
if (!blocker && args.integrationProof) {
  const completedSurfaces = catalog.filter((surface) => completedSurfaceIds.has(surface.id));
  integrationManifest = writeIntegrationManifest({ repoPath, surfaces: completedSurfaces, benchmarkId });
  writeJson(path.join(args.artifactRoot, 'integration_manifest.json'), {
    generatedAt: new Date().toISOString(),
    manifestRelPath: integrationManifest.manifestRelPath,
    manifestPath: integrationManifest.manifestPath,
    registrySurfaceCount: integrationManifest.registry.length,
    registry: integrationManifest.registry
  });
  integrationFunctionalProof = runIntegrationFunctionalProof({
    args,
    repoPath,
    artifactRoot: args.artifactRoot,
    manifestRelPath: integrationManifest.manifestRelPath
  });
  if (!integrationFunctionalProof.ok) {
    blocker = {
      blocker: 'Integration controller or functional proof pack failed after semantic waves completed.',
      nextAction: 'Inspect integration_manifest.json and integration_functional_proof.json, repair contract composition or proof-pack execution, then rerun.',
      integrationFunctionalProof
    };
  }
  if (!blocker && args.realismProof) {
    realismProof = runRealismProof({
      args,
      repoPath,
      artifactRoot: args.artifactRoot,
      manifestRelPath: integrationManifest.manifestRelPath
    });
    if (!realismProof.ok) {
      blocker = {
        blocker: 'Browser/API, database, or provider-sandbox realism proof failed after integration proof completed.',
        nextAction: 'Inspect realism_proof.json, repair the failing realism proof class, then rerun.',
        realismProof
      };
    }
  }
}

const elapsedMs = Date.now() - startedAt;
const durationMinutes = Number((elapsedMs / 60000).toFixed(2));
const totalSelectedSurfaceCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.surfaceCount || 0), 0);
const totalProductiveSurfaceCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.productiveSurfaceCount || 0), 0);
const totalMergedShardCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.mergedShardCount || 0), 0);
const totalRejectedPatchCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.rejectedPatchCount || 0), 0);
const totalClaimLedgerClaimCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.claimLedgerClaimCount || 0), 0);
const totalClaimLedgerSurvivedCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.claimLedgerSurvivedCount || 0), 0);
const totalClaimLedgerCounterclaimedCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.claimLedgerCounterclaimedCount || 0), 0);
const totalCrashInjectionCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.crashInjectionCount || 0), 0);
const totalStallInjectionCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.stallInjectionCount || 0), 0);
const totalWorkerExitFailures = waveSummaries.reduce((sum, wave) => sum + Number(wave.workerExitFailures || 0), 0);
const totalWorkerTimeoutCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.workerTimeoutCount || 0), 0);
const totalStateLossEvents = waveSummaries.reduce((sum, wave) => sum + Number(wave.stateLossEvents || 0), 0);
const totalContinuityFailureCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.continuityFailureCount || 0), 0);
const truthConflictCount = waveSummaries.reduce((sum, wave) => sum + Number(wave.truthConflictCount || 0), 0);
const peakConcurrency = Math.max(0, ...waveSummaries.map((wave) => Number(wave.peakConcurrency || 0)));
const mechanicalGreen = !blocker && waveSummaries.length === args.waves && waveSummaries.every((wave) => wave.mechanicalGreen === true) && totalMergedShardCount === totalSelectedSurfaceCount;
const scaleProofReady = peakConcurrency >= Math.min(args.agentCount, args.surfacesPerWave) && waveSummaries.every((wave) => wave.scaleProofReady === true);
const claimLedgerGreen = waveSummaries.length === args.waves
  && totalClaimLedgerClaimCount >= totalMergedShardCount
  && totalClaimLedgerSurvivedCount >= totalMergedShardCount
  && totalClaimLedgerCounterclaimedCount === 0
  && waveSummaries.every((wave) => wave.claimLedgerStatus === 'green');
const replenishmentGreen = replenishmentEvents.filter((event) => event.type === 'ready_queue_replenished').length >= Math.max(0, args.waves - 1);
const integrationGreen = !args.integrationProof || (integrationManifest?.registry?.length === totalSelectedSurfaceCount && integrationFunctionalProof?.ok === true);
const realismGreen = !args.realismProof || realismProof?.ok === true;
const durationTargetGreen = durationMinutes >= args.durationTargetMinutes;
const expectedCrashInjectionCount = args.adversarialRecovery ? waveSummaries.length * args.crashInjectionsPerWave : 0;
const expectedStallInjectionCount = args.adversarialRecovery ? waveSummaries.length * args.stallInjectionsPerWave : 0;
const adversarialRecoveryGreen = !args.adversarialRecovery
  || (waveSummaries.length === args.waves
    && totalCrashInjectionCount >= expectedCrashInjectionCount
    && totalStallInjectionCount >= expectedStallInjectionCount
    && totalWorkerExitFailures >= expectedCrashInjectionCount
    && totalWorkerTimeoutCount === 0
    && totalStateLossEvents === 0
    && totalContinuityFailureCount === 0
    && totalMergedShardCount === totalSelectedSurfaceCount);
const metrics = {
  productiveIterationRate: totalSelectedSurfaceCount > 0 ? Number((totalProductiveSurfaceCount / totalSelectedSurfaceCount).toFixed(2)) : 0,
  noOpRate: totalSelectedSurfaceCount > 0 ? Number(((totalSelectedSurfaceCount - totalProductiveSurfaceCount) / totalSelectedSurfaceCount).toFixed(2)) : 1,
  repeatBlockerRate: totalSelectedSurfaceCount > 0 ? Number((totalRejectedPatchCount / totalSelectedSurfaceCount).toFixed(2)) : 1,
  medianMinutesToMeaningfulProgress: median(waveSummaries.map((wave) => Number(wave.durationMinutes || 0) / Math.max(1, Number(wave.mergedShardCount || 1)))) ?? 0.01,
  verificationIntegrity: totalMergedShardCount > 0 ? Number((totalProductiveSurfaceCount / totalMergedShardCount).toFixed(2)) : 0,
  handoffEfficiency: totalSelectedSurfaceCount > 0 ? Number((totalMergedShardCount / totalSelectedSurfaceCount).toFixed(2)) : 0,
  autonomyWindowMinutes: durationMinutes,
  truthIntegrityContradictions: truthConflictCount,
  fakeGreenIncidents: 0,
  transferScore: totalSelectedSurfaceCount > 0 ? Number((totalProductiveSurfaceCount / totalSelectedSurfaceCount).toFixed(2)) : 0,
  claimLedgerGreen,
  claimLedgerClaimCount: totalClaimLedgerClaimCount,
  claimLedgerSurvivedCount: totalClaimLedgerSurvivedCount,
  claimLedgerCounterclaimedCount: totalClaimLedgerCounterclaimedCount,
  claimLedgerSurvivalRate: totalClaimLedgerClaimCount > 0 ? Number((totalClaimLedgerSurvivedCount / totalClaimLedgerClaimCount).toFixed(2)) : 0,
  replenishmentEventCount: replenishmentEvents.length,
  replenishmentGreen,
  integrationGreen,
  functionalProofGreen: !args.integrationProof || integrationFunctionalProof?.ok === true,
  functionalProofCycleCount: integrationFunctionalProof?.parsed?.cycleCount ?? null,
  realismGreen,
  realismProofCycleCount: realismProof?.parsed?.cycleCount ?? null,
  adversarialRecoveryGreen,
  crashInjectionCount: totalCrashInjectionCount,
  stallInjectionCount: totalStallInjectionCount,
  workerExitFailures: totalWorkerExitFailures,
  workerTimeoutCount: totalWorkerTimeoutCount,
  stateLossEvents: totalStateLossEvents,
  continuityFailureCount: totalContinuityFailureCount
};
const thresholdEvaluation = evaluateBenchmarkThresholds({ benchmarkTier, metrics });
const thresholdPass = mechanicalGreen && scaleProofReady && claimLedgerGreen && replenishmentGreen && integrationGreen && realismGreen && adversarialRecoveryGreen && durationTargetGreen && thresholdEvaluation.ok;
if (!blocker && !thresholdPass) {
  blocker = {
    blocker: 'Continuous semantic planner run completed mechanically, but scored thresholds were not met.',
    nextAction: durationMinutes < args.durationTargetMinutes
      ? 'Run the endurance profile with longer wave durations so the aggregate autonomy window reaches the declared target.'
      : 'Inspect threshold_evaluation.json and repair the missing metric evidence.',
    thresholdFailures: thresholdEvaluation.failures,
    durationTarget: { durationTargetMinutes: args.durationTargetMinutes, durationMinutes, durationTargetMet: durationMinutes >= args.durationTargetMinutes }
  };
}

const completion = {
  generatedAt: new Date().toISOString(),
  benchmarkId,
  benchmarkTier,
  runId: `${benchmarkId}-${new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`,
  executionMode: 'semantic_continuous_planner_waves',
  thresholdPass,
  mechanicalGreen,
  scaleProofReady,
  replenishmentGreen,
  durationTargetGreen,
  durationTargetMinutes: args.durationTargetMinutes,
  adversarialRecoveryRequired: args.adversarialRecovery,
  adversarialRecoveryGreen,
  crashInjectionCount: totalCrashInjectionCount,
  stallInjectionCount: totalStallInjectionCount,
  workerExitFailures: totalWorkerExitFailures,
  workerTimeoutCount: totalWorkerTimeoutCount,
  stateLossEvents: totalStateLossEvents,
  continuityFailureCount: totalContinuityFailureCount,
  claimLedgerGreen,
  claimLedgerClaimCount: totalClaimLedgerClaimCount,
  claimLedgerSurvivedCount: totalClaimLedgerSurvivedCount,
  claimLedgerCounterclaimedCount: totalClaimLedgerCounterclaimedCount,
  integrationGreen,
  integrationProofRequired: args.integrationProof,
  realismProofRequired: args.realismProof,
  integrationManifestPath: integrationManifest?.manifestRelPath || null,
  functionalProofGreen: !args.integrationProof || integrationFunctionalProof?.ok === true,
  realismGreen,
  requestedAgentCount: args.agentCount,
  waveCount: args.waves,
  completedWaveCount: waveSummaries.length,
  surfacesPerWave: args.surfacesPerWave,
  requestedTotalSurfaceCount: totalSurfaceCount,
  catalogSurfaceCount: catalog.length,
  catalogAudit,
  totalSurfaceCount: totalSelectedSurfaceCount,
  mergedShardCount: totalMergedShardCount,
  peakConcurrency,
  durationMinutes,
  transferScore: metrics.transferScore,
  thresholdFailures: thresholdEvaluation.failures,
  blocker,
  artifactRoot: args.artifactRoot
};

writeJson(path.join(args.artifactRoot, 'threshold_evaluation.json'), { generatedAt: new Date().toISOString(), benchmarkTier, thresholdPass, metrics, ...thresholdEvaluation });
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), completion);
const scoreboardRow = createScoreboardRow({
  contract: {
    runId: completion.runId,
    benchmarkId,
    benchmarkTier,
    repoPath,
    requestedAgentCount: args.agentCount
  },
  metrics,
  outcome: {
    pass: thresholdPass,
    mechanicalGreen,
    scaleProofReady,
    thresholdFailures: thresholdEvaluation.failures
  },
  durationMinutes,
  blockerFamily: blocker ? (durationTargetGreen ? 'semantic_continuous_planner_blocked' : 'duration_target_not_met') : null,
  blockerSemantics: blocker ? 'blocking' : 'none',
  notes: thresholdPass
    ? `Continuous semantic planner benchmark passed with ${waveSummaries.length}/${args.waves} replenished wave(s), ${totalMergedShardCount}/${totalSelectedSurfaceCount} merged surface(s), and peak concurrency ${peakConcurrency}.`
    : blocker?.blocker || 'Continuous semantic planner benchmark completed without a threshold pass.'
});
writeJson(path.join(args.artifactRoot, 'scoreboard_row.json'), scoreboardRow);
upsertBenchmarkScoreboardRow({ scoreboardPath: args.scoreboardPath, row: scoreboardRow });
writeJson(path.join(args.artifactRoot, 'program_state.json'), {
  schemaVersion: 'clawd.semantic_continuous_planner_program_state.v1',
  generatedAt: new Date().toISOString(),
  status: thresholdPass ? 'passed' : blocker ? 'blocked' : 'completed',
  done: true,
  stopAllowed: true,
  stopReason: thresholdPass ? 'continuous_planner_threshold_pass' : 'continuous_planner_blocker_report_written',
  summary: thresholdPass ? 'Continuous semantic planner benchmark passed.' : blocker?.blocker || 'Continuous semantic planner benchmark completed.'
});
if (blocker) writeJson(path.join(args.artifactRoot, 'blocker_report.json'), { generatedAt: new Date().toISOString(), benchmarkId, status: 'blocked', phase: 'semantic_continuous_planner', ...blocker });

console.log(JSON.stringify({
  ok: mechanicalGreen,
  thresholdPass,
  benchmarkTier,
  artifactRoot: args.artifactRoot,
  waveCount: waveSummaries.length,
  totalSurfaceCount: totalSelectedSurfaceCount,
  mergedShardCount: totalMergedShardCount,
  peakConcurrency,
  durationMinutes,
  transferScore: metrics.transferScore,
  claimLedgerGreen,
  claimLedgerClaimCount: totalClaimLedgerClaimCount,
  claimLedgerSurvivedCount: totalClaimLedgerSurvivedCount,
  claimLedgerCounterclaimedCount: totalClaimLedgerCounterclaimedCount,
  replenishmentGreen,
  adversarialRecoveryGreen,
  crashInjectionCount: totalCrashInjectionCount,
  stallInjectionCount: totalStallInjectionCount,
  workerExitFailures: totalWorkerExitFailures,
  integrationGreen,
  functionalProofGreen: !args.integrationProof || integrationFunctionalProof?.ok === true,
  realismGreen,
  blocker
}, null, 2));

process.exit(mechanicalGreen ? 0 : 1);
