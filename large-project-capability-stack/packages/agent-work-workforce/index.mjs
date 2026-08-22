import crypto from 'node:crypto';

export const AGENT_WORK_SEMANTIC_WORKFORCE_SCHEMA = 'clawd.agent_work.semantic_workforce_plan.v1';
export const DEFAULT_SEMANTIC_WORKFORCE_MAX_AGENTS = 12;

function clean(value = '') {
  return String(value ?? '').trim();
}

function positive(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ratio(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean))].sort();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeMode(policy = {}, requestedAgentCount = null) {
  const raw = clean(policy.mode || policy.selectionMode || policy.selection_mode).toLowerCase().replace(/[-.\s]+/g, '_');
  if (['auto', 'semantic', 'semantic_auto', 'dynamic', 'adaptive'].includes(raw)) return 'semantic_auto';
  if (['manual', 'manual_fixed', 'fixed'].includes(raw)) return 'manual_fixed';
  if (['bounded_auto', 'cap', 'explicit_cap'].includes(raw)) return 'bounded_auto';
  return positive(requestedAgentCount) ? 'bounded_auto' : 'semantic_auto';
}

function normalizeWorkItem(item = {}, index = 0) {
  return {
    id: clean(item.id || item.taskId || item.surfaceId || item.gapId || `work_${index + 1}`),
    files: stableList(item.allowedFiles || item.files || item.productFiles || item.targetFiles || item.fileAreas),
    deps: stableList(item.deps || item.dependencies || item.dependsOn || item.depends_on || item.metadata?.deps || item.metadata?.dependencies),
    verifiers: stableList(item.requiredVerifiers || item.verification || item.verify || item.verifiers),
    lane: clean(item.lane || item.kind || item.metadata?.lane || 'implementation'),
    state: clean(item.state || item.status || 'ready').toLowerCase()
  };
}

function globalPattern(file = '') {
  return file === '*' || file === '**/*' || file === '.' || file === './' || file.endsWith('/**/*');
}

function fileCollision(left = [], right = []) {
  // Unknown ownership cannot safely prove independence.
  if (!left.length || !right.length) return true;
  if (left.some(globalPattern) || right.some(globalPattern)) return true;
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function readyWorkItems(items = [], completedIds = []) {
  const completed = new Set(stableList(completedIds));
  const blockedStates = new Set(['blocked', 'failed', 'cancelled', 'complete', 'completed', 'verified', 'green']);
  return items.filter((item) => !blockedStates.has(item.state) && item.deps.every((dep) => completed.has(dep)));
}

function selectIndependent(items = [], cap = Number.MAX_SAFE_INTEGER) {
  const selected = [];
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    if (selected.length >= cap) break;
    if (selected.some((prior) => fileCollision(prior.files, item.files))) continue;
    selected.push(item);
  }
  return selected;
}

function adaptationCap({ telemetry = {}, priorTarget = null, maxCap }) {
  const reasons = [];
  let cap = maxCap;
  const previous = positive(telemetry.previousTargetAgentCount || telemetry.previousTarget || priorTarget, null);
  if (!previous) return { cap, reasons };
  const providerErrorRate = ratio(telemetry.providerErrorRate, 0);
  const productiveRate = ratio(telemetry.productiveMergeRate ?? telemetry.productiveRate, 1);
  const verifierBacklog = Math.max(0, Number(telemetry.verifierBacklog || 0));
  const mergeBacklog = Math.max(0, Number(telemetry.mergeBacklog || 0));
  const pressure = clean(telemetry.resourcePressure || telemetry.resource_pressure).toLowerCase();
  if (providerErrorRate >= 0.25) {
    cap = Math.min(cap, Math.max(1, Math.floor(previous / 2)));
    reasons.push('provider_error_backoff');
  }
  if (productiveRate < 0.5) {
    cap = Math.min(cap, Math.max(1, Math.floor(previous / 2)));
    reasons.push('low_productive_merge_backoff');
  }
  if (verifierBacklog >= Math.max(2, previous * 2)) {
    cap = Math.min(cap, Math.max(1, Math.ceil(previous / 2)));
    reasons.push('verifier_backpressure');
  }
  if (mergeBacklog >= Math.max(2, previous)) {
    cap = Math.min(cap, Math.max(1, Math.ceil(previous * 0.75)));
    reasons.push('merge_backpressure');
  }
  if (['high', 'critical', 'saturated'].includes(pressure)) {
    cap = Math.min(cap, Math.max(1, Math.floor(previous / 2)));
    reasons.push('execution_resource_backpressure');
  }
  return { cap, reasons };
}

export function deriveSemanticWorkforcePlan({
  workItems = [],
  workGraph = null,
  requestedAgentCount = null,
  workforcePolicy = {},
  budgets = {},
  fidelity = 'production_slice',
  completedWorkItemIds = [],
  telemetry = {},
  priorPlan = null
} = {}) {
  const sourceItems = Array.isArray(workGraph?.nodes) && workGraph.nodes.length ? workGraph.nodes : workItems;
  const normalized = (sourceItems || []).map(normalizeWorkItem);
  const ready = readyWorkItems(normalized, completedWorkItemIds);
  const independent = selectIndependent(ready);
  const mode = normalizeMode(workforcePolicy, requestedAgentCount);
  const explicit = positive(requestedAgentCount, null);
  const policyMax = positive(workforcePolicy.maxAgents || workforcePolicy.max_agents, DEFAULT_SEMANTIC_WORKFORCE_MAX_AGENTS);
  const providerCap = positive(workforcePolicy.providerCapacity || workforcePolicy.provider_capacity, policyMax);
  const executionCap = positive(workforcePolicy.executionCapacity || workforcePolicy.execution_capacity, policyMax);
  const budgetCap = positive(budgets.concurrency || budgets.maxConcurrency || budgets.max_concurrency, policyMax);
  const spawnCap = positive(budgets.workerSpawns || budgets.worker_spawns || budgets.max_workers, policyMax);
  const explicitCap = mode === 'semantic_auto' ? policyMax : (explicit || policyMax);
  const hardMax = Math.max(1, Math.min(policyMax, providerCap, executionCap, budgetCap, spawnCap, explicitCap));
  const adaptive = adaptationCap({ telemetry, priorTarget: priorPlan?.targetAgentCount, maxCap: hardMax });
  const constrainedMax = Math.max(1, Math.min(hardMax, adaptive.cap));
  const minimum = positive(workforcePolicy.minAgents || workforcePolicy.min_agents, 1);
  const fidelityWeight = ({ prototype: 0.5, production_slice: 1, parity_for_scope: 1.25, full_clone: 1.5 })[fidelity] || 1;
  const verifierCount = ready.reduce((sum, item) => sum + item.verifiers.length, 0);
  const fileCount = new Set(ready.flatMap((item) => item.files)).size;
  const complexityScore = Number((ready.length * fidelityWeight + verifierCount * 0.25 + fileCount * 0.1).toFixed(2));
  const independentComplexityUnits = independent.reduce((sum, item) => sum + fidelityWeight + item.verifiers.length * 0.25 + Math.min(item.files.length, 4) * 0.1, 0);
  const complexitySupportedAgents = independent.length ? Math.max(1, Math.min(independent.length, Math.ceil(independentComplexityUnits))) : 0;
  const target = ready.length === 0 ? 0 : Math.max(1, Math.min(independent.length || 1, constrainedMax, complexitySupportedAgents || 1));
  const selected = independent.slice(0, target);
  const reasons = [
    mode === 'semantic_auto' ? 'agent_count_derived_from_semantic_work_graph' : 'explicit_agent_count_used_as_safe_cap',
    independent.length < ready.length ? 'file_overlap_reduced_parallelism' : 'ready_work_is_low_overlap',
    ...adaptive.reasons
  ];
  if (target < hardMax && independent.length < hardMax) reasons.push('independent_ready_work_below_available_capacity');
  if (target === hardMax && independent.length > hardMax) reasons.push('hard_capacity_or_budget_cap_applied');
  if (complexitySupportedAgents < independent.length) reasons.push('low_complexity_work_consolidation');
  const packet = {
    schemaVersion: AGENT_WORK_SEMANTIC_WORKFORCE_SCHEMA,
    generatedAt: new Date().toISOString(),
    status: ready.length ? 'ready' : 'no_ready_work',
    selectionMode: mode,
    requestedAgentCount: explicit,
    requestedCountSemantics: mode === 'semantic_auto' ? 'not_supplied_by_operator' : mode === 'manual_fixed' ? 'operator_fixed_upper_bound' : 'operator_upper_bound',
    minAgentCount: ready.length ? Math.min(minimum, target || 1) : 0,
    targetAgentCount: target,
    maxAgentCount: hardMax,
    adaptiveMaxAgentCount: constrainedMax,
    totalWorkItemCount: normalized.length,
    readyWorkItemCount: ready.length,
    independentReadyWorkItemCount: independent.length,
    blockedOrDependentWorkItemCount: Math.max(0, normalized.length - ready.length),
    selectedWorkItemIds: selected.map((item) => item.id),
    deferredWorkItemIds: normalized.map((item) => item.id).filter((id) => !selected.some((item) => item.id === id)),
    complexity: { score: complexityScore, fidelity, verifierCount, distinctFileCount: fileCount, supportedAgentCount: complexitySupportedAgents },
    constraints: {
      policyMaxAgents: policyMax,
      providerCapacity: providerCap,
      executionCapacity: executionCap,
      budgetConcurrency: budgetCap,
      workerSpawnCap: spawnCap,
      explicitAgentCap: explicitCap
    },
    telemetry: {
      previousTargetAgentCount: positive(telemetry.previousTargetAgentCount || telemetry.previousTarget || priorPlan?.targetAgentCount, null),
      providerErrorRate: ratio(telemetry.providerErrorRate, null),
      productiveMergeRate: ratio(telemetry.productiveMergeRate ?? telemetry.productiveRate, null),
      verifierBacklog: Math.max(0, Number(telemetry.verifierBacklog || 0)),
      mergeBacklog: Math.max(0, Number(telemetry.mergeBacklog || 0)),
      resourcePressure: clean(telemetry.resourcePressure || telemetry.resource_pressure) || null
    },
    decisionReasons: [...new Set(reasons)],
    truthBoundary: 'This packet chooses semantic per-wave workforce size from executable low-overlap work, policy, budget, provider/execution capacity, and observed backpressure. Runtime worker/process/provider evidence remains required before claiming physical concurrency.'
  };
  const { generatedAt: _generatedAt, ...decisionInput } = packet;
  return { ...packet, digest: digest(decisionInput) };
}
