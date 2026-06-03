#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import { reduceRunState } from '../../packages/orchestrator-run-state/index.mjs';
import { deriveObservedConcurrencyTruth, evaluateScaleCredit } from '../../packages/orchestrator-scheduler-truth/index.mjs';
import {
  createScoreboardRow,
  deriveBenchmarkAutonomyMetrics,
  evaluateBenchmarkThresholds,
  resolveBenchmarkLeaseTtlMs,
  resolveBenchmarkMaxRuntimeMs,
  resolveBenchmarkWorkerTimeoutMs,
  upsertBenchmarkScoreboardRow
} from '../../packages/system-benchmark/index.mjs';

function readJson(targetPath, fallback = null) {
  return fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : fallback;
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  console.error('usage: node run-transfer-orchestrator-benchmark.mjs <run_contract.json>');
  process.exit(1);
}

function deriveVerifierId(surfaceId, command, index) {
  const normalized = String(command || '').toLowerCase();
  const family = normalized.includes('smoke') ? 'smoke'
    : normalized.includes('lint') ? 'lint'
    : normalized.includes('import') ? 'imports'
    : normalized.includes('test') ? 'tests'
    : 'command';
  return `${surfaceId}__${family}_${index + 1}`;
}

function semanticProductAdmissionRequired(scope = {}) {
  return scope?.requireSemanticProductAdmission === true
    || scope?.semanticProductAdmission?.required === true
    || scope?.productDiffMode === 'semantic_product_architecture';
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function isProductSourceFile(filePath = '') {
  return /^(apps|packages)\//.test(String(filePath || ''))
    && /\.(?:mjs|js|jsx|ts|tsx|html|css)$/i.test(String(filePath || ''));
}

function isStaticSiteProductFile(filePath = '') {
  return /^(?:app|assets|blog|private-dashboard|services|mockups)\//.test(String(filePath || ''))
    || /^(?:index|claim-guard-pilot|denial-ops-pilot|ai-agent|script|styles)\.(?:html|js|css)$/i.test(String(filePath || ''));
}

function productSurfaceFiles(surface = {}) {
  const candidates = stableList([
    ...(surface.productFiles || []),
    surface.productFile,
    surface.targetFile,
    ...(surface.allowedFiles || []),
    ...(surface.fileAreas || [])
  ]);
  const sourceProductFiles = candidates.filter(isProductSourceFile);
  const staticProductFiles = candidates.filter((entry) => /\.(?:html|css|js|mjs)$/i.test(String(entry || '')) && isStaticSiteProductFile(entry));
  return stableList([...sourceProductFiles, ...staticProductFiles]);
}

function commandLooksLikeSemanticRuntimeVerifier(command = '') {
  return /verify-mailchimp-production-surface\.mjs/.test(String(command || ''))
    || /semantic[_-]?runtime/i.test(String(command || ''));
}

function semanticRuntimeVerifierCommand({ surface, productFile, scope = {} }) {
  const verifierPath = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), 'verify-mailchimp-production-surface.mjs'));
  const semanticAdmission = scope.semanticProductAdmission || {};
  const flags = [];
  if (semanticAdmission.requireNormalFlowIntegration === true || semanticAdmission.requireExistingProductNormalFlow === true) flags.push('--require-normal-flow');
  if (semanticAdmission.requireExistingProductNormalFlow === true) flags.push('--require-existing-product-normal-flow');
  return [
    'node',
    shellQuote(verifierPath),
    shellQuote(surface.id),
    '--file',
    shellQuote(productFile),
    '--duration-ms',
    '"${MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE:-0}"',
    '--min-cycles',
    '"${MAILCHIMP_BENCHMARK_SURFACE_MIN_CYCLES_OVERRIDE:-1}"',
    '--cycle-interval-ms',
    '"${MAILCHIMP_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS_OVERRIDE:-60000}"',
    ...flags
  ].join(' ');
}

function buildTransferPlan(contract) {
  const verifierCatalog = {};
  const surfaces = contract.scope?.surfaces || [];
  const productDiffMode = contract.scope?.productDiffMode || null;
  const requireSemanticProductAdmission = semanticProductAdmissionRequired(contract.scope || {});
  const productDiffArtifactRequired = Boolean(productDiffMode || requireSemanticProductAdmission);
  const semanticRuntimeProofRequired = contract.scope?.semanticProductAdmission?.requireRuntimeExecution === true;
  const semanticAcceptanceCheck = 'Semantic architecture evidence required: real product behavior must be integrated into the assigned source-of-truth surface; marker-only/source-syntax-only deltas do not count.';
  const workUnits = surfaces.map((surface) => {
    const originalAllowedFiles = stableList(surface.allowedFiles || []);
    const writableProductFiles = productSurfaceFiles(surface);
    const transferAllowedFiles = writableProductFiles.length ? writableProductFiles : originalAllowedFiles;
    const verificationCommands = stableList(surface.verification || []);
    const runSurfaceVerificationCommandsDuringLive = contract.scope?.semanticProductAdmission?.runSurfaceVerificationCommandsDuringLive === true;
    const liveVerificationCommands = semanticRuntimeProofRequired && !runSurfaceVerificationCommandsDuringLive
      ? verificationCommands.filter(commandLooksLikeSemanticRuntimeVerifier)
      : verificationCommands;
    const verifierSpecs = liveVerificationCommands.map((command, index) => ({
      id: deriveVerifierId(surface.id, command, index),
      command,
      autoGenerated: false
    }));
    if (semanticRuntimeProofRequired && writableProductFiles[0] && !liveVerificationCommands.some(commandLooksLikeSemanticRuntimeVerifier)) {
      verifierSpecs.push({
        id: `${surface.id}__semantic_runtime`,
        command: semanticRuntimeVerifierCommand({ surface, productFile: writableProductFiles[0], scope: contract.scope || {} }),
        autoGenerated: true
      });
    }
    const surfaceVerifierCatalog = {};
    const requiredVerifiers = verifierSpecs.map((spec) => {
      const entry = {
        id: spec.id,
        command: spec.command,
        purpose: spec.autoGenerated ? `Execute semantic runtime proof for ${surface.label}` : `Verify ${surface.label}`,
        surfaceId: surface.id,
        allowedFiles: transferAllowedFiles,
        autoGenerated: spec.autoGenerated
      };
      verifierCatalog[spec.id] = entry;
      surfaceVerifierCatalog[spec.id] = entry;
      return spec.id;
    });
    const acceptanceChecks = verifierSpecs.map((spec) => `Verifier passes: ${spec.command}`);
    if (requireSemanticProductAdmission) acceptanceChecks.push(semanticAcceptanceCheck);
    return {
      id: surface.id,
      title: surface.label,
      goal: `Validate transfer surface ${surface.label}`,
      lane: 'transfer_validation',
      domain: surface.id,
      fileAreas: transferAllowedFiles,
      allowedFiles: transferAllowedFiles,
      deps: [],
      requiredVerifiers,
      acceptanceChecks,
      inputs: {
        verifierCatalog: surfaceVerifierCatalog,
        productDiffMode,
        semanticProductAdmission: {
          required: requireSemanticProductAdmission,
          mode: contract.scope?.semanticProductAdmission?.mode || (requireSemanticProductAdmission ? 'semantic_product_architecture' : null),
          requireRuntimeExecution: contract.scope?.semanticProductAdmission?.requireRuntimeExecution === true,
          requireExistingProductCall: contract.scope?.semanticProductAdmission?.requireExistingProductCall === true,
          requireNormalFlowIntegration: contract.scope?.semanticProductAdmission?.requireNormalFlowIntegration === true,
          requireExistingProductNormalFlow: contract.scope?.semanticProductAdmission?.requireExistingProductNormalFlow === true,
          requireApiProbeWhenAvailable: contract.scope?.semanticProductAdmission?.requireApiProbeWhenAvailable === true,
          rejectGenericSemanticShim: contract.scope?.semanticProductAdmission?.rejectGenericSemanticShim === true
        },
        creativeProductWork: {
          ...(contract.scope?.creativeProductWork || {}),
          required: contract.scope?.creativeProductWork?.required === true || productDiffMode === 'creative_product_work'
        }
      },
      metadata: {
        surfaceId: surface.id,
        artifactKind: productDiffArtifactRequired ? 'product_diff' : 'verification_evidence',
        verifierCatalog: surfaceVerifierCatalog,
        productDiffMode,
        semanticProductAdmissionRequired: requireSemanticProductAdmission,
        semanticProductAdmissionMode: contract.scope?.semanticProductAdmission?.mode || null,
        semanticRuntimeExecutionRequired: contract.scope?.semanticProductAdmission?.requireRuntimeExecution === true,
        semanticExistingProductCallRequired: contract.scope?.semanticProductAdmission?.requireExistingProductCall === true,
        semanticNormalFlowIntegrationRequired: contract.scope?.semanticProductAdmission?.requireNormalFlowIntegration === true,
        semanticExistingProductNormalFlowRequired: contract.scope?.semanticProductAdmission?.requireExistingProductNormalFlow === true,
        semanticApiProbeWhenAvailableRequired: contract.scope?.semanticProductAdmission?.requireApiProbeWhenAvailable === true,
        rejectGenericSemanticShim: contract.scope?.semanticProductAdmission?.rejectGenericSemanticShim === true,
        creativeProductWorkRequired: contract.scope?.creativeProductWork?.required === true || productDiffMode === 'creative_product_work',
        creativeProductWork: contract.scope?.creativeProductWork || null,
        originalAllowedFiles,
        transferAllowedFiles,
        verifierOnlyFiles: originalAllowedFiles.filter((filePath) => !transferAllowedFiles.includes(filePath)),
        baselineVerificationCommands: semanticRuntimeProofRequired ? verificationCommands.filter((command) => !liveVerificationCommands.includes(command)) : [],
        liveSurfaceVerificationCommands: liveVerificationCommands
      }
    };
  });
  return {
    verifierCatalog,
    workGraph: {
      targetPath: contract.repoPath,
      workUnits
    }
  };
}

function createResultBackedVerifierMap(verifierIds) {
  return Object.fromEntries(verifierIds.map((verifierId) => [verifierId, async (patch) => {
    const result = readJson(patch.metadata?.resultPath, null);
    const recorded = result?.verifierResults?.find((entry) => entry.verifier === verifierId);
    if (!recorded) {
      return { ok: false, verifier: verifierId, error: 'verifier_result_missing', resultPath: patch.metadata?.resultPath || null };
    }
    return {
      ok: recorded.ok !== false,
      verifier: verifierId,
      command: recorded.command || null,
      durationMs: recorded.durationMs || 0,
      stdout: recorded.stdout || '',
      stderr: recorded.stderr || '',
      metadata: recorded.metadata || null,
      parsedOutputSummary: recorded.parsedOutputSummary || recorded.metadata?.parsedOutputSummary || null,
      skipped: recorded.skipped === true,
      reason: recorded.reason || null,
      resultPath: patch.metadata?.resultPath || null
    };
  }]));
}

function computePeakConcurrency(events = []) {
  let active = 0;
  let peak = 0;
  for (const event of events) {
    if (event.type === 'live_worker_spawned' || event.type === 'live_worker_respawned') {
      active += 1;
      peak = Math.max(peak, active);
    } else if (event.type === 'live_worker_exit') {
      active = Math.max(0, active - 1);
    }
  }
  return peak;
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidate = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') || line.startsWith('[')) || raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeMedian(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function nonNegativeNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function deriveMeaningfulProgressEvidence({ contract, liveRun }) {
  const benchmarkStartAt = (() => {
    const firstWorkerSpawn = (liveRun.workerEvents || []).find((event) => event.type === 'live_worker_spawned');
    return parseIsoDate(firstWorkerSpawn?.at) || parseIsoDate(contract.generatedAt) || null;
  })();
  const mergedByShard = new Map((liveRun.patchQueue?.merged || []).map((entry) => [entry.shardId, entry]));
  const surfaces = (contract.scope?.surfaces || []).map((surface) => {
    const merged = mergedByShard.get(surface.id) || null;
    const result = merged?.metadata?.resultPath ? readJson(merged.metadata.resultPath, null) : null;
    const verifierResults = Array.isArray(result?.verifierResults) ? result.verifierResults : [];
    let firstMeaningfulProgressAt = null;
    const considerTimestamp = (candidate) => {
      if (!candidate) return;
      firstMeaningfulProgressAt = !firstMeaningfulProgressAt || candidate < firstMeaningfulProgressAt
        ? candidate
        : firstMeaningfulProgressAt;
    };

    const implementation = result?.implementation && typeof result.implementation === 'object'
      ? result.implementation
      : null;
    if (implementation && implementation.ok !== false && ((implementation.modifiedFiles || []).length > 0 || implementation.diff)) {
      const implementationMetadata = implementation.metadata && typeof implementation.metadata === 'object'
        ? implementation.metadata
        : {};
      considerTimestamp(
        parseIsoDate(implementation.firstMeaningfulProgressAt)
        || parseIsoDate(implementationMetadata.firstMeaningfulProgressAt)
        || parseIsoDate(implementationMetadata.generatedAt)
      );
      const implementationStartedAt = parseIsoDate(implementation.startedAt)
        || parseIsoDate(result?.startedAt)
        || parseIsoDate(merged?.createdAt)
        || parseIsoDate(merged?.metadata?.createdAt);
      const implementationFirstMeaningfulProgressMs = nonNegativeNumberOrNull(implementation.firstMeaningfulProgressMs)
        ?? nonNegativeNumberOrNull(implementationMetadata.firstMeaningfulProgressMs);
      if (implementationStartedAt && implementationFirstMeaningfulProgressMs != null) {
        considerTimestamp(new Date(implementationStartedAt.getTime() + implementationFirstMeaningfulProgressMs));
      }
    }

    for (const verifierResult of verifierResults) {
      const metadata = verifierResult?.metadata && typeof verifierResult.metadata === 'object'
        ? verifierResult.metadata
        : {};
      const parsedStdout = parseJsonFromText(verifierResult?.stdout || '');
      const directTimestamp = parseIsoDate(verifierResult?.firstMeaningfulProgressAt)
        || parseIsoDate(metadata.firstMeaningfulProgressAt)
        || parseIsoDate(parsedStdout?.firstMeaningfulProgressAt);
      if (directTimestamp) {
        considerTimestamp(directTimestamp);
        continue;
      }

      const startedAt = parseIsoDate(verifierResult?.startedAt)
        || parseIsoDate(metadata.startedAt)
        || parseIsoDate(parsedStdout?.startedAt);
      const firstMeaningfulProgressMs = nonNegativeNumberOrNull(verifierResult?.firstMeaningfulProgressMs)
        ?? nonNegativeNumberOrNull(metadata.firstMeaningfulProgressMs)
        ?? nonNegativeNumberOrNull(parsedStdout?.firstMeaningfulProgressMs);
      if (startedAt && firstMeaningfulProgressMs != null) {
        considerTimestamp(new Date(startedAt.getTime() + firstMeaningfulProgressMs));
      }
    }

    const minutesFromBenchmarkStart = benchmarkStartAt && firstMeaningfulProgressAt
      ? Number((((firstMeaningfulProgressAt.getTime() - benchmarkStartAt.getTime()) / 60000)).toFixed(2))
      : null;
    return {
      surfaceId: surface.id,
      resultPath: merged?.metadata?.resultPath || null,
      firstMeaningfulProgressAt: firstMeaningfulProgressAt?.toISOString() || null,
      minutesFromBenchmarkStart
    };
  });

  const measuredMinutes = surfaces
    .map((surface) => surface.minutesFromBenchmarkStart)
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    benchmarkStartedAt: benchmarkStartAt?.toISOString() || null,
    measuredSurfaceCount: measuredMinutes.length,
    missingSurfaceCount: surfaces.length - measuredMinutes.length,
    medianMinutesToMeaningfulProgress: computeMedian(measuredMinutes),
    surfaces
  };
}


function deriveCreativeWorkerEvidence({ contract, liveRun }) {
  const required = contract.scope?.creativeProductWork?.required === true || contract.scope?.productDiffMode === 'creative_product_work';
  const policy = contract.scope?.creativeProductWork || {};
  const minIterations = Math.max(1, Number(process.env.CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE || policy.minIterations || 3));
  const minWorkerRuntimeOverride = Number(process.env.CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE);
  const minWorkerRuntimeMs = Number.isFinite(minWorkerRuntimeOverride) && minWorkerRuntimeOverride >= 0
    ? minWorkerRuntimeOverride
    : Math.max(0, Number(policy.minWorkerRuntimeMs || 0));
  const mergedByShard = new Map((liveRun.patchQueue?.merged || []).map((entry) => [entry.shardId, entry]));
  const surfaces = (contract.scope?.surfaces || []).map((surface) => {
    const merged = mergedByShard.get(surface.id) || null;
    const result = merged?.metadata?.resultPath ? readJson(merged.metadata.resultPath, null) : null;
    const evidence = result?.implementation?.metadata?.creativeWorkerEvidence || merged?.metadata?.implementation?.metadata?.creativeWorkerEvidence || null;
    const creativeWorkerRuntimeMs = Number(evidence?.creativeWorkerRuntimeMs || 0);
    const creativeWorkerMinutes = Number(evidence?.creativeWorkerMinutes ?? (creativeWorkerRuntimeMs / 60000));
    const iterationCount = Number(evidence?.iterationCount || 0);
    const productModifiedFiles = Array.isArray(evidence?.productModifiedFiles) ? evidence.productModifiedFiles : [];
    const failureReasons = Array.isArray(evidence?.failureReasons) ? evidence.failureReasons : [];
    const commandConfigured = evidence?.commandConfigured === true;
    const evidencePresent = evidence?.evidencePresent === true;
    const runtimeOk = minWorkerRuntimeMs <= 0 || creativeWorkerRuntimeMs >= minWorkerRuntimeMs;
    const iterationsOk = iterationCount >= minIterations;
    const productDeltaOk = productModifiedFiles.length > 0;
    const templateOk = evidence?.genericShimPattern !== true && !failureReasons.includes('creative_worker_generic_semantic_shim_detected');
    const ok = Boolean(merged && evidence?.ok === true && commandConfigured && evidencePresent && runtimeOk && iterationsOk && productDeltaOk && templateOk);
    return {
      surfaceId: surface.id,
      resultPath: merged?.metadata?.resultPath || null,
      ok,
      commandConfigured,
      evidencePresent,
      creativeWorkerRuntimeMs,
      creativeWorkerMinutes: Number.isFinite(creativeWorkerMinutes) ? Number(creativeWorkerMinutes.toFixed(3)) : null,
      minWorkerRuntimeMs,
      runtimeOk,
      iterationCount,
      minIterations,
      iterationsOk,
      productModifiedFiles,
      productDeltaOk,
      templateOk,
      failureReasons,
      evidenceSummary: evidence?.evidenceSummary || null
    };
  });
  const requiredCount = surfaces.length;
  const okCount = surfaces.filter((entry) => entry.ok).length;
  const minutes = surfaces.map((entry) => entry.creativeWorkerMinutes).filter((value) => Number.isFinite(value));
  const iterationOkCount = surfaces.filter((entry) => entry.iterationsOk).length;
  const productDeltaOkCount = surfaces.filter((entry) => entry.productDeltaOk).length;
  const templateFailCount = surfaces.filter((entry) => !entry.templateOk).length;
  return {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    required,
    policy: { minIterations, minWorkerRuntimeMs },
    surfaceCount: requiredCount,
    okSurfaceCount: okCount,
    missingOrFailedSurfaceCount: requiredCount - okCount,
    creativeWorkerEvidenceIntegrity: requiredCount > 0 ? Number((okCount / requiredCount).toFixed(2)) : required ? 0 : 1,
    creativeIterationIntegrity: requiredCount > 0 ? Number((iterationOkCount / requiredCount).toFixed(2)) : required ? 0 : 1,
    creativeProductDeltaIntegrity: requiredCount > 0 ? Number((productDeltaOkCount / requiredCount).toFixed(2)) : required ? 0 : 1,
    templateFallbackRate: requiredCount > 0 ? Number((templateFailCount / requiredCount).toFixed(2)) : 0,
    minCreativeWorkerMinutes: minutes.length ? Number(Math.min(...minutes).toFixed(3)) : null,
    medianCreativeWorkerMinutes: computeMedian(minutes),
    surfaces
  };
}

function deriveTransferEvidence({ contract, liveRun }) {
  const declaredSurfaces = contract.scope?.surfaces || [];
  const requiresRealProductDiffs = contract.scope?.requireRealProductDiffs !== false
    && contract.benchmarkClass !== 'verification_orchestration';
  const requireSemanticProductAdmission = semanticProductAdmissionRequired(contract.scope || {});
  const mergedByShard = new Map((liveRun.patchQueue?.merged || []).map((entry) => [entry.shardId, entry]));
  const rejectedByShard = new Map((liveRun.patchQueue?.rejected || []).map((entry) => [entry.shardId, entry]));
  const surfaceEvidence = declaredSurfaces.map((surface) => {
    const merged = mergedByShard.get(surface.id) || null;
    const rejected = rejectedByShard.get(surface.id) || null;
    const result = merged?.metadata?.resultPath ? readJson(merged.metadata.resultPath, null) : null;
    const verifierResults = Array.isArray(result?.verifierResults) ? result.verifierResults : [];
    const verifierEvidence = verifierResults.map((entry) => {
      const parsedOutput = parseJsonFromText(entry.stdout || '');
      return {
        verifier: entry.verifier || null,
        ok: entry.ok !== false,
        skipped: entry.skipped === true,
        parsedOk: parsedOutput?.ok !== false,
        parsedOutput
      };
    });
    const hasRealFiles = Array.isArray(merged?.filePaths) && merged.filePaths.length > 0;
    const landingRecord = merged?.canonicalLandingRecord || merged?.admissionAudit?.canonicalLandingRecord || null;
    const landedProductDiff = !requiresRealProductDiffs
      || (landingRecord ? landingRecord.eligible === true : hasRealFiles);
    const semanticAdmission = merged?.admissionAudit?.semanticProductAdmission || null;
    const architectureAdmission = merged?.admissionAudit?.architectureAdmission || null;
    const semanticProductAdmitted = !requireSemanticProductAdmission
      || Boolean((semanticAdmission?.required === true && semanticAdmission?.ok !== false)
        || (architectureAdmission?.required === true && architectureAdmission?.ok !== false));
    const allVerifierEvidenceGreen = verifierEvidence.length > 0 && verifierEvidence.every((entry) => entry.ok && !entry.skipped && entry.parsedOk);
    const verified = Boolean(merged && allVerifierEvidenceGreen);
    const productive = Boolean(verified && landedProductDiff && semanticProductAdmitted);
    return {
      surfaceId: surface.id,
      label: surface.label,
      merged: Boolean(merged),
      rejected: Boolean(rejected),
      rejectionCategory: rejected?.rejectionCategory || null,
      rejectionReason: rejected?.rejectionReason || null,
      hasRealFiles,
      landedProductDiff,
      canonicalLandingStatus: landingRecord?.status || null,
      canonicalLandingFailures: landingRecord?.failures || [],
      landedProductFiles: landingRecord?.landedProductFiles || [],
      verifierCount: verifierEvidence.length,
      verified,
      productive,
      productivityMode: requireSemanticProductAdmission ? 'requires_semantic_product_admission' : requiresRealProductDiffs ? 'requires_real_product_diff' : 'verification_orchestration',
      semanticProductAdmissionRequired: requireSemanticProductAdmission,
      semanticProductAdmitted,
      semanticAdmission,
      architectureAdmission,
      resultPath: merged?.metadata?.resultPath || rejected?.metadata?.resultPath || null,
      verifiers: verifierEvidence
    };
  });

  const verifiedSurfaceCount = surfaceEvidence.filter((entry) => entry.verified).length;
  const productiveSurfaceCount = surfaceEvidence.filter((entry) => entry.productive).length;
  const totalSurfaceCount = surfaceEvidence.length;
  return {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requiresRealProductDiffs,
    requiresSemanticProductAdmission: requireSemanticProductAdmission,
    totalSurfaceCount,
    verifiedSurfaceCount,
    productiveSurfaceCount,
    semanticAdmittedSurfaceCount: surfaceEvidence.filter((entry) => entry.semanticProductAdmitted).length,
    verificationScore: totalSurfaceCount > 0 ? Number((verifiedSurfaceCount / totalSurfaceCount).toFixed(2)) : null,
    transferScore: totalSurfaceCount > 0 ? Number((productiveSurfaceCount / totalSurfaceCount).toFixed(2)) : null,
    landingEvidenceSummary: liveRun.patchQueue?.landingEvidence?.summary || liveRun.landingEvidence?.summary || null,
    surfaces: surfaceEvidence
  };
}

function summarizeSurfaceStatuses(surfaceMatrix, liveRun) {
  const merged = new Set((liveRun.patchQueue?.merged || []).map((entry) => entry.shardId));
  const rejected = new Map((liveRun.patchQueue?.rejected || []).map((entry) => [entry.shardId, entry]));
  return {
    ...surfaceMatrix,
    generatedAt: new Date().toISOString(),
    status: merged.size === (surfaceMatrix.surfaces || []).length ? 'orchestrator_green' : 'blocked',
    surfaces: (surfaceMatrix.surfaces || []).map((surface) => ({
      ...surface,
      status: merged.has(surface.id) ? 'verified' : rejected.has(surface.id) ? 'rejected' : 'unverified',
      merged: merged.has(surface.id),
      rejectionCategory: rejected.get(surface.id)?.rejectionCategory || null,
      rejectionReason: rejected.get(surface.id)?.rejectionReason || null
    }))
  };
}

function collectTruthContradictions({ liveRun, shardCount, mergedShardCount }) {
  const contradictions = [];
  const supervisorStatus = liveRun.supervisor?.topLevel?.status || 'red';
  const counts = liveRun.supervisor?.topLevel?.counts || {};
  const incompleteCount = Number(counts.ready || 0) + Number(counts.pending || 0) + Number(counts.in_progress || 0) + Number(counts.blocked || 0);
  const completeCount = Number(counts.complete || 0);

  if (supervisorStatus === 'green' && (mergedShardCount !== shardCount || incompleteCount > 0 || completeCount !== shardCount)) {
    contradictions.push({
      type: 'supervisor_green_with_unfinished_shards',
      supervisorStatus,
      shardCount,
      mergedShardCount,
      counts
    });
  }

  return contradictions;
}

const contractPath = path.resolve(process.argv[2] || '');
if (!contractPath || !fs.existsSync(contractPath)) usage();

const contract = readJson(contractPath);
const artifactRoot = path.resolve(contract.artifactRoot);
const scoreboardPath = path.resolve(contract.scoreboardPath);
const surfaceMatrixPath = path.join(artifactRoot, 'surface_matrix.json');
const surfaceMatrix = readJson(surfaceMatrixPath, { surfaces: [] });
const orchestratorRunRoot = path.join(artifactRoot, 'orchestrator_run');
const previousCompletion = readJson(path.join(artifactRoot, 'completion_summary.json'), {});
const previousBaselineReady = previousCompletion?.baselineReady ?? null;
const { verifierCatalog, workGraph } = buildTransferPlan(contract);
const verifierIds = Object.keys(verifierCatalog);
const canonicalLandingEvidenceRequired = Boolean(contract.scope?.productDiffMode || semanticProductAdmissionRequired(contract.scope || {}) || contract.scope?.canonicalLandingEvidence?.enabled === true);
const proofCarryingClaimsRequired = Boolean(contract.scope?.proofCarryingClaims?.enabled === true || contract.scope?.claimLedger?.enabled === true);
const claimLedgerPolicy = {
  ...(contract.scope?.claimLedger || {}),
  ...(contract.scope?.proofCarryingClaims || {}),
  mode: contract.scope?.claimLedger?.mode
    || contract.scope?.proofCarryingClaims?.mode
    || (proofCarryingClaimsRequired ? 'require_adversarial_survival' : 'off')
};
const canonicalLandingProductPaths = [...new Set((contract.scope?.surfaces || []).flatMap((surface) => productSurfaceFiles(surface)).filter(Boolean))].sort();
const maxRuntimeMs = resolveBenchmarkMaxRuntimeMs({ scope: contract.scope, env: process.env });
const leaseTtlMs = resolveBenchmarkLeaseTtlMs({ scope: contract.scope, env: process.env, maxRuntimeMs });
const workerTimeoutMs = resolveBenchmarkWorkerTimeoutMs({ scope: contract.scope, env: process.env, maxRuntimeMs });
const hostRole = process.env.BENCHMARK_HOST_ROLE || process.env.HOST_ROLE || 'control_plane';
const hostname = process.env.HOSTNAME || null;

if (contract.executionBoundary === 'remote_execution_required' && hostRole !== 'execution_plane') {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'boundary_preflight',
    status: 'blocked',
    blocker: 'This orchestrator benchmark requires execution on the execution plane, but it was launched from a control-plane host.',
    nextAction: 'Run the orchestrator benchmark on VM102 with BENCHMARK_HOST_ROLE=execution_plane, while CT101 remains the supervisor/notifier control plane.',
    observedHostRole: hostRole,
    observedHostname: hostname,
    requiredHostRole: 'execution_plane'
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'blocked',
    done: true,
    stopAllowed: true,
    stopReason: 'execution_boundary_blocked',
    summary: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requestedAgentCount: contract.requestedAgentCount,
    mechanicalGreen: false,
    scaleProofReady: false,
    thresholdPass: false,
    blockedByBoundary: true,
    hostRole,
    hostname
  });
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'boundary_preflight_blocked',
    mechanicalGreen: false,
    scaleProofReady: false,
    blocker,
    note: blocker.blocker
  });
  const scoreboardRow = createScoreboardRow({
    contract,
    metrics: {
      verificationIntegrity: previousBaselineReady ? 1 : 0,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0
    },
    outcome: { pass: false },
    durationMinutes: 0,
    blockerFamily: 'execution_boundary_missing',
    blockerSemantics: 'blocking',
    notes: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'scoreboard_row.json'), scoreboardRow);
  upsertBenchmarkScoreboardRow({ scoreboardPath, row: scoreboardRow });
  console.log(JSON.stringify({ ok: false, blocker: blocker.blocker, hostRole, hostname }, null, 2));
  process.exit(2);
}

if (!workGraph.workUnits.length || !verifierIds.length) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    blocker: 'Transfer benchmark contract has no runnable surfaces/verifiers.',
    nextAction: 'Add at least one surface with at least one verification command, then rerun the orchestrator benchmark.'
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'transfer_orchestrator_live_worker_farm',
    blocker,
    note: blocker.blocker
  });
  console.log(JSON.stringify({ ok: false, blocker: blocker.blocker }, null, 2));
  process.exit(2);
}

let liveRun;
try {
  if (process.env.TRANSFER_BENCHMARK_TEST_FORCE_CRASH === '1') {
    throw new Error('Forced orchestrator benchmark crash for test coverage.');
  }
  liveRun = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: Math.max(1, Number(contract.requestedAgentCount || 1)),
    workerScriptPath: path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), 'live-transfer-worker.mjs')),
    verifierScriptPath: path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), 'live-transfer-verifier.mjs')),
    workspacePath: path.resolve(contract.repoPath),
    runRoot: orchestratorRunRoot,
    maxRuntimeMs,
    leaseTtlMs,
    workerTimeoutMs,
    workerWorkspaceCopyPaths: stableList(String(process.env.ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)),
    plannerOptions: {
      maxFileAreasPerShard: 16,
      maxFilesPerShard: 16,
      maxAcceptanceChecksPerShard: 16
    },
    globalInputs: {
      verifierCatalog,
      productDiffMode: contract.scope?.productDiffMode || null,
      semanticProductAdmission: {
        required: semanticProductAdmissionRequired(contract.scope || {}),
        mode: contract.scope?.semanticProductAdmission?.mode || null,
        requireRuntimeExecution: contract.scope?.semanticProductAdmission?.requireRuntimeExecution === true,
        requireExistingProductCall: contract.scope?.semanticProductAdmission?.requireExistingProductCall === true,
        requireNormalFlowIntegration: contract.scope?.semanticProductAdmission?.requireNormalFlowIntegration === true,
        requireExistingProductNormalFlow: contract.scope?.semanticProductAdmission?.requireExistingProductNormalFlow === true,
        requireApiProbeWhenAvailable: contract.scope?.semanticProductAdmission?.requireApiProbeWhenAvailable === true,
        rejectGenericSemanticShim: contract.scope?.semanticProductAdmission?.rejectGenericSemanticShim === true
      },
      creativeProductWork: {
        ...(contract.scope?.creativeProductWork || {}),
        required: contract.scope?.creativeProductWork?.required === true || contract.scope?.productDiffMode === 'creative_product_work'
      }
    },
    verifyFns: createResultBackedVerifierMap(verifierIds),
    executionMode: 'transfer_orchestrator_live_worker_farm',
    failureInjections: Array.isArray(contract.scope?.failureInjections) ? contract.scope.failureInjections : [],
    canonicalLandingEvidence: canonicalLandingEvidenceRequired,
    landingEvidencePolicy: {
      mode: contract.scope?.canonicalLandingEvidence?.mode || (canonicalLandingEvidenceRequired ? 'block_on_failed_landing' : 'off'),
      productPaths: canonicalLandingProductPaths,
      duplicateLineRatioMax: contract.scope?.canonicalLandingEvidence?.duplicateLineRatioMax,
      duplicateLineCheckMinAddedLines: contract.scope?.canonicalLandingEvidence?.duplicateLineCheckMinAddedLines,
      minAddedLineCount: contract.scope?.canonicalLandingEvidence?.minAddedLineCount,
      minUniqueNormalizedAddedLineCount: contract.scope?.canonicalLandingEvidence?.minUniqueNormalizedAddedLineCount
    },
    proofCarryingClaims: proofCarryingClaimsRequired,
    claimLedgerPolicy,
    campaignContract: {
      fidelity: contract.fidelity,
      requestedScope: (contract.scope?.surfaces || []).map((surface) => surface.id),
      repoPath: contract.repoPath,
      targetPath: contract.repoPath
    }
  });
} catch (error) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    blocker: 'The orchestrated transfer run crashed before it could finalize benchmark artifacts.',
    nextAction: 'Inspect orchestrator_run logs and crash details, repair the execution failure, then rerun the orchestrator benchmark.',
    crash: {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 12) : []
    }
  };

  writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requestedAgentCount: contract.requestedAgentCount,
    mechanicalGreen: false,
    scaleProofReady: false,
    thresholdPass: false,
    crashed: true,
    crashMessage: blocker.crash.message,
    liveRunSummaryPath: path.join(orchestratorRunRoot, 'summary.json')
  });
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'blocked',
    done: true,
    stopAllowed: true,
    stopReason: 'runner_crash_blocker_report_written',
    summary: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'notifier_eligibility.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    eligible: true,
    kind: 'blocker',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'transfer_orchestrator_live_worker_farm',
    mechanicalGreen: false,
    scaleProofReady: false,
    blocker,
    note: blocker.blocker
  });

  console.log(JSON.stringify({
    ok: false,
    crashed: true,
    artifactRoot,
    runRoot: orchestratorRunRoot,
    blocker
  }, null, 2));
  process.exit(1);
}

const shardCount = liveRun.shardPlan?.shards?.length || 0;
const mergedShardCount = liveRun.patchQueue?.merged?.length || 0;
const durationEvidence = deriveBenchmarkAutonomyMetrics({ elapsedMs: liveRun.summary?.elapsedMs || 0, scope: contract.scope });
const elapsedMinutes = durationEvidence.elapsedMinutes;
const mechanicalGreen = Boolean(liveRun.ok && liveRun.supervisor?.topLevel?.status === 'green' && mergedShardCount === shardCount);
const truthContradictions = collectTruthContradictions({ liveRun, shardCount, mergedShardCount });
const transferEvidence = deriveTransferEvidence({ contract, liveRun });
const meaningfulProgressEvidence = deriveMeaningfulProgressEvidence({ contract, liveRun });
const creativeWorkerEvidence = deriveCreativeWorkerEvidence({ contract, liveRun });
const productiveSurfaceCount = Number(transferEvidence.productiveSurfaceCount || 0);
const verifiedSurfaceCount = Number(transferEvidence.verifiedSurfaceCount || 0);
const claimLedger = liveRun.claimLedger || liveRun.patchQueue?.claimLedger || liveRun.supervisor?.claimLedger || null;
const claimLedgerSummary = claimLedger?.summary || null;
const claimLedgerPass = !proofCarryingClaimsRequired
  || (claimLedgerSummary?.status === 'green'
    && Number(claimLedgerSummary?.claimCount || 0) >= mergedShardCount
    && Number(claimLedgerSummary?.survivedCount || 0) >= mergedShardCount
    && Number(claimLedgerSummary?.counterclaimedCount || 0) === 0);
const concurrencyTruth = liveRun.schedulerTruth?.concurrencyTruth || deriveObservedConcurrencyTruth({
  workerEvents: liveRun.workerEvents || [],
  shardPlan: liveRun.shardPlan || {},
  patchQueue: liveRun.patchQueue || {},
  requestedAgentCount: contract.requestedAgentCount,
  productiveMergedPatchCount: productiveSurfaceCount
});
const scaleCredit = evaluateScaleCredit({
  concurrencyTruth,
  requestedAgentCount: contract.requestedAgentCount,
  productiveMergedPatchCount: productiveSurfaceCount,
  shardCount,
  requireProductiveMerges: transferEvidence.requiresRealProductDiffs
});
const peakConcurrency = concurrencyTruth.peakConcurrentWorkers;
const scaleProofReady = scaleCredit.eligible;
const metrics = {
  productiveIterationRate: shardCount > 0 ? Number((productiveSurfaceCount / shardCount).toFixed(2)) : null,
  noOpRate: shardCount > 0 ? Number((((shardCount - productiveSurfaceCount) / shardCount)).toFixed(2)) : null,
  repeatBlockerRate: shardCount > 0 ? Number((((liveRun.metrics?.failedShards?.length || 0) / shardCount)).toFixed(2)) : null,
  medianMinutesToMeaningfulProgress: meaningfulProgressEvidence.medianMinutesToMeaningfulProgress,
  verificationIntegrity: mergedShardCount > 0 ? Number((verifiedSurfaceCount / mergedShardCount).toFixed(2)) : 0,
  handoffEfficiency: shardCount > 0 ? Number((mergedShardCount / shardCount).toFixed(2)) : null,
  activeWorkerMinutes: concurrencyTruth.activeWorkerMinutes,
  medianTimeToNextAssignmentMs: concurrencyTruth.medianTimeToNextAssignmentMs,
  longestIdleGapMs: concurrencyTruth.longestIdleGapMs,
  autonomyWindowMinutes: durationEvidence.autonomyWindowMinutes,
  truthIntegrityContradictions: truthContradictions.length,
  fakeGreenIncidents: truthContradictions.filter((entry) => entry.type === 'supervisor_green_with_unfinished_shards').length,
  transferScore: transferEvidence.transferScore,
  claimLedgerRequired: proofCarryingClaimsRequired,
  claimLedgerClaimCount: Number(claimLedgerSummary?.claimCount || 0),
  claimLedgerSurvivedCount: Number(claimLedgerSummary?.survivedCount || 0),
  claimLedgerCounterclaimedCount: Number(claimLedgerSummary?.counterclaimedCount || 0),
  claimLedgerSurvivalRate: Number(claimLedgerSummary?.survivalRate ?? (proofCarryingClaimsRequired ? 0 : 1)),
  creativeWorkerEvidenceIntegrity: creativeWorkerEvidence.required ? creativeWorkerEvidence.creativeWorkerEvidenceIntegrity : 1,
  creativeIterationIntegrity: creativeWorkerEvidence.required ? creativeWorkerEvidence.creativeIterationIntegrity : 1,
  creativeProductDeltaIntegrity: creativeWorkerEvidence.required ? creativeWorkerEvidence.creativeProductDeltaIntegrity : 1,
  templateFallbackRate: creativeWorkerEvidence.required ? creativeWorkerEvidence.templateFallbackRate : 0,
  minCreativeWorkerMinutes: creativeWorkerEvidence.required ? creativeWorkerEvidence.minCreativeWorkerMinutes : null,
  medianCreativeWorkerMinutes: creativeWorkerEvidence.required ? creativeWorkerEvidence.medianCreativeWorkerMinutes : null
};
const thresholdEvaluation = evaluateBenchmarkThresholds({
  benchmarkTier: contract.benchmarkTier,
  metrics
});
const thresholdPass = mechanicalGreen && scaleProofReady && claimLedgerPass && thresholdEvaluation.ok;

let blocker = null;
let blockerFamily = null;
let blockerSemantics = 'none';
if (!mechanicalGreen) {
  blockerFamily = 'orchestrator_failure';
  blockerSemantics = 'blocking';
  blocker = {
    blocker: 'The orchestrated transfer run did not reach a green supervisor outcome.',
    nextAction: 'Inspect orchestrator_run artifacts, repair failed verifier or patch admission issues, then rerun the orchestrator benchmark.'
  };
} else if (!scaleProofReady) {
  const productiveFailure = scaleCredit.failures.some((failure) => failure.reason === 'insufficient_productive_merges');
  blockerFamily = productiveFailure ? 'unproductive_scale_credit' : 'insufficient_parallel_surface_inventory';
  blockerSemantics = productiveFailure ? 'productivity_gap' : 'scope_limited';
  blocker = {
    blocker: productiveFailure
      ? `The orchestrator run was mechanically green, but scale credit is blocked because only ${productiveSurfaceCount} productive landed product surface(s) were proven for requested ${contract.requestedAgentCount}-agent scale.`
      : `The orchestrator run was mechanically green, but it only produced ${shardCount} runnable shard(s) and peak concurrency ${peakConcurrency} for a requested ${contract.requestedAgentCount}-agent benchmark.`,
    nextAction: productiveFailure
      ? 'Require canonical landing evidence/productive product diffs for selected-run work, then rerun with enough productive surfaces to match the requested tier.'
      : `Either expand the surface matrix to at least ${contract.requestedAgentCount} independently verifiable low-overlap surfaces/shards or lower requestedAgentCount to the observed benchmarkable scale.`,
    scaleCredit
  };
} else if (!claimLedgerPass) {
  blockerFamily = 'claim_ledger_integrity_gap';
  blockerSemantics = 'claim_integrity';
  blocker = {
    blocker: `The orchestrator run was mechanically green and scale-proven, but proof-carrying claim ledger credit is not green (${claimLedgerSummary?.status || 'missing'}).`,
    nextAction: 'Require every merged product patch to carry a surviving proof claim and adversarial challenge result before allowing threshold-pass credit.',
    claimLedgerSummary,
    requiredClaimCount: mergedShardCount
  };
} else if (!thresholdEvaluation.ok) {
  blockerFamily = 'benchmark_thresholds_unmet';
  blockerSemantics = 'evidence_or_endurance_gap';
  const durationTargetNote = durationEvidence.endedBeforeDurationTarget
    ? `The runnable work graph exhausted in ${elapsedMinutes} minute(s), below the contract duration target of ${durationEvidence.durationTargetMinutes} minute(s).`
    : null;
  blocker = {
    blocker: `The orchestrator run was mechanically green and scale-proven, but it did not satisfy the ${contract.benchmarkTier} benchmark thresholds.`,
    nextAction: durationEvidence.endedBeforeDurationTarget
      ? 'Use or build a benchmark preset that can sustain productive work through the declared duration target, then rerun the benchmark.'
      : 'Address the missing endurance/evidence gaps called out in threshold_evaluation.json, then rerun the benchmark.',
    durationTarget: {
      durationTargetMinutes: durationEvidence.durationTargetMinutes,
      elapsedMinutes,
      durationTargetMet: durationEvidence.durationTargetMet,
      durationTargetGapMinutes: durationEvidence.durationTargetGapMinutes,
      endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget,
      note: durationTargetNote
    },
    thresholdFailures: thresholdEvaluation.failures
  };
}

const updatedSurfaceMatrix = summarizeSurfaceStatuses(surfaceMatrix, liveRun);
const runStateTruth = reduceRunState({
  programState: { running: false, done: true, stopAllowed: true, status: thresholdPass ? 'passed' : blocker ? 'blocked' : 'completed' },
  workerFarmStatus: { running: false, ok: liveRun.ok, generatedAt: liveRun.summary?.generatedAt, updatedAt: liveRun.summary?.generatedAt },
  supervisorStatus: liveRun.supervisor,
  thresholdEvaluation: { thresholdPass, mechanicalGreen, scaleProofReady, metrics },
  surfaceMatrix: updatedSurfaceMatrix,
  claimLedger,
  completionSummary: { thresholdPass, mechanicalGreen, scaleProofReady, blocker },
  blocker,
  requestedFidelity: contract.fidelity,
  contract
});
writeJson(surfaceMatrixPath, updatedSurfaceMatrix);
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  mechanicalGreen,
  scaleProofReady,
  scaleCredit,
  concurrencyTruth,
  runStateTruth,
  claimLedgerSummary,
  thresholdPass,
  durationTarget: {
    durationTargetMinutes: durationEvidence.durationTargetMinutes,
    elapsedMinutes,
    durationTargetMet: durationEvidence.durationTargetMet,
    durationTargetGapMinutes: durationEvidence.durationTargetGapMinutes,
    endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget
  },
  meaningfulProgressEvidence,
  metrics,
  ...thresholdEvaluation
});
writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  shardCount,
  mergedShardCount,
  requestedAgentCount: contract.requestedAgentCount,
  peakConcurrency,
  durationTargetMinutes: durationEvidence.durationTargetMinutes,
  elapsedMinutes,
  maxRuntimeMs,
  workerTimeoutMs,
  leaseTtlMs,
  durationTargetMet: durationEvidence.durationTargetMet,
  endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget,
  mechanicalGreen,
  scaleProofReady,
  scaleCredit,
  concurrencyTruth,
  runStateTruth,
  transferScore: metrics.transferScore,
  thresholdPass,
  landingEvidenceSummary: liveRun.landingEvidence?.summary || null,
  claimLedgerSummary,
  thresholdFailures: thresholdEvaluation.failures,
  liveRunSummaryPath: path.join(orchestratorRunRoot, 'summary.json')
});

writeJson(path.join(artifactRoot, 'iteration_ledger.json'), (liveRun.workerEvents || []).map((event, index) => ({ index: index + 1, ...event })));
writeJson(path.join(artifactRoot, 'intervention_log.json'), []);
if (liveRun.landingEvidence) writeJson(path.join(artifactRoot, 'landing_evidence.json'), liveRun.landingEvidence);
if (claimLedger) writeJson(path.join(artifactRoot, 'claim_ledger.json'), claimLedger);
writeJson(path.join(artifactRoot, 'scheduler_truth.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  schedulerTruth: liveRun.schedulerTruth || null,
  concurrencyTruth,
  scaleCredit
});
writeJson(path.join(artifactRoot, 'run_state_truth.json'), runStateTruth);
writeJson(path.join(artifactRoot, 'transfer_evidence.json'), transferEvidence);
writeJson(path.join(artifactRoot, 'meaningful_progress_evidence.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  ...meaningfulProgressEvidence
});
writeJson(path.join(artifactRoot, 'creative_worker_evidence.json'), creativeWorkerEvidence);
writeJson(path.join(artifactRoot, 'truth_conflicts.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  contradictions: truthContradictions
});
writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  supervisorStatus: liveRun.supervisor?.topLevel?.status || 'red',
  matrixStatus: updatedSurfaceMatrix.status,
  note: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});
writeJson(path.join(artifactRoot, 'program_state.json'), {
  schemaVersion: 'claw.agent_benchmark_program_state.v1',
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  status: thresholdPass ? 'passed' : blocker ? 'blocked' : 'completed',
  done: true,
  stopAllowed: true,
  stopReason: thresholdPass ? 'supervisor_green_scale_proven_and_thresholds_met' : blocker ? 'blocker_report_written' : 'orchestrator_completed',
  summary: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.blocker || 'Orchestrated transfer benchmark completed.'
});
writeJson(path.join(artifactRoot, 'notifier_eligibility.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  eligible: true,
  kind: thresholdPass ? 'completion' : 'blocker',
  note: thresholdPass ? 'Benchmark completed with threshold pass.' : blocker?.blocker || 'Benchmark completed.'
});
if (blocker) {
  writeJson(path.join(artifactRoot, 'blocker_report.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    ...blocker
  });
}

const scoreboardRow = createScoreboardRow({
  contract,
  metrics,
  outcome: {
    pass: thresholdPass,
    mechanicalGreen,
    scaleProofReady,
    thresholdFailures: thresholdEvaluation.failures
  },
  durationMinutes: elapsedMinutes,
  blockerFamily,
  blockerSemantics,
  notes: thresholdPass
    ? `Orchestrated transfer benchmark passed with ${mergedShardCount}/${shardCount} merged shard(s) and peak concurrency ${peakConcurrency}.`
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});
writeJson(path.join(artifactRoot, 'scoreboard_row.json'), scoreboardRow);
const scoreboard = upsertBenchmarkScoreboardRow({ scoreboardPath, row: scoreboardRow });

writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  baselineReady: previousBaselineReady,
  thresholdPass,
  supervisorConfirmedCompletion: mechanicalGreen,
  executionMode: 'transfer_orchestrator_live_worker_farm',
  shardCount,
  mergedShardCount,
  peakConcurrency,
  requestedAgentCount: contract.requestedAgentCount,
  durationMinutes: elapsedMinutes,
  maxRuntimeMs,
  workerTimeoutMs,
  leaseTtlMs,
  mechanicalGreen,
  scaleProofReady,
  scaleCredit,
  concurrencyTruth,
  runStateTruth,
  transferScore: metrics.transferScore,
  landingEvidenceSummary: liveRun.landingEvidence?.summary || null,
  claimLedgerSummary,
  thresholdFailures: thresholdEvaluation.failures,
  blocker,
  note: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});

console.log(JSON.stringify({
  ok: mechanicalGreen,
  thresholdPass,
  shardCount,
  mergedShardCount,
  peakConcurrency,
  thresholdFailures: thresholdEvaluation.failures,
  scoreboardRows: scoreboard.rows.length,
  artifactRoot,
  runRoot: orchestratorRunRoot,
  blocker
}, null, 2));

process.exit(mechanicalGreen ? 0 : 1);
