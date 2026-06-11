import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_WORK_SPEC_SCHEMA,
  compileAgentWorkSpec
} from '../agent-work-dsl/index.mjs';

export const CORTEX_AGENT_WORK_HANDOFF_SCHEMA = 'cortex.agent_work_handoff.v0';
export const CORTEX_AGENT_WORK_COMPILATION_SCHEMA = 'cortex.agent_work_compilation.v0';

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeId(value, fallback = 'cortex_agent_work') {
  const cleaned = clean(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function stableList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => stableList(entry)).map(clean).filter(Boolean))];
  }
  if (value === undefined || value === null || value === '') return [];
  return [...new Set(String(value).split(/,|\n/).map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean))];
}

function routeLevelList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        const level = entry.level !== undefined ? `L${entry.level}` : '';
        const name = clean(entry.name || entry.label || entry.id);
        const method = clean(entry.method || entry.routingMethod || entry.routing_method);
        return [clean([level, name, method].filter(Boolean).join(' '))];
      }
      return stableList(entry);
    }).filter(Boolean))];
  }
  return stableList(value);
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePermissions(input = {}) {
  const permissions = input.permissions || {};
  return {
    allow: stableList(permissions.allow || input.allow || input.permissions_allow),
    forbid: stableList(permissions.forbid || input.forbid || input.forbidden || input.permissions_forbid)
  };
}

function normalizeCortexSurface(surface = {}, index = 0) {
  const id = normalizeId(surface.id || surface.surfaceId || surface.surface_id || surface.name || surface.label || `surface_${index + 1}`);
  const files = stableList(surface.files || surface.allowedFiles || surface.allowed_files || surface.productFiles || surface.product_files || surface.fileAreas || surface.file_areas);
  const verification = stableList(surface.verify || surface.verification || surface.verifiers || surface.tests || surface.test || surface.acceptanceCommands || surface.acceptance_commands);
  return {
    id,
    label: clean(surface.label || surface.name || id),
    goal: clean(surface.goal || surface.productGoal || surface.product_goal || surface.outcome || `Complete ${id}`),
    files,
    verify: verification,
    deps: stableList(surface.deps || surface.dependsOn || surface.depends_on),
    lane: clean(surface.lane || surface.domain || 'cortex_agent_work'),
    domain: clean(surface.domain || id),
    metadata: {
      ...(surface.metadata || {}),
      cortexSurface: true,
      confidence: surface.confidence ?? surface.score ?? undefined,
      sourceSurfaceId: surface.surfaceId || surface.surface_id || surface.id || null
    }
  };
}

function handoffSurfaces(input = {}) {
  return input.surfaces
    || input.surfaceMatrix?.surfaces
    || input.surface_matrix?.surfaces
    || input.contract?.scope?.surfaces
    || input.runContract?.scope?.surfaces
    || input.run_contract?.scope?.surfaces
    || [];
}

export function normalizeCortexAgentWorkHandoff(input = {}, options = {}) {
  const generatedAt = clean(input.generatedAt || input.generated_at || options.generatedAt) || nowIso();
  const objective = clean(
    input.objective
    || input.goal
    || input.intent?.objective
    || input.intent?.summary
    || input.userIntent
    || input.user_intent
    || input.prompt
    || 'Cortex agent work objective'
  );
  const target = input.target || {};
  const repoPath = clean(input.repoPath || input.repo_path || input.targetPath || input.target_path || target.repoPath || target.path || options.repoPath);
  const benchmarkId = normalizeId(input.benchmarkId || input.benchmark_id || input.benchmark || input.goalId || input.goal_id || objective);
  const goalId = normalizeId(input.goalId || input.goal_id || input.goal || objective, benchmarkId);
  const routeLevels = routeLevelList(
    input.routeLevels
    || input.route_levels
    || input.cortexRouteLevels
    || input.cortex_route_levels
    || input.routing?.levels
    || input.routing?.recommendedLevels
  );
  const memoryCitations = stableList(input.memoryCitations || input.memory_citations || input.evidence?.memoryCitations || input.evidence?.memory_citations);
  return {
    schemaVersion: CORTEX_AGENT_WORK_HANDOFF_SCHEMA,
    generatedAt,
    source: clean(input.source || options.source || 'cortex'),
    owner: clean(input.owner || input.user || options.owner),
    session: {
      sessionKey: clean(input.sessionKey || input.session_key || options.sessionKey),
      channel: clean(input.channel || options.channel),
      messageId: clean(input.messageId || input.message_id || options.messageId)
    },
    goalId,
    objective,
    repoPath,
    benchmarkId,
    benchmarkTier: clean(input.benchmarkTier || input.benchmark_tier || input.tier || 'agent_work_contract_v0'),
    runId: clean(input.runId || input.run_id || options.runId),
    artifactRoot: clean(input.artifactRoot || input.artifact_root || options.artifactRoot),
    scoreboardPath: clean(input.scoreboardPath || input.scoreboard_path),
    fidelity: clean(input.fidelity || input.requestedFidelity || input.requested_fidelity || 'production_slice'),
    requestedAgentCount: numberOr(input.requestedAgentCount || input.requested_agent_count || input.agents || input.agentCount || input.agent_count, 1),
    executionBoundary: clean(input.executionBoundary || input.execution_boundary || 'control_plane_allowed'),
    stopCondition: clean(input.stopCondition || input.stop_condition || 'supervisor_green_or_blocker_report'),
    permissions: normalizePermissions(input),
    requestedActions: stableList(input.requestedActions || input.requested_actions || input.actions || input.action),
    doneWhen: stableList(input.doneWhen || input.done_when || input.done || input.successCriteria || input.success_criteria),
    replyAnchor: clean(input.replyAnchor || input.reply_anchor || options.replyAnchor),
    routeLevels,
    memoryCitations,
    surfaces: handoffSurfaces(input).map(normalizeCortexSurface),
    metadata: {
      ...(input.metadata || {}),
      cortexAgentWorkHandoff: true,
      routingMethod: input.routingMethod || input.routing_method || input.routing?.method || null,
      routingReasoning: input.routingReasoning || input.routing_reasoning || input.routing?.reasoning || null
    }
  };
}

export function cortexHandoffToAgentWorkSpec(input = {}, options = {}) {
  const handoff = input.schemaVersion === CORTEX_AGENT_WORK_HANDOFF_SCHEMA
    ? normalizeCortexAgentWorkHandoff(input, options)
    : normalizeCortexAgentWorkHandoff(input, options);
  return {
    schemaVersion: AGENT_WORK_SPEC_SCHEMA,
    generatedAt: handoff.generatedAt,
    goalId: handoff.goalId,
    outcome: handoff.objective,
    benchmarkId: handoff.benchmarkId,
    benchmarkTier: handoff.benchmarkTier,
    runId: handoff.runId,
    repoPath: handoff.repoPath,
    artifactRoot: handoff.artifactRoot,
    scoreboardPath: handoff.scoreboardPath,
    fidelity: handoff.fidelity,
    requestedAgentCount: handoff.requestedAgentCount,
    executionBoundary: handoff.executionBoundary,
    stopCondition: handoff.stopCondition,
    permissions: handoff.permissions,
    requestedActions: handoff.requestedActions,
    doneWhen: handoff.doneWhen,
    replyAnchor: handoff.replyAnchor,
    surfaces: handoff.surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      goal: surface.goal,
      files: surface.files,
      verify: surface.verify,
      deps: surface.deps,
      lane: surface.lane,
      domain: surface.domain,
      metadata: surface.metadata
    })),
    metadata: {
      ...handoff.metadata,
      source: 'cortex_agent_work_handoff',
      cortex: {
        handoffSchemaVersion: handoff.schemaVersion,
        source: handoff.source,
        owner: handoff.owner || null,
        session: handoff.session,
        routeLevels: handoff.routeLevels,
        memoryCitations: handoff.memoryCitations,
        replyAnchor: handoff.replyAnchor || null
      }
    }
  };
}

function augmentCompilationWithCortex(compilation, handoff) {
  const cortexSummary = {
    handoffSchemaVersion: handoff.schemaVersion,
    source: handoff.source,
    owner: handoff.owner || null,
    session: handoff.session,
    routeLevels: handoff.routeLevels,
    memoryCitationCount: handoff.memoryCitations.length,
    replyAnchor: handoff.replyAnchor || null
  };
  return {
    ...compilation,
    runContract: {
      ...compilation.runContract,
      metadata: {
        ...(compilation.runContract.metadata || {}),
        cortexAgentWorkHandoff: cortexSummary
      },
      scope: {
        ...compilation.runContract.scope,
        agentWorkLanguage: {
          ...(compilation.runContract.scope?.agentWorkLanguage || {}),
          cortex: cortexSummary
        }
      }
    }
  };
}

export function compileCortexAgentWorkHandoff(input = {}, options = {}) {
  const handoff = normalizeCortexAgentWorkHandoff(input, options);
  const agentWorkSpec = cortexHandoffToAgentWorkSpec(handoff, options);
  const compilation = augmentCompilationWithCortex(compileAgentWorkSpec(agentWorkSpec, options), handoff);
  return {
    schemaVersion: CORTEX_AGENT_WORK_COMPILATION_SCHEMA,
    generatedAt: compilation.generatedAt,
    handoff,
    agentWorkSpec: compilation.spec,
    validation: compilation.validation,
    safetyReport: compilation.safetyReport,
    runContract: compilation.runContract,
    surfaceMatrix: compilation.surfaceMatrix,
    workGraph: compilation.workGraph,
    compilation
  };
}

export function writeCortexAgentWorkHandoff({ input, outputDir, options = {} } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const result = compileCortexAgentWorkHandoff(input, options);
  fs.mkdirSync(outputDir, { recursive: true });
  const files = {
    cortexHandoffPath: path.join(outputDir, 'cortex_handoff.json'),
    specPath: path.join(outputDir, 'agent_work_spec.json'),
    runContractPath: path.join(outputDir, 'run_contract.json'),
    surfaceMatrixPath: path.join(outputDir, 'surface_matrix.json'),
    workGraphPath: path.join(outputDir, 'work_graph.json'),
    compilerReportPath: path.join(outputDir, 'compiler_report.json')
  };
  fs.writeFileSync(files.cortexHandoffPath, `${JSON.stringify(result.handoff, null, 2)}\n`);
  fs.writeFileSync(files.specPath, `${JSON.stringify(result.agentWorkSpec, null, 2)}\n`);
  fs.writeFileSync(files.runContractPath, `${JSON.stringify(result.runContract, null, 2)}\n`);
  fs.writeFileSync(files.surfaceMatrixPath, `${JSON.stringify(result.surfaceMatrix, null, 2)}\n`);
  fs.writeFileSync(files.workGraphPath, `${JSON.stringify(result.workGraph, null, 2)}\n`);
  fs.writeFileSync(files.compilerReportPath, `${JSON.stringify({ ...result, files }, null, 2)}\n`);
  return { ...result, files };
}
