#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCortexAgentWorkHandoff } from '../../packages/cortex-agent-work-adapter/index.mjs';
import { MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG } from './mailchimp-global-gap-inventory-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_MAILCHIMP_ROOT = path.resolve(STACK_ROOT, '..', 'mailchimp-clone');
const DEFAULT_INVENTORY = path.join(DEFAULT_MAILCHIMP_ROOT, 'docs/MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json');
const CREATIVE_WORKER_SCRIPT = path.join(STACK_ROOT, 'apps/system-benchmark/codex-creative-worker.mjs');

export const MAILCHIMP_SOAK_DEPTH_DIMENSIONS = Object.freeze([
  {
    id: 'integrated_behavior',
    label: 'integrated behavior',
    instruction: 'Implement a real end-to-end behavior for this requirement in the existing domain/route/view flow. Integrate it into reachable product execution; detached helpers, marker exports, and opaque literal payloads do not count.'
  },
  {
    id: 'edge_and_failure_states',
    label: 'edge and failure states',
    instruction: 'Deepen validation, empty/loading/error states, retry behavior, and boundary handling for this requirement. Reuse established product patterns and keep failures explicit and recoverable.'
  },
  {
    id: 'persistence_and_recovery',
    label: 'persistence and recovery',
    instruction: 'Strengthen state transitions, persistence, idempotency, resume/recovery, or durable history for this requirement where applicable. The change must be exercised by the existing product flow, not merely declared.'
  },
  {
    id: 'policy_accessibility_roles',
    label: 'policy, accessibility, and roles',
    instruction: 'Strengthen role-aware authorization, consent/compliance, accessibility, and safe defaults relevant to this requirement. Preserve existing permission boundaries and avoid broad bypasses.'
  },
  {
    id: 'observability_and_insight',
    label: 'observability and insight',
    instruction: 'Add useful product telemetry, audit history, health/insight signals, or operator-visible diagnostics for this requirement. Avoid synthetic counters or evidence that is disconnected from real execution.'
  },
  {
    id: 'cross_surface_workflow',
    label: 'cross-surface workflow continuity',
    instruction: 'Improve continuity between this requirement and an adjacent Mailchimp workflow using the existing architecture. Preserve navigation/state semantics and do not duplicate an existing workflow under a new name.'
  },
  {
    id: 'performance_and_scale',
    label: 'performance and scale behavior',
    instruction: 'Strengthen realistic pagination, bounded queries, batching, caching, concurrency control, or large-account behavior relevant to this requirement. Preserve correctness for small inputs and avoid synthetic benchmark-only fast paths.'
  },
  {
    id: 'api_and_integration_contracts',
    label: 'API and integration contracts',
    instruction: 'Deepen stable API, webhook, provider, or integration contracts relevant to this requirement, including explicit versioning, validation, idempotency, and actionable failures. Integrate through existing adapters rather than inventing a parallel service.'
  },
  {
    id: 'migration_and_compatibility',
    label: 'migration and backward compatibility',
    instruction: 'Handle legacy records, schema evolution, saved-state migration, or backward-compatible defaults relevant to this requirement. Preserve existing persisted data and make recovery deterministic.'
  },
  {
    id: 'workspace_isolation',
    label: 'workspace and tenant isolation',
    instruction: 'Strengthen workspace scoping, tenant isolation, cross-account switching, and ownership checks relevant to this requirement. Prevent accidental cross-workspace reads or writes and verify safe defaults.'
  },
  {
    id: 'localization_and_time',
    label: 'localization, timezone, and date semantics',
    instruction: 'Improve locale, timezone, formatting, scheduling, or date-boundary behavior relevant to this requirement. Keep storage canonical and presentation/user intent explicit.'
  },
  {
    id: 'import_export_portability',
    label: 'import, export, and portability',
    instruction: 'Strengthen import/export, bulk transfer, validation reports, or portable product data relevant to this requirement. Make partial failures explicit and preserve idempotent retries.'
  },
  {
    id: 'admin_and_support_operations',
    label: 'admin and support operations',
    instruction: 'Add safe administrative or support workflows relevant to this requirement, with scoped diagnostics, auditability, and reversible actions. Do not add permission bypasses or hidden production shortcuts.'
  },
  {
    id: 'privacy_and_retention',
    label: 'privacy, consent, and retention',
    instruction: 'Deepen privacy, consent, retention, deletion, or data-minimization semantics relevant to this requirement. Preserve evidence needed for compliance without leaking sensitive fields.'
  },
  {
    id: 'rollout_and_experimentation',
    label: 'rollout and experimentation safety',
    instruction: 'Strengthen feature rollout, experiment assignment, eligibility, safe fallback, or gradual enablement relevant to this requirement. Keep behavior deterministic and auditable.'
  },
  {
    id: 'responsive_interaction',
    label: 'responsive and keyboard interaction',
    instruction: 'Improve responsive, keyboard, focus, screen-reader, or reduced-motion behavior relevant to this requirement in the existing reachable UI flow. Preserve server-side contracts and avoid decorative-only changes.'
  },
  {
    id: 'data_quality_and_deduplication',
    label: 'data quality and deduplication',
    instruction: 'Strengthen normalization, deduplication, conflict resolution, provenance, or data-quality feedback relevant to this requirement. Avoid destructive silent correction and make operator choices explicit.'
  },
  {
    id: 'automation_and_event_hooks',
    label: 'automation and event hooks',
    instruction: 'Integrate this requirement with existing events, jobs, journeys, notifications, or automation hooks where meaningful. Preserve idempotency, bounded retries, and traceable execution.'
  }
]);

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function slug(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function normalizeWorkerCommand(value) {
  const raw = String(value || '').trim();
  if (!raw) return `node ${CREATIVE_WORKER_SCRIPT}`;
  return raw.replace(/^(node\s+)(\.\/)?apps\/system-benchmark\/codex-creative-worker\.mjs(\b)/, `$1${CREATIVE_WORKER_SCRIPT}$3`);
}

function parseArgs(argv) {
  const args = {
    out: null,
    mailchimpRoot: DEFAULT_MAILCHIMP_ROOT,
    inventoryPath: DEFAULT_INVENTORY,
    artifactRoot: null,
    runId: null,
    benchmarkId: 'agent_work_phase8_mailchimp_grounded_soak',
    workerCommand: null,
    executionBoundary: 'remote_execution_required',
    maxWaves: 500,
    maxSurfaces: 1000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root' || token === '--repo' || token === '--repo-path') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--inventory') { args.inventoryPath = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || '').trim(); index += 1; continue; }
    if (token === '--benchmark-id') { args.benchmarkId = String(next || '').trim(); index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = String(next || '').trim(); index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = String(next || '').trim(); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
    if (token === '--max-surfaces') { args.maxSurfaces = Number(next); index += 1; continue; }
  }
  if (!args.out) throw new Error('usage: create-agent-work-mailchimp-soak-workload.mjs --out <dir> [--mailchimp-root <repo>] [--artifact-root <run-root>]');
  return args;
}

function gapCatalogMap() {
  return new Map(MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG.map((entry) => [entry.id, entry]));
}

function validateInventory(inventory) {
  const gaps = Array.isArray(inventory?.gaps) ? inventory.gaps.filter((gap) => gap.requiredForFullClone !== false) : [];
  if (gaps.length < 20) throw new Error(`grounded_inventory_too_narrow:${gaps.length}`);
  const missingRequiredWork = gaps.filter((gap) => !Array.isArray(gap.requiredWork) || gap.requiredWork.length === 0).map((gap) => gap.id);
  if (missingRequiredWork.length) throw new Error(`grounded_inventory_missing_required_work:${missingRequiredWork.join(',')}`);
  return gaps;
}

function verificationCommand(targetedTests) {
  return `node --test --test-concurrency=1 ${targetedTests.join(' ')}`;
}

export function buildMailchimpGroundedSoakWorkload({ inventory, mailchimpRoot, maxSurfaces = 1000 } = {}) {
  const gaps = validateInventory(inventory);
  const catalog = gapCatalogMap();
  const normalized = gaps.map((gap) => {
    const mapped = catalog.get(gap.id);
    const productFiles = stableList([...(gap.candidateAreas || []), ...(mapped?.productFiles || [])])
      .filter((relPath) => fs.existsSync(path.join(mailchimpRoot, relPath)));
    const targetedTests = stableList(mapped?.targetedTests || [])
      .filter((relPath) => fs.existsSync(path.join(mailchimpRoot, relPath)));
    if (!productFiles.length) throw new Error(`grounded_gap_missing_product_files:${gap.id}`);
    if (!targetedTests.length) throw new Error(`grounded_gap_missing_targeted_tests:${gap.id}`);
    return { gap, productFiles, targetedTests };
  });

  const distinctProductFiles = stableList(normalized.flatMap((entry) => entry.productFiles));
  const distinctTargetedTests = stableList(normalized.flatMap((entry) => entry.targetedTests));
  if (distinctProductFiles.length < 12) throw new Error(`grounded_product_file_diversity_too_low:${distinctProductFiles.length}`);

  const coverageSurfaces = normalized.map(({ gap, productFiles, targetedTests }) => ({
    id: `soak_coverage_${slug(gap.id)}`,
    label: `Grounded coverage: ${gap.title}`,
    goal: [
      `Close one coherent, high-value portion of canonical strict-gap surface ${gap.id} (${gap.title}).`,
      gap.detail,
      'Make a real integrated product-code change in the declared product files. Existing behavior must remain compatible, targeted verification must pass, and marker-only/dead-code/bulk-copy growth is forbidden.'
    ].join('\n'),
    files: productFiles,
    verify: [verificationCommand(targetedTests)],
    lane: gap.sourceSurfaceId || gap.id,
    domain: gap.id,
    metadata: {
      phase8CorrectedSoak: true,
      objectiveCoverageSurface: true,
      strictGapId: gap.id,
      canonicalStatus: gap.canonicalStatus || null,
      productFiles,
      targetedTests
    }
  }));

  const depthSurfaces = [];
  for (const dimension of MAILCHIMP_SOAK_DEPTH_DIMENSIONS) {
    const maxRequirements = Math.max(...normalized.map(({ gap }) => gap.requiredWork.length));
    for (let requirementIndex = 0; requirementIndex < maxRequirements; requirementIndex += 1) {
      for (const { gap, productFiles, targetedTests } of normalized) {
        const requiredWork = gap.requiredWork[requirementIndex];
        if (!requiredWork) continue;
        depthSurfaces.push({
          id: `soak_${slug(gap.id)}_req_${String(requirementIndex + 1).padStart(2, '0')}_${dimension.id}`,
          label: `${gap.title} — requirement ${requirementIndex + 1} — ${dimension.label}`,
          goal: [
            `Canonical strict-gap surface: ${gap.id} (${gap.title}).`,
            `Required work: ${requiredWork}`,
            `Depth dimension: ${dimension.instruction}`,
            'Implement the smallest meaningful integrated product improvement that advances this exact requirement and dimension. Inspect current code first and build on it; do not append detached helpers, duplicate prior work, add benchmark markers, or inflate files with repetitive structures. Run the targeted verification before returning.'
          ].join('\n'),
          files: productFiles,
          verify: [verificationCommand(targetedTests)],
          lane: gap.sourceSurfaceId || gap.id,
          domain: gap.id,
          metadata: {
            phase8CorrectedSoak: true,
            objectiveCoverageSurface: false,
            strictGapId: gap.id,
            requiredWorkIndex: requirementIndex,
            depthDimension: dimension.id,
            productFiles,
            targetedTests
          }
        });
      }
    }
  }

  const allSurfaces = [...coverageSurfaces, ...depthSurfaces];
  const limit = Math.max(coverageSurfaces.length, Math.min(allSurfaces.length, Number(maxSurfaces || allSurfaces.length)));
  const surfaces = allSurfaces.slice(0, limit);
  const objectiveMatrix = {
    schemaVersion: 'clawd.agent_work.phase8_mailchimp_soak_surface_matrix.v1',
    generatedAt: new Date().toISOString(),
    status: 'red',
    fidelity: 'parity_for_scope',
    scope: 'canonical_26_gap_mailchimp_product_coverage_for_phase8_soak',
    truthBoundary: 'This matrix gates broad productive soak coverage across the canonical 26-gap inventory. Matrix green is not independent proof of full Mailchimp parity or a full-clone claim.',
    surfaces: normalized.map(({ gap, productFiles, targetedTests }) => ({
      id: `soak_coverage_${slug(gap.id)}`,
      parentSurfaceId: gap.id,
      label: gap.title,
      status: 'red',
      requiredWork: [
        gap.detail,
        `Canonical requirements: ${gap.requiredWork.join(' | ')}`,
        'Acceptance: inspect the existing implementation, make a cohesive reachable product change, preserve current behavior, handle realistic malformed or legacy state, and run every targeted verifier before completion. Detached helpers, benchmark markers, repetitive bulk, and untested happy-path-only changes are not acceptable.',
        `Targeted verification: ${verificationCommand(targetedTests)}`
      ].join('\n'),
      productFiles,
      targetedTests,
      verification: [verificationCommand(targetedTests)],
      blockers: [{ kind: 'phase8_soak_coverage_not_yet_verified', strictGapId: gap.id }]
    }))
  };
  const negativeSpace = {
    schemaVersion: 'clawd.agent_work.phase8_mailchimp_soak_negative_space.v1',
    generatedAt: objectiveMatrix.generatedAt,
    thresholdPass: true,
    ok: true,
    count: 0,
    openNegativeSpaceCandidateCount: 0,
    work: [],
    basis: 'The declared parity-for-scope objective is exactly the canonical 26-gap inventory; unknown full-clone negative space remains outside this Phase 8 soak claim.',
    truthBoundary: objectiveMatrix.truthBoundary
  };
  return {
    gaps,
    surfaces,
    objectiveMatrix,
    negativeSpace,
    stats: {
      canonicalGapCount: normalized.length,
      coverageSurfaceCount: coverageSurfaces.length,
      depthSurfaceCount: depthSurfaces.length,
      selectedSurfaceCount: surfaces.length,
      distinctProductFileCount: distinctProductFiles.length,
      distinctTargetedTestCount: distinctTargetedTests.length,
      distinctProductFiles,
      distinctTargetedTests
    }
  };
}

export function createMailchimpGroundedSoakWorkload(args) {
  const inventory = readJson(args.inventoryPath);
  const built = buildMailchimpGroundedSoakWorkload({ inventory, mailchimpRoot: args.mailchimpRoot, maxSurfaces: args.maxSurfaces });
  const outDir = path.resolve(args.out);
  const runId = args.runId || `${args.benchmarkId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const artifactRoot = path.resolve(args.artifactRoot || path.join(outDir, 'run'));
  const workerCommand = normalizeWorkerCommand(args.workerCommand);
  fs.mkdirSync(outDir, { recursive: true });

  const objectiveMatrixPath = writeJson(path.join(outDir, 'objective_surface_matrix.json'), built.objectiveMatrix);
  const negativeSpacePath = writeJson(path.join(outDir, 'objective_negative_space.json'), built.negativeSpace);
  const handoffInput = {
    objective: 'Phase 8 corrected unattended real-work soak: sustain broad, verified Mailchimp product work across the canonical 26-gap inventory without external actions or full-clone overclaim.',
    goalId: 'agent_work_phase8_corrected_mailchimp_soak',
    replyAnchor: 'Jake said continue after the GPT-5.5 audit invalidated and stopped the weak-gated four-file soak.',
    repoPath: path.resolve(args.mailchimpRoot),
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    runId,
    artifactRoot,
    scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
    fidelity: 'parity_for_scope',
    requestedAgentCount: 12,
    executionBoundary: args.executionBoundary,
    stopCondition: 'supervisor_green_or_blocker_report',
    implementationSurface: 'mailchimp_product_code_with_independent_targeted_verification',
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'external_write', 'touch_prod', 'client_data', 'secrets'] },
    doneWhen: ['six_hour_minimum_elapsed', 'productive_real_model_work', 'canonical_gap_coverage_matrix_green', 'production_quality_gate_green', 'targeted_verification_green', 'no_truth_layer_overclaim'],
    routeLevels: ['L5 oracle', 'L24 nexus', 'L27 forge', 'L34 validator'],
    wavePolicy: { max_waves: Math.max(1, Number(args.maxWaves || 500)), handoff: 'wave_factpack' },
    expansionPolicy: { triggers: [], max_cycles: 0 },
    surfaces: built.surfaces,
    metadata: {
      phase8CorrectedMailchimpSoak: true,
      sourceInventoryPath: path.resolve(args.inventoryPath),
      objectiveSurfaceMatrixPath: objectiveMatrixPath,
      objectiveNegativeSpacePath: negativeSpacePath,
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      groundedInventory: built.stats,
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        promptMode: 'compact',
        externalVerification: true,
        workerCommand
      },
      canonicalLandingEvidence: {
        enabled: true,
        minAddedLineCount: 1,
        minUniqueNormalizedAddedLineCount: 1,
        duplicateLineRatioMax: 0.25
      },
      truthBoundary: built.objectiveMatrix.truthBoundary
    }
  };
  writeJson(path.join(outDir, 'handoff_input.json'), handoffInput);
  const compiled = writeCortexAgentWorkHandoff({ input: handoffInput, outputDir: path.join(outDir, 'compiled'), options: { runId } });
  const recommendedRuntimeEnv = {
    BENCHMARK_HOST_ROLE: 'execution_plane',
    HOST_ROLE: 'execution_plane',
    PATH_PREFIX: '/home/jake/.local/bin',
    CODEX_BIN: '/home/jake/.local/bin/codex',
    CODEX_CREATIVE_MODEL: 'gpt-5.6-sol',
    CODEX_CREATIVE_MAX_ITERATIONS: '2',
    CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
    CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
    CREATIVE_WORKER_PROMPT_MODE: 'compact',
    CODEX_CREATIVE_PROMPT_MODE: 'compact',
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '4',
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '10000',
    CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
    CONTINUOUS_CONTROLLER_PRODUCTION_QUALITY_GATE: '1',
    CONTINUOUS_CONTROLLER_OBJECTIVE_TRUTH_GATE: '1',
    CONTINUOUS_CONTROLLER_OBJECTIVE_SURFACE_MATRIX: objectiveMatrixPath,
    CONTINUOUS_CONTROLLER_OBJECTIVE_NEGATIVE_SPACE_QUEUE: negativeSpacePath
  };
  writeJson(path.join(outDir, 'mailchimp_soak_meta.json'), {
    runId,
    benchmarkId: args.benchmarkId,
    outDir,
    repoPath: path.resolve(args.mailchimpRoot),
    artifactRoot,
    compiledDir: path.join(outDir, 'compiled'),
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    objectiveSurfaceMatrixPath: objectiveMatrixPath,
    negativeSpacePath,
    fidelity: 'parity_for_scope',
    stopCondition: 'supervisor_green_or_blocker_report',
    campaignMode: 'persistent',
    workerCommand,
    stats: built.stats,
    recommendedRuntimeEnv,
    truthBoundary: built.objectiveMatrix.truthBoundary
  });
  return {
    ok: true,
    runId,
    artifactRoot,
    runContractPath: compiled.files.runContractPath,
    objectiveSurfaceMatrixPath: objectiveMatrixPath,
    negativeSpacePath,
    stats: built.stats
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(createMailchimpGroundedSoakWorkload(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
    process.exit(1);
  }
}
