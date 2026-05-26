import {
  HIERARCHICAL_WORK_PLANNING_VERSION,
  bindHierarchicalPlanToWorkUnits,
  buildHierarchicalWorkPlan,
  deriveHierarchicalReplanDirectives as deriveSharedHierarchicalReplanDirectives
} from '../../../large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs';

export const STRICT_HIERARCHICAL_PLANNING_VERSION = HIERARCHICAL_WORK_PLANNING_VERSION;

const MAILCHIMP_COMPAT_FEATURES = Object.freeze([
  'negative_space_inventory_per_surface',
  'anti_noop_replan_microsteps',
  'target_file_role_weave',
  'primary_runtime_adoption_gate',
  'proof_node_completion_contracts',
  'proof_carrying_plan_ledger',
  'counterfactual_plan_twins'
]);

function uniq(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function slug(value = 'node') {
  return String(value || 'node')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'node';
}

function focusIdForGap(gap = {}) {
  const raw = String(gap.focusId || gap.id || '').trim();
  if (!raw) return null;
  return raw.startsWith('focus.') ? raw.replace(/(?:#|::).+$/, '') : `focus.${slug(raw)}`;
}

function surfaceMatrixFromGaps(gaps = []) {
  return {
    surfaces: (Array.isArray(gaps) ? gaps : []).map((gap) => {
      const focusId = focusIdForGap(gap);
      const id = slug(gap.id || focusId || gap.title || 'surface');
      return {
        id,
        label: gap.title || id,
        issueIds: uniq([focusId, gap.id, gap.focusId, `focus.${id}`]),
        requiredArtifacts: uniq(gap.requiredArtifacts || []),
        candidateAreas: uniq(gap.candidateAreas || [])
      };
    })
  };
}

function strictOptions(overrides = {}) {
  return {
    objectiveId: overrides.objectiveId || 'strict_hierarchical_agent_orchestration_plan',
    objectiveTitle: overrides.objectiveTitle || 'Strict hierarchical agent-orchestration objective',
    requestedFidelity: overrides.requestedFidelity || 'full_clone',
    inputRefName: 'strictHierarchicalPlanPolicy',
    metadataKey: 'strictHierarchicalPlanning',
    novelPlannerFeatures: MAILCHIMP_COMPAT_FEATURES,
    policy: {
      sourceOfTruth: 'Plan nodes, not activity/LOC/worker count, determine completion eligibility.',
      completionRule: 'A work unit can only be credited when its implementation_step and proof_gate have surviving product diff plus verifier evidence.',
      replanRule: 'Zero-diff, marker-only, or verifier-failed nodes must be split into smaller primary-runtime microplans before retry.',
      noShortcutRule: 'Docs/scripts/tests-only changes are scaffolding and cannot satisfy product implementation nodes.'
    },
    replanActions: {
      zeroSurvivingDiff: 'split_to_primary_runtime_microplan',
      markerOnly: 'reject_and_require_runtime_behavior',
      verifierFailure: 'localize_to_failing_contract'
    }
  };
}

export function buildStrictHierarchicalPlan({
  objectiveId = 'mailchimp_full_clone_hierarchical_build_plan',
  targetPath = null,
  requestedFidelity = 'full_clone',
  gaps = [],
  workUnits = [],
  mode = 'strict_gap_inventory',
  continuationWaveIndex = null,
  rolePlan = null,
  generatedAt = new Date().toISOString()
} = {}) {
  const options = strictOptions({ objectiveId, requestedFidelity });
  const plan = buildHierarchicalWorkPlan({
    objective: {
      id: objectiveId,
      title: 'Strict hierarchical agent-orchestration objective',
      targetPath,
      requestedFidelity
    },
    workGraph: {
      targetPath,
      objectiveId,
      workUnits: Array.isArray(workUnits) ? workUnits : []
    },
    surfaceMatrix: surfaceMatrixFromGaps(gaps),
    options
  });
  return {
    ...plan,
    generatedAt,
    mode,
    continuationWaveIndex,
    rolePlan,
    aspects: plan.stages,
    summary: {
      ...plan.summary,
      novelPlannerFeatures: MAILCHIMP_COMPAT_FEATURES
    },
    policy: options.policy
  };
}

export function bindStrictHierarchicalPlanToWorkUnits(workUnits = [], plan = {}) {
  const bound = bindHierarchicalPlanToWorkUnits(workUnits, plan, strictOptions());
  return bound.map((unit) => {
    const planning = unit.metadata?.strictHierarchicalPlanning;
    if (!planning) return unit;
    const acceptanceChecks = uniq([...(unit.acceptanceChecks || [])]).map((check) => check.replace('Follow hierarchical plan node', 'Follow strict hierarchical plan node'));
    const assignmentContract = unit.metadata?.assignmentContract
      ? {
          ...unit.metadata.assignmentContract,
          successPredicate: uniq([...(unit.metadata.assignmentContract.successPredicate || []), ...acceptanceChecks])
            .map((predicate) => predicate.replace('Follow hierarchical plan node', 'Follow strict hierarchical plan node'))
        }
      : null;
    return {
      ...unit,
      acceptanceChecks,
      metadata: {
        ...(unit.metadata || {}),
        ...(assignmentContract ? { assignmentContract } : {}),
        strictHierarchicalPlanning: {
          ...planning,
          aspectId: planning.stageId,
          targetWeave: planning.targetFileRoleWeave
        }
      }
    };
  });
}

export function deriveHierarchicalReplanDirectives({ plan = {}, failedWorkUnitIds = [], failureKind = 'zero_surviving_product_diff' } = {}) {
  return deriveSharedHierarchicalReplanDirectives({
    hierarchicalPlan: plan,
    failedWorkUnitIds,
    failureKind,
    options: strictOptions()
  }).map((directive) => ({
    ...directive,
    aspectId: directive.stageId,
    focusId: directive.surfaceIds?.[0] ? `focus.${slug(directive.surfaceIds[0]).replace(/^focus_/, '')}` : null,
    surfaceId: directive.surfaceIds?.[0] || null
  }));
}
