import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildInventory, computeParity } from '../full-parity-engine/index.mjs';
import { decomposeObjectiveToArchitectureEpics, decomposeObjectiveToSurfaces } from '../objective-surface-decomposer/index.mjs';
import { deriveSemanticWorkforcePlan } from '../agent-work-workforce/index.mjs';

export const AGENT_WORK_PHASE4_PLANNING_PACKET_SCHEMA = 'clawd.agent_work.phase4_planning_packet.v1';
export const AGENT_WORK_PHASE4_REVIEW_PACKET_SCHEMA = 'clawd.agent_work.phase4_plan_review_packet.v1';
export const AGENT_WORK_PHASE4_WORK_GRAPH_SCHEMA = 'clawd.agent_work.phase4_verifier_backed_work_graph.v1';
export const AGENT_WORK_PHASE4_CONTINUATION_SCHEMA = 'clawd.agent_work.phase4_continuation_policy.v1';

const ROLE_GAP_KIND = Object.freeze({
  route_api: 'missing_routes',
  storage: 'missing_persistence',
  security: 'missing_permissions',
  integration: 'missing_integrations',
  job_event: 'missing_runtime_role',
  ui: 'missing_runtime_role',
  domain: 'missing_runtime_role'
});

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean))].sort();
}

function slug(value = 'item') {
  return clean(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !['generatedAt', 'updatedAt'].includes(key))
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function repoExists(repoPath) {
  try {
    return Boolean(repoPath && fs.statSync(path.resolve(repoPath)).isDirectory());
  } catch {
    return false;
  }
}

function requestedAgentCountFrom({ input = {}, contractBundle = {} } = {}) {
  const limits = contractBundle?.budgetContract?.limits || {};
  const policy = input.workforcePolicy || input.workforce_policy || contractBundle?.objectiveContract?.workforcePolicy || {};
  const mode = String(policy.mode || '').trim().toLowerCase().replace(/[-.\s]+/g, '_');
  if (['auto', 'semantic', 'semantic_auto', 'dynamic', 'adaptive'].includes(mode) && policy.requestedAgentCountSource !== 'operator') return null;
  const value = input.requestedAgentCount ?? input.agentCount ?? limits.concurrency;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeObjective({ input = {}, contractBundle = {} } = {}) {
  const contract = contractBundle?.objectiveContract || {};
  const runManifest = contractBundle?.runManifest || {};
  const rawReference = input.reference || input.referenceSource || {};
  const referencePath = clean(input.referencePath || input.referenceRepoPath || rawReference.repoPath || rawReference.path || rawReference.targetPath || contract.referencePath);
  const referenceInventory = input.referenceInventory || rawReference.inventory || null;
  const fidelity = clean(input.fidelity || contract.fidelity || 'production_slice');
  const scope = stableList(contract.scope?.length ? contract.scope : input.scope || (input.surfaces || []).map((surface) => surface.id || surface.surfaceId));
  return {
    objectiveId: clean(contract.objectiveId || input.objectiveId || input.goalId || slug(input.objective || 'agent_work_objective')),
    runId: clean(runManifest.runId || input.runId || 'agent_work_run'),
    objective: clean(contract.objective || input.objective || input.title || 'Agent Work objective'),
    anchor: clean(contract.anchor || input.replyAnchor || input.anchor || input.objective || input.title),
    replyAnchor: clean(contract.replyAnchor || input.replyAnchor) || null,
    targetPath: clean(input.targetPath || input.repoPath || contract.targetPath),
    referencePath: referencePath || null,
    referenceInventory,
    referenceSourceKind: referenceInventory ? 'declared_inventory' : referencePath ? 'reference_repo' : input.referenceSpec ? 'declared_spec' : null,
    referenceSpec: input.referenceSpec || rawReference.spec || null,
    fidelity,
    scope,
    implementationSurface: clean(contract.implementationSurface || input.implementationSurface || 'mixed'),
    stopCondition: clean(contract.stopCondition || input.stopCondition || 'supervisor_green_or_blocker_report'),
    doneWhen: stableList(contract.doneWhen?.length ? contract.doneWhen : input.doneWhen || ['independent_acceptance_green']),
    requestedClaims: stableList(contract.requestedClaims || input.requestedClaims),
    requestedAgentCount: requestedAgentCountFrom({ input, contractBundle }),
    workforcePolicy: input.workforcePolicy || input.workforce_policy || contract.workforcePolicy || {}
  };
}

function declaredSurfaces({ input = {}, contractBundle = {} } = {}) {
  const taskSurfaces = (contractBundle?.taskContracts || []).map((task) => ({
    id: task.surfaceIds?.[0] || task.taskId,
    label: task.goal || task.taskId,
    files: task.allowedFiles || [],
    verifiers: task.requiredVerifiers || [],
    evidence: [],
    metadata: { sourceTaskId: task.taskId }
  }));
  if (taskSurfaces.length) return taskSurfaces;
  return (input.surfaces || []).map((surface) => ({
    id: surface.id || surface.surfaceId || surface.name,
    label: surface.label || surface.goal || surface.name || surface.id,
    files: surface.files || surface.allowedFiles || surface.productFiles || [],
    verifiers: surface.verify || surface.verifiers || surface.tests || [],
    evidence: [],
    metadata: surface.metadata || {}
  }));
}

function verifierIds(commands = [], prefix = 'verifier') {
  const list = stableList(commands);
  if (list.length) return list.map((command, index) => `${slug(prefix)}_${String(index + 1).padStart(2, '0')}_${slug(command).slice(0, 48)}`);
  return [`${slug(prefix)}_manual_runtime_proof_required`];
}

function inventorySurfaceFromMatrixSurface(surface = {}, { source = 'implementation', evidenceFromFiles = false } = {}) {
  const targetFiles = stableList(surface.targetFiles || surface.allowedFiles || surface.files || surface.productFiles);
  const roles = stableList(surface.roles || surface.detectedLayers || surface.architectureRoles || []);
  const verifiers = verifierIds(surface.verification || surface.verifiers || surface.verify || surface.testFiles, surface.id || surface.label);
  return {
    id: surface.id || surface.surfaceId || surface.productArea || slug(surface.label || 'surface'),
    label: surface.label || surface.title || surface.id || 'Surface',
    kind: surface.lane || surface.kind || 'product_surface',
    required: surface.required !== false,
    files: targetFiles,
    routes: targetFiles.filter((file) => /(?:^|\/)routes?\/|server\.|api-|http/i.test(file)),
    states: roles.filter((role) => ['storage', 'job_event', 'domain'].includes(role)),
    permissions: roles.includes('security') || targetFiles.some((file) => /auth|security|permission|policy/i.test(file)) ? ['permission_boundary'] : [],
    integrations: roles.includes('integration') || targetFiles.some((file) => /integration|provider|webhook|adapter/i.test(file)) ? ['integration_boundary'] : [],
    verifiers,
    evidence: evidenceFromFiles ? targetFiles : [],
    confidence: source === 'implementation' && targetFiles.length ? 1 : null,
    metadata: {
      source,
      roles,
      lane: surface.lane || null,
      verifierCommands: stableList(surface.verification || surface.verifiers || surface.verify || surface.testFiles)
    }
  };
}

export function buildRepositoryInventoryAdapter({ repoPath, objective = {}, source = 'implementation', architectureEpics = false } = {}) {
  const root = path.resolve(repoPath || '.');
  if (!repoExists(root)) {
    return {
      ok: false,
      status: 'missing_repository',
      repoPath: root,
      blocker: {
        code: 'target_repository_missing',
        summary: `Repository path does not exist or is not a directory: ${root}`,
        nextAction: 'Provide a valid target or reference repository path before requiring strict inventory planning.'
      },
      inventory: null,
      deterministicDigest: null
    };
  }
  const normalizedObjective = {
    id: objective.objectiveId || objective.id || slug(objective.objective || objective.title || 'objective'),
    title: objective.objective || objective.title || objective.prompt || 'Agent Work objective',
    requestedFidelity: objective.fidelity || objective.requestedFidelity || null,
    requestedAgentCount: objective.requestedAgentCount || null
  };
  const decomposition = architectureEpics
    ? decomposeObjectiveToArchitectureEpics({ repoPath: root, objective: normalizedObjective, requestedAgentCount: normalizedObjective.requestedAgentCount, maxEpics: 5 })
    : decomposeObjectiveToSurfaces({ repoPath: root, objective: normalizedObjective, requestedAgentCount: normalizedObjective.requestedAgentCount });
  const matrixSurfaces = decomposition.surfaceMatrix?.surfaces || [];
  const surfaces = matrixSurfaces.map((surface) => inventorySurfaceFromMatrixSurface(surface, { source, evidenceFromFiles: source === 'implementation' }));
  const inventory = buildInventory({ source, targetPath: root, surfaces, metadata: { adapter: architectureEpics ? 'architecture_epic_repo_survey' : 'repo_survey', decompositionSchema: decomposition.schemaVersion, decompositionStatus: decomposition.status } });
  return {
    ok: true,
    status: 'inventoried',
    repoPath: root,
    survey: decomposition.survey,
    decomposition,
    inventory,
    deterministicDigest: digest({ inventory, surveyMetrics: decomposition.survey?.metrics, domains: decomposition.survey?.domains?.map((domain) => ({ id: domain.id, roles: domain.roles, productFileCount: domain.productFileCount, testFileCount: domain.testFileCount })) })
  };
}

function buildInventoryFromDeclaredSurfaces({ source, targetPath, surfaces = [], evidenceFromFiles = false } = {}) {
  return buildInventory({
    source,
    targetPath,
    surfaces: surfaces.map((surface) => ({
      id: surface.id || surface.surfaceId || slug(surface.label || surface.goal || 'surface'),
      label: surface.label || surface.goal || surface.id || 'Surface',
      kind: surface.kind || 'declared_surface',
      required: surface.required !== false,
      files: stableList(surface.files || surface.allowedFiles || surface.productFiles),
      routes: stableList(surface.routes),
      states: stableList(surface.states),
      permissions: stableList(surface.permissions),
      integrations: stableList(surface.integrations),
      verifiers: stableList(surface.verifiers || surface.verify || surface.tests).length ? stableList(surface.verifiers || surface.verify || surface.tests) : [`${slug(surface.id || surface.label)}_manual_proof_required`],
      evidence: evidenceFromFiles ? stableList(surface.evidence || surface.files || surface.allowedFiles || surface.productFiles) : stableList(surface.evidence),
      metadata: surface.metadata || {}
    })),
    metadata: { adapter: 'declared_scope' }
  });
}

function buildReferenceAdapter({ normalized, input = {}, contractBundle = {} } = {}) {
  if (normalized.referenceInventory) {
    const inventory = normalized.referenceInventory.schemaVersion
      ? normalized.referenceInventory
      : buildInventory({ source: 'declared_reference_inventory', targetPath: normalized.referencePath || normalized.targetPath, surfaces: normalized.referenceInventory.surfaces || [] });
    return { ok: true, status: 'declared_reference_inventory', inventory, deterministicDigest: digest(inventory) };
  }
  if (normalized.referenceSpec?.surfaces?.length) {
    const inventory = buildInventoryFromDeclaredSurfaces({ source: 'declared_reference_spec', targetPath: normalized.referencePath || 'declared_spec', surfaces: normalized.referenceSpec.surfaces });
    return { ok: true, status: 'declared_reference_spec', inventory, deterministicDigest: digest(inventory) };
  }
  if (normalized.referencePath) {
    return buildRepositoryInventoryAdapter({ repoPath: normalized.referencePath, objective: normalized, source: 'reference', architectureEpics: normalized.fidelity === 'full_clone' });
  }
  const surfaces = declaredSurfaces({ input, contractBundle });
  const inventory = buildInventoryFromDeclaredSurfaces({ source: 'declared_scope_reference', targetPath: normalized.targetPath, surfaces });
  return { ok: true, status: 'declared_scope_fallback', inventory, deterministicDigest: digest(inventory) };
}

function buildImplementationAdapter({ normalized, input = {}, contractBundle = {} } = {}) {
  const repoAdapter = buildRepositoryInventoryAdapter({ repoPath: normalized.targetPath, objective: normalized, source: 'implementation', architectureEpics: false });
  if (repoAdapter.ok) return repoAdapter;
  const surfaces = declaredSurfaces({ input, contractBundle });
  const inventory = buildInventoryFromDeclaredSurfaces({ source: 'declared_scope_implementation', targetPath: normalized.targetPath, surfaces, evidenceFromFiles: false });
  return {
    ok: surfaces.length > 0,
    status: surfaces.length ? 'declared_scope_fallback' : 'missing_repository',
    repoPath: normalized.targetPath ? path.resolve(normalized.targetPath) : null,
    blocker: repoAdapter.blocker,
    inventory,
    deterministicDigest: digest(inventory),
    fallbackReason: repoAdapter.blocker
  };
}

function fullCloneReferenceBlockers({ normalized, referenceAdapter }) {
  if (normalized.fidelity !== 'full_clone') return [];
  const blockers = [];
  const declared = normalized.referencePath || normalized.referenceInventory || normalized.referenceSpec;
  if (!declared) blockers.push({
    code: 'full_clone_reference_required',
    family: 'objective_contract',
    summary: 'A full_clone Agent Work objective requires an explicit reference source before compilation can be admitted.',
    nextAction: 'Provide referencePath, referenceInventory, or referenceSpec with expected surfaces and parity evidence requirements.'
  });
  const surfaces = referenceAdapter?.inventory?.surfaces || [];
  const missingVerifierRows = surfaces.filter((surface) => !stableList(surface.verifiers).length);
  if (!surfaces.length || missingVerifierRows.length) blockers.push({
    code: 'full_clone_parity_evidence_required',
    family: 'objective_contract',
    summary: 'A full_clone Agent Work objective requires reference surfaces with declared parity evidence/verifier requirements.',
    observedEvidence: [`referenceSurfaceCount=${surfaces.length}`, `missingVerifierSurfaceCount=${missingVerifierRows.length}`],
    nextAction: 'Attach verifier requirements to every required reference surface before compiling a full-clone run.'
  });
  return blockers;
}

function fpeObjective(normalized, referenceInventory) {
  return {
    anchor: normalized.anchor,
    replyAnchor: normalized.replyAnchor,
    targetPath: normalized.targetPath,
    referencePath: normalized.referencePath,
    fidelity: normalized.fidelity,
    scope: stableList(normalized.scope.length ? normalized.scope : (referenceInventory?.surfaces || []).map((surface) => surface.id)),
    implementationSurface: normalized.implementationSurface,
    stopCondition: normalized.stopCondition,
    doneWhen: normalized.doneWhen,
    metadata: { objectiveId: normalized.objectiveId, runId: normalized.runId }
  };
}

function gapFromMissingRole(role) {
  const kind = ROLE_GAP_KIND[role] || 'missing_runtime_role';
  const label = {
    missing_routes: 'Missing route/API surface',
    missing_persistence: 'Missing persistence surface',
    missing_permissions: 'Missing permissions/security surface',
    missing_integrations: 'Missing integration/provider surface',
    missing_runtime_role: `Missing runtime role: ${role}`
  }[kind] || `Missing ${role}`;
  return {
    id: `${kind}_${slug(role)}`,
    kind,
    source: 'target_negative_space',
    role,
    label,
    reason: 'expected_runtime_role_absent',
    requiredVerifiers: [`${kind}_${slug(role)}_proof`],
    suggestedFiles: [`packages/app/${slug(role)}.mjs`]
  };
}

function gapsFromWeakDomain(weakDomain = {}) {
  return stableList(weakDomain.gaps).map((gap) => {
    const kind = gap === 'missing_targeted_tests'
      ? 'missing_tests'
      : gap === 'no_storage_or_persistence_detected'
        ? 'missing_persistence'
        : gap === 'no_runtime_entrypoint_detected'
          ? 'missing_runtime_role'
          : `weak_domain_${slug(gap)}`;
    return {
      id: `${kind}_${slug(weakDomain.domainId)}`,
      kind,
      source: 'weak_domain_surface',
      domainId: weakDomain.domainId,
      label: `${kind.replace(/_/g, ' ')} for ${weakDomain.domainId}`,
      reason: gap,
      requiredVerifiers: kind === 'missing_tests' ? [`targeted_test_for_${slug(weakDomain.domainId)}`] : [`runtime_proof_for_${slug(weakDomain.domainId)}`],
      suggestedFiles: stableList(weakDomain.productFiles)
    };
  });
}

function gapsFromParity(parityResult) {
  return (parityResult?.negativeSpace?.gaps || []).map((gap) => ({
    id: `parity_gap_${slug(gap.surfaceId)}_${slug(gap.reason)}`,
    kind: gap.reason === 'surface_not_observed_with_evidence' ? 'missing_reference_surface' : 'missing_verifier_coverage',
    source: 'full_parity_engine',
    surfaceId: gap.surfaceId,
    label: `Parity gap for ${gap.surfaceId}`,
    reason: gap.reason,
    requiredVerifiers: stableList(gap.requiredVerifiers).length ? stableList(gap.requiredVerifiers) : [`parity_proof_for_${slug(gap.surfaceId)}`],
    suggestedFiles: []
  }));
}

export function buildPlanningNegativeSpaceRows({ implementationAdapter, parityResult } = {}) {
  const rows = [];
  const negativeSpace = implementationAdapter?.decomposition?.negativeSpace;
  for (const role of stableList(negativeSpace?.missingRoles || [])) rows.push(gapFromMissingRole(role));
  for (const weak of negativeSpace?.weakDomains || []) rows.push(...gapsFromWeakDomain(weak));
  rows.push(...gapsFromParity(parityResult));
  const byId = new Map();
  for (const row of rows) {
    const id = row.id || slug(`${row.kind}_${row.surfaceId || row.domainId || row.role || byId.size}`);
    if (!byId.has(id)) byId.set(id, { ...row, id });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildVerifierBackedWorkGraph({ negativeSpaceRows = [], objective = {}, requestedAgentCount = 1 } = {}) {
  const nodes = negativeSpaceRows.map((row, index) => {
    const allowedFiles = stableList(row.suggestedFiles || row.files || row.allowedFiles);
    const requiredVerifiers = stableList(row.requiredVerifiers).length ? stableList(row.requiredVerifiers) : [`phase4_gap_${String(index + 1).padStart(3, '0')}_proof`];
    const node = {
      id: `phase4_${String(index + 1).padStart(3, '0')}_${slug(row.id || row.kind)}`,
      gapId: row.id,
      kind: row.kind,
      source: row.source,
      surfaceId: row.surfaceId || row.domainId || row.role || null,
      goal: row.kind === 'missing_tests'
        ? `Add executable verifier coverage for ${row.label || row.surfaceId || row.domainId}.`
        : `Close or explicitly block planning gap: ${row.label || row.kind}.`,
      allowedFiles,
      requiredVerifiers,
      verifierBacked: true,
      duplicateKey: digest({ kind: row.kind, surfaceId: row.surfaceId, domainId: row.domainId, role: row.role, allowedFiles, requiredVerifiers }),
      state: 'ready_for_plan_review',
      metadata: { objectiveId: objective.objectiveId || objective.id || null, reason: row.reason }
    };
    return node;
  });
  return {
    schemaVersion: AGENT_WORK_PHASE4_WORK_GRAPH_SCHEMA,
    generatedAt: nowIso(),
    objectiveId: objective.objectiveId || objective.id || slug(objective.objective || 'objective'),
    requestedAgentCount: Number(requestedAgentCount || 0) || null,
    status: nodes.length ? 'work_remaining' : 'no_negative_space_rows',
    nodeCount: nodes.length,
    nodes
  };
}

export function computeFeasibleConcurrency({ workGraph, requestedAgentCount = null, workforcePolicy = {}, budgets = {}, fidelity = 'production_slice', telemetry = {} } = {}) {
  const plan = deriveSemanticWorkforcePlan({ workGraph, requestedAgentCount, workforcePolicy, budgets, fidelity, telemetry });
  return {
    requestedAgentCount: plan.requestedAgentCount,
    feasibleConcurrency: plan.targetAgentCount,
    selectedNodeIds: plan.selectedWorkItemIds,
    blockedNodeIds: plan.deferredWorkItemIds,
    method: 'semantic_low_overlap_workforce_allocator',
    selectionMode: plan.selectionMode,
    maxAgentCount: plan.maxAgentCount,
    workforcePlanDigest: plan.digest,
    truthBoundary: 'Concurrency is selected from executable low-overlap work and hard policy/budget/capacity constraints. Runtime evidence is still required before claiming physical concurrency.'
  };
}

export function buildPlanReviewPacket({ normalized, referenceInventory, implementationInventory, workGraph, concurrency, workforcePlan = null, blockers = [], approval = null } = {}) {
  const estimatedBudget = {
    nodeCount: workGraph?.nodeCount || 0,
    estimatedWorkerSpawns: workforcePlan?.targetAgentCount ?? concurrency?.feasibleConcurrency ?? 0,
    estimatedVerifierRuns: (workGraph?.nodes || []).reduce((sum, node) => sum + stableList(node.requiredVerifiers).length, 0),
    riskLevel: blockers.length ? 'blocked' : (workGraph?.nodeCount || 0) > 20 ? 'high' : (workGraph?.nodeCount || 0) > 5 ? 'medium' : 'low'
  };
  const claimBoundary = {
    allowedClaims: ['objective_bound', 'target_inventory_generated', 'planning_negative_space_generated', 'verifier_backed_work_graph_generated'],
    rejectedClaims: ['worker_execution_started', 'patches_accepted', 'objective_complete', 'full_clone_complete', 'release_complete'],
    truthBoundary: 'Phase 4 review can approve a plan digest for admission. It is not worker execution, verifier success, or completion evidence.'
  };
  const planDigest = digest({
    objective: normalized,
    referenceDigest: referenceInventory?.digest || null,
    implementationDigest: implementationInventory?.digest || null,
    workGraph: workGraph?.nodes || [],
    estimatedBudget,
    claimBoundary
  });
  const approvedPlanDigest = clean(approval?.approvedPlanDigest || approval?.planDigest);
  const approvalStatus = approvedPlanDigest
    ? approvedPlanDigest === planDigest ? 'approved' : 'rejected_digest_mismatch'
    : 'pending_approval';
  return {
    schemaVersion: AGENT_WORK_PHASE4_REVIEW_PACKET_SCHEMA,
    generatedAt: nowIso(),
    objectiveId: normalized.objectiveId,
    runId: normalized.runId,
    planDigest,
    approvalRequired: true,
    approvalStatus,
    approvedPlanDigest: approvedPlanDigest || null,
    approvedBy: approvalStatus === 'approved' ? clean(approval?.approvedBy || 'operator') : null,
    estimatedBudget,
    risk: {
      blockerCount: blockers.length,
      riskLevel: estimatedBudget.riskLevel,
      notes: blockers.map((blocker) => blocker.code)
    },
    claimBoundary
  };
}

export function deriveContinuationPolicy({ supervisorState = {}, currentWorkGraph = null, planningWorkGraph = null, priorExpansionDigests = [] } = {}) {
  const status = clean(supervisorState.status || supervisorState.supervisorStatus || 'red');
  const matrixStatus = clean(supervisorState.matrixStatus || supervisorState.surfaceMatrixStatus || 'unknown');
  const parityStatus = clean(supervisorState.parityStatus || 'unknown');
  const objectiveRed = !(status === 'green' && ['green', 'all_complete'].includes(matrixStatus) && !['blocked', 'red'].includes(parityStatus));
  const currentCount = Number.isFinite(Number(supervisorState.currentWorkCount))
    ? Number(supervisorState.currentWorkCount)
    : Array.isArray(currentWorkGraph?.nodes)
      ? currentWorkGraph.nodes.length
      : Array.isArray(currentWorkGraph?.workUnits)
        ? currentWorkGraph.workUnits.length
        : 0;
  const queueExhausted = currentCount === 0 || ['all_complete', 'scope_satisfied_zero_work', 'mechanical_green_zero_work'].includes(matrixStatus) || Boolean(supervisorState.scopeAlreadySatisfied);
  const nodes = planningWorkGraph?.nodes || [];
  const expansionDigest = digest(nodes.map((node) => ({ id: node.id, duplicateKey: node.duplicateKey })));
  const duplicate = stableList(priorExpansionDigests).includes(expansionDigest);
  let action = 'continue_current_queue';
  let blocker = null;
  if (objectiveRed && queueExhausted && duplicate) {
    action = 'blocked';
    blocker = {
      code: 'duplicate_expansion_work_rejected',
      summary: 'The next objective expansion would duplicate a prior expansion digest.',
      nextAction: 'Recompute inventory with new evidence or write a blocker instead of relaunching identical work.'
    };
  } else if (objectiveRed && queueExhausted && nodes.length > 0) {
    action = 'expand';
  } else if (objectiveRed && queueExhausted && nodes.length === 0) {
    action = 'blocked';
    blocker = {
      code: 'objective_red_no_executable_expansion_work',
      summary: 'The objective remains red, the current queue is exhausted, and no verifier-backed planning nodes were derived.',
      nextAction: 'Attach a richer reference/target inventory or write a precise blocker.'
    };
  } else if (!objectiveRed) {
    action = 'stop_green';
  }
  return {
    schemaVersion: AGENT_WORK_PHASE4_CONTINUATION_SCHEMA,
    generatedAt: nowIso(),
    action,
    objectiveRed,
    queueExhausted,
    currentWorkCount: currentCount,
    expansionDigest,
    duplicateExpansion: duplicate,
    executableExpansionNodeCount: nodes.length,
    blocker,
    truthBoundary: 'Continuation policy expands only when objective truth is red and the current queue is exhausted. Duplicate expansion is blocked.'
  };
}

export function buildAgentWorkPlanningPacket({ input = {}, contractBundle = {}, runRoot = null, strictPlanning = false, currentState = {}, approval = null } = {}) {
  const normalized = normalizeObjective({ input, contractBundle });
  const implementationAdapter = buildImplementationAdapter({ normalized, input, contractBundle });
  const referenceAdapter = buildReferenceAdapter({ normalized, input, contractBundle });
  const blockers = [
    ...fullCloneReferenceBlockers({ normalized, referenceAdapter })
  ];
  if (strictPlanning && !implementationAdapter.ok) blockers.push({
    code: 'target_inventory_required',
    family: 'planning',
    summary: 'Strict Phase 4 planning requires a readable target repository inventory.',
    nextAction: 'Provide a valid targetPath/repoPath or disable strict planning for contract-only planning.'
  });

  let parityResult = null;
  let parityError = null;
  try {
    parityResult = computeParity({
      objective: fpeObjective(normalized, referenceAdapter.inventory),
      referenceInventory: referenceAdapter.inventory,
      implementationInventory: implementationAdapter.inventory,
      verifierResults: input.verifierResults || {}
    });
  } catch (error) {
    parityError = error?.message || String(error);
    blockers.push({
      code: 'parity_computation_failed',
      family: 'planning',
      summary: 'Full Parity Engine could not compute the planning matrix from supplied inventories.',
      observedEvidence: [parityError],
      nextAction: 'Fix objective binding or inventory shape before admission.'
    });
  }

  const negativeSpaceRows = buildPlanningNegativeSpaceRows({ implementationAdapter, parityResult });
  const workGraph = buildVerifierBackedWorkGraph({ negativeSpaceRows, objective: normalized, requestedAgentCount: normalized.requestedAgentCount });
  const declaredWorkItems = declaredSurfaces({ input, contractBundle });
  const decompositionWorkforcePlan = deriveSemanticWorkforcePlan({
    workGraph: workGraph.nodes.length ? workGraph : null,
    workItems: workGraph.nodes.length ? [] : declaredWorkItems,
    requestedAgentCount: normalized.requestedAgentCount,
    workforcePolicy: normalized.workforcePolicy,
    budgets: input.budgets || input.budget || contractBundle?.budgetContract?.limits || {},
    fidelity: normalized.fidelity,
    completedWorkItemIds: currentState.completedWorkItemIds || [],
    telemetry: currentState.workforceTelemetry || {},
    priorPlan: currentState.priorWorkforcePlan || null
  });
  const admittedWorkItems = declaredWorkItems.length ? declaredWorkItems : workGraph.nodes;
  const workforcePlan = deriveSemanticWorkforcePlan({
    workItems: admittedWorkItems,
    requestedAgentCount: normalized.requestedAgentCount,
    workforcePolicy: normalized.workforcePolicy,
    budgets: input.budgets || input.budget || contractBundle?.budgetContract?.limits || {},
    fidelity: normalized.fidelity,
    completedWorkItemIds: currentState.completedWorkItemIds || [],
    telemetry: currentState.workforceTelemetry || {},
    priorPlan: currentState.priorWorkforcePlan || null
  });
  const concurrency = {
    requestedAgentCount: workforcePlan.requestedAgentCount,
    feasibleConcurrency: workforcePlan.targetAgentCount,
    selectedNodeIds: workforcePlan.selectedWorkItemIds,
    blockedNodeIds: workforcePlan.deferredWorkItemIds,
    method: 'semantic_low_overlap_workforce_allocator',
    selectionMode: workforcePlan.selectionMode,
    maxAgentCount: workforcePlan.maxAgentCount,
    workforcePlanDigest: workforcePlan.digest,
    truthBoundary: 'Runtime concurrency is selected only from admitted executable surfaces. Decomposition capacity is reported separately and cannot inflate the launch count.'
  };
  const reviewPacket = buildPlanReviewPacket({ normalized, referenceInventory: referenceAdapter.inventory, implementationInventory: implementationAdapter.inventory, workGraph, concurrency, workforcePlan, blockers, approval });
  const continuationPolicy = deriveContinuationPolicy({
    supervisorState: currentState.supervisorState || {},
    currentWorkGraph: currentState.currentWorkGraph || null,
    planningWorkGraph: workGraph,
    priorExpansionDigests: currentState.priorExpansionDigests || []
  });
  const status = blockers.length ? 'blocked' : 'planned';
  return {
    schemaVersion: AGENT_WORK_PHASE4_PLANNING_PACKET_SCHEMA,
    generatedAt: nowIso(),
    phase: 'phase_4_objective_planning_inventories_expansion',
    status,
    compileAllowed: blockers.length === 0,
    runRoot: runRoot ? path.resolve(runRoot) : null,
    objective: normalized,
    adapters: {
      target: {
        ok: implementationAdapter.ok,
        status: implementationAdapter.status,
        repoPath: implementationAdapter.repoPath || normalized.targetPath || null,
        deterministicDigest: implementationAdapter.deterministicDigest,
        fallbackReason: implementationAdapter.fallbackReason || null
      },
      reference: {
        ok: referenceAdapter.ok,
        status: referenceAdapter.status,
        repoPath: referenceAdapter.repoPath || normalized.referencePath || null,
        deterministicDigest: referenceAdapter.deterministicDigest,
        sourceRequiredForFullClone: normalized.fidelity === 'full_clone'
      }
    },
    referenceInventory: referenceAdapter.inventory,
    implementationInventory: implementationAdapter.inventory,
    parity: parityResult ? {
      parityMatrix: parityResult.parityMatrix,
      negativeSpace: parityResult.negativeSpace,
      verifierMatrix: parityResult.verifierMatrix,
      supervisorTruth: parityResult.supervisorTruth,
      claimPacket: parityResult.claimPacket
    } : null,
    parityError,
    planningNegativeSpace: {
      schemaVersion: 'clawd.agent_work.phase4_negative_space.v1',
      generatedAt: nowIso(),
      rowCount: negativeSpaceRows.length,
      rows: negativeSpaceRows
    },
    workGraph,
    workforcePlan,
    decompositionWorkforcePlan,
    concurrency,
    planReview: reviewPacket,
    continuationPolicy,
    blockers,
    truthBoundary: 'Phase 4 proves objective-bound inventories, negative-space planning, verifier-backed work graph generation, admitted-surface workforce sizing, continuation policy, and plan-review digest binding. Decomposition capacity is separate from launch count, and neither is physical-concurrency proof.'
  };
}

export function writeAgentWorkPlanningArtifacts(packet, artifactRoot) {
  if (!artifactRoot) throw new Error('artifactRoot is required');
  const root = path.resolve(artifactRoot);
  const dir = path.join(root, 'phase4_planning');
  const files = {
    planningPacket: writeJson(path.join(root, 'phase4_planning_packet.json'), packet),
    planReviewPacket: writeJson(path.join(root, 'plan_review_packet.json'), packet.planReview),
    planningQualificationPacket: writeJson(path.join(dir, 'planning_qualification_packet.json'), packet),
    objectiveContract: writeJson(path.join(dir, 'objective_contract.json'), packet.objective),
    referenceInventory: packet.referenceInventory ? writeJson(path.join(dir, 'reference_inventory.json'), packet.referenceInventory) : null,
    implementationInventory: packet.implementationInventory ? writeJson(path.join(dir, 'implementation_inventory.json'), packet.implementationInventory) : null,
    negativeSpaceInventory: writeJson(path.join(dir, 'negative_space_inventory.json'), packet.planningNegativeSpace),
    workGraph: writeJson(path.join(dir, 'verifier_backed_work_graph.json'), packet.workGraph),
    semanticWorkforcePlan: writeJson(path.join(root, 'semantic_workforce_plan.json'), packet.workforcePlan),
    phase4SemanticWorkforcePlan: writeJson(path.join(dir, 'semantic_workforce_plan.json'), packet.workforcePlan),
    decompositionWorkforcePlan: writeJson(path.join(dir, 'decomposition_workforce_plan.json'), packet.decompositionWorkforcePlan),
    continuationPolicy: writeJson(path.join(dir, 'continuation_policy.json'), packet.continuationPolicy),
    planReview: writeJson(path.join(dir, 'plan_review_packet.json'), packet.planReview),
    parityMatrix: packet.parity?.parityMatrix ? writeJson(path.join(dir, 'parity_matrix.json'), packet.parity.parityMatrix) : null,
    verifierMatrix: packet.parity?.verifierMatrix ? writeJson(path.join(dir, 'verifier_matrix.json'), packet.parity.verifierMatrix) : null,
    supervisorTruth: packet.parity?.supervisorTruth ? writeJson(path.join(dir, 'supervisor_truth.json'), packet.parity.supervisorTruth) : null,
    claimPacket: packet.parity?.claimPacket ? writeJson(path.join(dir, 'claim_packet.json'), packet.parity.claimPacket) : null
  };
  const manifest = {
    schemaVersion: 'clawd.agent_work.phase4_artifact_manifest.v1',
    generatedAt: nowIso(),
    files: Object.fromEntries(Object.entries(files)
      .filter(([, file]) => Boolean(file))
      .map(([key, file]) => [key, { path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }]))
  };
  files.artifactManifest = writeJson(path.join(dir, 'artifact_manifest.json'), manifest);
  return files;
}

export function approvePlanReviewPacket(planReviewPacket, { approvedBy = 'operator', approvedPlanDigest = null } = {}) {
  const digestToApprove = clean(approvedPlanDigest || planReviewPacket?.planDigest);
  return {
    ...planReviewPacket,
    generatedAt: nowIso(),
    approvalStatus: digestToApprove && digestToApprove === planReviewPacket?.planDigest ? 'approved' : 'rejected_digest_mismatch',
    approvedPlanDigest: digestToApprove || null,
    approvedBy: digestToApprove && digestToApprove === planReviewPacket?.planDigest ? clean(approvedBy) : null
  };
}

export function planReviewApprovalIsBound(planReviewPacket = {}) {
  return planReviewPacket.approvalStatus === 'approved'
    && clean(planReviewPacket.approvedPlanDigest)
    && planReviewPacket.approvedPlanDigest === planReviewPacket.planDigest;
}
