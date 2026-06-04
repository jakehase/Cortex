import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFailurePlan,
  buildMailchimpParityFocusWorkGraph,
  canonicalizeFocusId,
  extractSuspectFocusIdsFromPatchQueue,
  extractVerifiedFocusIdsFromPatchQueue,
  fullCloneObjectiveInventory,
  MAILCHIMP_PARITY_FOCUS_IDS,
  remainingParityFocusIds,
  remediationLeafUnitAlreadySatisfied,
  selectNonOverlappingFocusIds,
  objectiveCreditFocusIds,
  strictGapAlreadySatisfied
} from '../scripts/lib/orchestrator-real-repo-clean-plan.mjs';
import { deriveHierarchicalReplanDirectives } from '../scripts/lib/strict-hierarchical-planner.mjs';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN } from '../scripts/lib/mailchimp-canonical-one-pass-plan-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_SOURCE = fs.readFileSync(path.join(ROOT, 'scripts/lib/orchestrator-real-repo-clean-plan.mjs'), 'utf8');

function withTemporarySatisfactionMarkers(fn) {
  const markersByFile = new Map([
    ['packages/app/view.mjs', [
      'signupOnboardingChecklistItems',
      'signupOnboardingCard',
      'Set sender profile',
      'Invite teammates'
    ]],
    ['packages/app/routes/public.mjs', [
      "router.register('GET', '/signup/checklist'"
    ]],
    ['packages/app/routes/platform.mjs', [
      "router.register('GET', '/onboarding'",
      'signupOnboardingCard(actor',
      'workspaceSwitcher(actor)',
      'Next best actions'
    ]]
  ]);
  const backups = [];
  for (const [relativePath, markers] of markersByFile) {
    const absolutePath = path.join(ROOT, relativePath);
    const original = fs.readFileSync(absolutePath, 'utf8');
    backups.push([absolutePath, original]);
    fs.writeFileSync(absolutePath, `${original}\n/* temporary test satisfaction markers: ${markers.join(' | ')} */\n`);
  }
  try {
    return fn();
  } finally {
    for (const [absolutePath, original] of backups.reverse()) fs.writeFileSync(absolutePath, original);
  }
}

function withTemporaryStrictGapInventory(gaps, fn) {
  const inventoryPath = path.join(ROOT, 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json');
  const original = fs.readFileSync(inventoryPath, 'utf8');
  fs.writeFileSync(inventoryPath, JSON.stringify({ gaps }, null, 2));
  try {
    return fn();
  } finally {
    fs.writeFileSync(inventoryPath, original);
  }
}

test('canonical one-pass plan productFiles all bind to real product surfaces', () => {
  const repoRoot = ROOT;
  const missing = [];
  for (const surface of MAILCHIMP_CANONICAL_ONE_PASS_PLAN.surfaceChecklist) {
    for (const productFile of surface.productFiles || []) {
      if (!fs.existsSync(path.join(repoRoot, productFile))) {
        missing.push({ id: surface.id, productFile });
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('shared objective expansion fallback requires executable product-runtime work units', () => {
  assert.match(PLAN_SOURCE, /function hasExecutableProductRuntimeContract\(unit = \{\}\)/);
  assert.match(PLAN_SOURCE, /assignment\.artifactKind === 'product_diff'/);
  assert.match(PLAN_SOURCE, /isExecutableProductRuntimeFile\(filePath\)/);
  assert.match(PLAN_SOURCE, /workUnits = adaptedExpansionUnits\.filter\(\(unit\) => hasExecutableProductRuntimeContract\(unit\)\)/);
  assert.match(PLAN_SOURCE, /droppedNonExecutableWorkUnitCount/);
});

test('strict gap targeted test selection never points a worker at a missing test file', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const inventory = fullCloneObjectiveInventory();
  const campaignOpsIndex = inventory.findIndex((gap) => gap.id === 'campaign_ops_calendar_workflow');
  assert.ok(campaignOpsIndex > 0, 'campaign ops strict gap should exist in the inventory');
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = inventory
    .slice(0, campaignOpsIndex)
    .map((gap) => `focus.${gap.id}`)
    .join(',');
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    const unit = graph.workGraph.workUnits[0];
    assert.equal(unit.metadata.surfaceId, 'campaign_ops_calendar_workflow');
    assert.notEqual(unit.metadata.testFile, 'tests/current-product-ops.test.mjs');
    assert.ok(fs.existsSync(path.join(ROOT, unit.metadata.testFile)), `${unit.metadata.testFile} should exist`);
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
  }
});

test('production-slice continuous run expands targeted strict gaps into real semantic product work', () => {
  const prev = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    agents: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    productOnly: process.env.MAILCHIMP_PRODUCT_ONLY,
    director: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    targets: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    verified: process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS,
    excluded: process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS
  };
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'production_slice';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_PRODUCT_ONLY = '1';
  process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = '';
  process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS = [
    'focus.account_workspace_setup',
    'focus.settings_domains',
    'focus.signup_onboarding',
    'focus.reports_overview',
    'focus.report_detail',
    'focus.campaign_wizard',
    'focus.email_builder',
    'focus.send_schedule_review',
    'focus.automation_journey_builder',
    'focus.audience_overview',
    'focus.contacts_table',
    'focus.contact_profile',
    'focus.segments',
    'focus.tags_groups_interests'
  ].join(',');
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.semanticDirector.enabled, true);
    assert.equal(graph.workGraph.summary.semanticDirector.active, true);
    assert.equal(graph.workGraph.summary.semanticDirector.reason, 'targeted_focus_expansion');
    assert.ok(graph.workGraph.workUnits.length >= 20, `expected targeted semantic product work, got ${graph.workGraph.workUnits.length}`);
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.some((filePath) => filePath.startsWith('packages/app/'))));
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: prev.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: prev.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: prev.profile,
      ORCHESTRATOR_REQUESTED_FIDELITY: prev.fidelity,
      MAILCHIMP_REQUESTED_AGENT_COUNT: prev.agents,
      MAILCHIMP_PRODUCT_ONLY: prev.productOnly,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: prev.director,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: prev.targets,
      MAILCHIMP_COMPLETED_FOCUS_IDS: prev.completed,
      MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: prev.verified,
      MAILCHIMP_EXCLUDED_FOCUS_IDS: prev.excluded
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


function withStrictGapSequence(completedFocusIds, fn) {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = completedFocusIds;
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  try {
    return fn(buildMailchimpParityFocusWorkGraph());
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
  }
}

test('strict gap inventory mode starts with the first canonical Mailchimp surface in sequence mode', () => {
  withStrictGapSequence('', (graph) => {
    assert.equal(graph.workGraph.profile, 'mailchimp_strict_gap_inventory');
    assert.equal(graph.workGraph.summary.strictGapSequenceMode, true);
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.signup_onboarding');
    assert.equal(graph.workGraph.workUnits[0].metadata.assignmentContract.artifactKind, 'product_diff');
    assert.ok(graph.workGraph.workUnits[0].metadata.assignmentContract.targetFiles.length >= 1);
    assert.deepEqual(graph.workGraph.workUnits[0].metadata.assignmentContract.verifierRequirements, ['tests']);
  });
});

test('strict gap inventory mode advances through completed canonical Mailchimp surfaces', () => {
  withStrictGapSequence('focus.signup_onboarding', (graph) => {
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.account_workspace_setup');
    assert.ok(graph.workGraph.workUnits[0].allowedFiles.includes('packages/app/routes/platform.mjs'));
  });
  withStrictGapSequence('focus.signup_onboarding,focus.account_workspace_setup,focus.dashboard_home', (graph) => {
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.audience_overview');
    assert.ok(graph.workGraph.workUnits[0].allowedFiles.includes('packages/app/domain-audience.mjs'));
  });
});

test('strict gap inventory mode credits mechanically satisfied product surfaces instead of replaying no-op shards', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '0';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'parity_for_scope';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  try {
    withTemporarySatisfactionMarkers(() => withTemporaryStrictGapInventory([
      { id: 'signup_onboarding', label: 'Signup and onboarding wizard', lane: 'wave_1_core_funnel_and_audience' },
      { id: 'account_workspace_setup', label: 'Account workspace setup', lane: 'wave_1_core_funnel_and_audience' }
    ], () => {
      const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json'), 'utf8'));
      const unsatisfied = inventory.gaps.map((gap) => gap.id).filter((id) => !strictGapAlreadySatisfied(id));
      assert.deepEqual(unsatisfied, []);
      const graph = buildMailchimpParityFocusWorkGraph();
      assert.equal(graph.surfaceMatrix.status, 'all_complete');
      assert.equal(graph.workGraph.workUnits.length, 0);
      assert.ok(graph.surfaceMatrix.surfaces.every((surface) => surface.status === 'product_satisfied'));
    }));
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
  }
});

test('strict gap inventory does not credit mechanically satisfied surfaces as full-clone complete', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '0';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.surfaceMatrix.status, 'partial');
    assert.ok(graph.workGraph.workUnits.length > 0);
    assert.ok(graph.surfaceMatrix.surfaces.every((surface) => surface.status !== 'product_satisfied'));
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
  }
});

test('full-clone strict inventory appends broad objective surfaces after the finite 26-gap ceiling', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevExcluded = process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = 'focus.api_keys_webhooks';
  try {
    const inventory = fullCloneObjectiveInventory();
    assert.ok(inventory.length > 26, 'expected broad full-clone objectives beyond the strict 26-gap inventory');
    assert.ok(inventory.some((gap) => gap.id === 'frontend_client_shell_state'));
    const strictIds = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json'), 'utf8')).gaps.map((gap) => `focus.${gap.id}`);
    process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = strictIds.filter((id) => id !== 'focus.api_keys_webhooks').join(',');
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.profile, 'mailchimp_strict_gap_inventory');
    assert.equal(graph.workGraph.summary.broadFullCloneObjectiveCount > 0, true);
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.frontend_client_shell_state');
    assert.equal(graph.workGraph.workUnits[0].metadata.broadFullCloneObjective, true);
    assert.ok(graph.workGraph.workUnits[0].allowedFiles.includes('apps/web/public/app-shell.jsx'));
    const excludedSurface = graph.surfaceMatrix.surfaces.find((surface) => surface.focusId === 'focus.api_keys_webhooks');
    assert.equal(excludedSurface.status, 'excluded_until_repaired');
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevExcluded === undefined) delete process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS; else process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = prevExcluded;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
  }
});

test('full-clone 100-agent swarm overrides strict sequence into many executable leaf shards with role plan', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.swarmMode, true);
    assert.equal(graph.workGraph.summary.strictGapSequenceMode, false);
    assert.equal(graph.workGraph.summary.requestedAgentCount, 100);
    assert.ok(graph.workGraph.summary.allSwarmLeafCount >= 80, '100-agent full-clone run should have swarm-sized executable product shards');
    assert.equal(graph.workGraph.workUnits.length + graph.workGraph.summary.saturatedSwarmLeafCount, graph.workGraph.summary.totalSwarmLeafCount, 'saturated swarm leaf modules should be credited instead of replayed as no-op shards');
    assert.ok(graph.workGraph.summary.rolePlan.implementers > graph.workGraph.summary.rolePlan.planners);
    assert.ok(graph.workGraph.summary.rolePlan.verifiers >= 8);
    if (graph.workGraph.workUnits.length > 0) {
      const sourceBackedApiKeyUnits = graph.workGraph.workUnits.filter((unit) => unit.metadata.surfaceFocusId === 'api_keys_webhooks' && unit.metadata.sourceBackedSwarmLeaf === true);
      const isolatedLeafUnits = graph.workGraph.workUnits.filter((unit) => !(unit.metadata.surfaceFocusId === 'api_keys_webhooks' && unit.metadata.sourceBackedSwarmLeaf === true));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.swarmRole === 'implementer'));
      assert.ok(isolatedLeafUnits.every((unit) => unit.allowedFiles.length === 1));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles[0].startsWith('packages/app/full-clone-swarm/')), 'swarm leaves should target unique product modules instead of colliding on the same source files');
      assert.equal(new Set(graph.workGraph.workUnits.map((unit) => unit.allowedFiles[0])).size, graph.workGraph.workUnits.length, 'swarm leaf product modules should be unique per executable shard');
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.sourceProductFile && unit.metadata.sourceProductFile !== unit.allowedFiles[0]), 'swarm leaves should retain the source product grounding separately from their unique output module');
      assert.ok(isolatedLeafUnits.every((unit) => unit.metadata.importFile === unit.allowedFiles[0]), 'imports verifier should target the generated leaf product module for isolated leaves');
      assert.ok(sourceBackedApiKeyUnits.every((unit) => unit.allowedFiles.includes(unit.metadata.sourceProductFile)), 'api key/webhook swarm repair should admit the source product runtime as a landing target');
      assert.ok(sourceBackedApiKeyUnits.every((unit) => unit.metadata.importFile === unit.metadata.sourceProductFile), 'api key/webhook source-backed leaves should import-check the existing runtime instead of a generated leaf');
      assert.ok(sourceBackedApiKeyUnits.every((unit) => unit.metadata.assignmentContract?.targetFiles?.includes(unit.metadata.sourceProductFile)), 'api key/webhook assignment contract should allow surviving source-runtime product diffs');
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.requiredVerifiers.includes('lint') && unit.requiredVerifiers.includes('imports') && unit.requiredVerifiers.includes('tests')), 'swarm leaves need non-skipped verifier evidence beyond tests');
      assert.ok(graph.workGraph.workUnits.every((unit) => !unit.title.includes('undefined')), 'swarm leaf titles should be grounded in the source file name');
      assert.ok(graph.workGraph.workUnits.some((unit) => /#\d+$/.test(unit.id)));
    } else {
      assert.equal(graph.workGraph.summary.allSaturatedSwarmLeafCount, graph.workGraph.summary.allSwarmLeafCount, 'a saturated swarm should credit all generated leaf modules instead of replaying no-op shards');
    }
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
  }
});

test('full-clone structural expansion emits a fresh unsaturated product work graph after finite swarm leaves saturate', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.swarmMode, true);
    assert.equal(graph.workGraph.summary.structuralMode, true);
    assert.equal(graph.workGraph.summary.requestedAgentCount, 100);
    assert.ok(graph.workGraph.summary.allStructuralLeafCount >= 80, 'structural full-clone expansion should be large enough for a 100-agent wave');
    assert.equal(graph.workGraph.summary.allExecutableLeafCount, graph.workGraph.summary.allStructuralLeafCount);
    if (graph.workGraph.workUnits.length > 0) {
      assert.ok(graph.workGraph.workUnits.length >= 80, 'structural expansion should create fresh runnable work rather than saturated no-op shards');
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.length === 1));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles[0].startsWith('packages/app/full-clone-structural/')));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.structuralLeafId && unit.metadata.structuralPhaseId));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.importFile === unit.allowedFiles[0]));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.requiredVerifiers.includes('lint') && unit.requiredVerifiers.includes('imports')));
    } else {
      assert.equal(graph.workGraph.summary.allSaturatedStructuralLeafCount, graph.workGraph.summary.allStructuralLeafCount, 'a saturated structural expansion should be credited rather than replayed as no-op shards');
    }
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
  }
});

test('full-clone frontier expansion reopens runnable product shards after structural leaves saturate', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.swarmMode, true);
    assert.equal(graph.workGraph.summary.structuralMode, true);
    assert.equal(graph.workGraph.summary.frontierMode, true);
    assert.ok(graph.workGraph.summary.allFrontierLeafCount >= 80, 'frontier expansion should be large enough for a 100-agent wave');
    assert.equal(graph.workGraph.summary.allExecutableLeafCount, graph.workGraph.summary.allFrontierLeafCount);
    if (graph.workGraph.workUnits.length > 0) {
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.length === 1));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles[0].startsWith('packages/app/full-clone-frontier/')));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.frontierLeafId && unit.metadata.structuralLeafId && unit.metadata.structuralPhaseId));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.frontierFullClone === true));
      assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.importFile === unit.allowedFiles[0]));
    } else {
      assert.equal(graph.workGraph.summary.allSaturatedFrontierLeafCount, graph.workGraph.summary.allFrontierLeafCount, 'a saturated frontier should be credited rather than replayed as no-op shards');
    }
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
  }
});

test('full-clone remediation expansion reopens a broader remaining-work matrix after frontier leaves saturate', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  const prevRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.swarmMode, true);
    assert.equal(graph.workGraph.summary.structuralMode, true);
    assert.equal(graph.workGraph.summary.frontierMode, true);
    assert.equal(graph.workGraph.summary.remediationMode, true);
    assert.ok(graph.workGraph.summary.allRemediationLeafCount >= 100, 'remediation expansion should create a broader remaining-work matrix than the previous frontier wave');
    assert.equal(graph.workGraph.summary.allExecutableLeafCount, graph.workGraph.summary.allRemediationLeafCount);
    assert.ok(graph.workGraph.workUnits.length > 0, 'existing isolated remediation modules must not saturate adoption-mode work');
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.length >= 1));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.every((filePath) => !filePath.startsWith('packages/app/full-clone-remediation/'))), 'remediation work must target primary runtime adoption files, not isolated generated leaf modules');
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.remediationLeafId && unit.metadata.remediationFullClone === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.primaryProductAdoptionRequired === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.remediationModulePath?.startsWith('packages/app/full-clone-remediation/')));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.includes(unit.metadata.importFile)));
    assert.ok(graph.workGraph.workUnits.every((unit) => !unit.metadata.assignmentContract.targetFiles.some((filePath) => filePath.startsWith('packages/app/full-clone-remediation/'))));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.assignmentContract.artifactKind === 'product_diff'));
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
    if (prevRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = prevRemediation;
  }
});

test('full-clone remediation expansion deepens into strict inventory gaps after broad objective remediation saturates', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  const prevRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION;
  const prevStrictRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = '1';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.remediationMode, true);
    assert.equal(graph.workGraph.summary.strictInventoryRemediationMode, true);
    assert.ok(graph.workGraph.summary.strictInventoryRemediationObjectiveCount >= 26, 'strict inventory gaps should become remediation objectives instead of staying credited by old swarm leaves');
    assert.ok(graph.workGraph.summary.allRemediationLeafCount >= graph.workGraph.summary.strictInventoryRemediationObjectiveCount * 20, 'strict remediation must include a second Mailchimp-scale continuation depth after the first ten runtime slices saturate');
    assert.ok(graph.workGraph.summary.allRemediationLeafCount > 760, 'remediation inventory should expand beyond the first broad+strict remediation wave instead of returning zero work');
    const signup = graph.surfaceMatrix.surfaces.find((surface) => surface.focusId === 'focus.signup_onboarding');
    assert.ok(signup, 'strict inventory signup/onboarding gap should stay represented in the surface matrix');
    assert.notEqual(signup.status, 'swarm_leaf_satisfied', 'strict inventory gaps must not be treated as terminally complete from old swarm saturation while full-clone parity is still red');
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
    if (prevRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = prevRemediation;
    if (prevStrictRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = prevStrictRemediation;
  }
});

test('full-clone continuation expansion reopens runnable shards after remediation saturation', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  const prevRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION;
  const prevStrictRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION;
  const prevContinuation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = '1';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.ok(graph.workGraph.summary.continuationWaveIndex >= 1);
    assert.ok(graph.workGraph.summary.allContinuationLeafCount >= 100, 'continuation should reopen a 100-agent-sized product graph');
    assert.ok(graph.workGraph.workUnits.length > 0, 'continuation expansion must prevent strict full-clone red from becoming zero runnable work');
    const continuationWave = String(graph.workGraph.summary.continuationWaveIndex).padStart(3, '0');
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.id.includes(`::continuation-${continuationWave}#`)));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.continuationFullClone === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.structuralPhaseId.startsWith(`continuation_wave_${continuationWave}_`)));
    assert.equal(graph.surfaceMatrix.status, 'partial');
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
    if (prevRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = prevRemediation;
    if (prevStrictRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = prevStrictRemediation;
    if (prevContinuation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = prevContinuation;
  }
});

test('semantic work director replaces saturated continuation leaves with primary-runtime architecture frontier work', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  const prevRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION;
  const prevStrictRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION;
  const prevContinuation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION;
  const prevSemantic = process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR;
  const prevForce = process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE;
  const prevSkipAdoptedPhases = process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES;
  const prevTargets = process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS;
  const prevMaxGaps = process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR = '1';
  process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE = '1';
  process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES = '0';
  process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS = '';
  process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS = '26';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.equal(graph.workGraph.summary.semanticDirector.enabled, true);
    assert.equal(graph.workGraph.summary.semanticDirector.active, true);
    assert.equal(graph.workGraph.summary.semanticDirector.reason, 'forced');
    assert.equal(graph.workGraph.summary.semanticDirector.selectedGapCount, 26);
    assert.equal(graph.workGraph.summary.semanticDirector.phaseCount, 4);
    assert.ok(graph.workGraph.workUnits.length > 0);
    assert.ok(graph.workGraph.workUnits.length <= 104);
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.some((filePath) => /^(apps|packages)\//.test(filePath))), 'semantic director units should stay bound to product runtime files');
    assert.ok(graph.globalInputs.semanticObjectiveDirectorPolicy.includes('Mailchimp-grade architecture'));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.id.includes('::semantic-frontier-')));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.inputRefs.includes('semanticObjectiveDirectorPolicy')));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.semanticDirector === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.architectureFrontier === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.primaryProductAdoptionRequired === true));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.length >= 2));
    const operationalPersistenceUnits = graph.workGraph.workUnits.filter((unit) => unit.metadata.semanticPhaseId === 'operational_persistence_and_jobs');
    assert.ok(operationalPersistenceUnits.length > 0, 'semantic director should emit operational persistence/jobs shards');
    assert.ok(operationalPersistenceUnits.every((unit) => unit.allowedFiles.some((filePath) => /packages\/app\/(?:jobs|job-runtime|job-handlers)\.mjs$/.test(filePath))), 'operational persistence/jobs shards must include a jobs_runtime target file');
    const signupOnboardingPrimarySpineUnits = graph.workGraph.workUnits.filter((unit) => unit.id.startsWith('focus.signup_onboarding::semantic-frontier-') && unit.metadata.semanticPhaseId === 'primary_runtime_spine');
    assert.ok(signupOnboardingPrimarySpineUnits.length > 0, 'semantic director should emit signup onboarding primary spine work');
    assert.ok(signupOnboardingPrimarySpineUnits.every((unit) => unit.allowedFiles.some((filePath) => /packages\/app\/(?:storage|persistence-io)\.mjs$/.test(filePath))), 'signup onboarding primary spine must include a domain/persistence adoption file');
    const settingsDomainsUserPathUnits = graph.workGraph.workUnits.filter((unit) => unit.id.startsWith('focus.settings_domains::semantic-frontier-') && unit.metadata.semanticPhaseId === 'integrated_user_path_evidence');
    assert.ok(settingsDomainsUserPathUnits.length > 0, 'semantic director should emit settings/domain integrated user-path work');
    assert.ok(settingsDomainsUserPathUnits.every((unit) => unit.allowedFiles.includes('packages/app/domain-deliverability-compliance.mjs')), 'settings/domain user-path work must include a domain/persistence layer, not only API/platform routes');
    const reportsOverviewUserPathUnits = graph.workGraph.workUnits.filter((unit) => unit.id.startsWith('focus.reports_overview::semantic-frontier-') && unit.metadata.semanticPhaseId === 'integrated_user_path_evidence');
    assert.ok(reportsOverviewUserPathUnits.length > 0, 'semantic director should emit reports overview integrated user-path work');
    assert.ok(reportsOverviewUserPathUnits.every((unit) => unit.allowedFiles.some((filePath) => /packages\/app\/domain-(?:growth|commerce-revenue)\.mjs$/.test(filePath))), 'reports overview user-path work must include a domain layer, not only report/API routes');
    const architectureLayerForTest = (filePath) => /apps\/web\/public|app-shell|view\.mjs|public\.mjs/.test(filePath)
      ? 'client_shell'
      : /\/routes\//.test(filePath) || /server\.mjs|http-runtime\.mjs/.test(filePath)
        ? 'route_or_server'
        : /domain-|storage\.mjs|persistence-io\.mjs/.test(filePath)
          ? 'domain_or_persistence'
          : /job-|jobs\.mjs|job-runtime|job-handlers/.test(filePath)
            ? 'jobs_runtime'
            : 'product_runtime';
    const requiredLayersByPhase = {
      primary_runtime_spine: ['route_or_server', 'domain_or_persistence'],
      interactive_state_and_commands: ['client_shell', 'route_or_server'],
      operational_persistence_and_jobs: ['domain_or_persistence', 'jobs_runtime'],
      integrated_user_path_evidence: ['route_or_server', 'domain_or_persistence']
    };
    for (const unit of graph.workGraph.workUnits) {
      const layers = new Set(unit.allowedFiles.map(architectureLayerForTest));
      for (const layer of requiredLayersByPhase[unit.metadata.semanticPhaseId] || []) {
        assert.ok(layers.has(layer), `${unit.id} should include ${layer} target coverage for architecture admission`);
      }
    }
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.allowedFiles.every((filePath) => !filePath.startsWith('packages/app/full-clone-'))));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.requiredVerifiers.includes('lint') && unit.requiredVerifiers.includes('imports')));
    assert.ok(graph.surfaceMatrix.surfaces.some((surface) => surface.status === 'semantic_frontier_active'));
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
    if (prevRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = prevRemediation;
    if (prevStrictRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = prevStrictRemediation;
    if (prevContinuation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = prevContinuation;
    if (prevSemantic === undefined) delete process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR; else process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR = prevSemantic;
    if (prevForce === undefined) delete process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE; else process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE = prevForce;
    if (prevSkipAdoptedPhases === undefined) delete process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES; else process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES = prevSkipAdoptedPhases;
    if (prevTargets === undefined) delete process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS; else process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS = prevTargets;
    if (prevMaxGaps === undefined) delete process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS; else process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS = prevMaxGaps;
  }
});

test('semantic work director skips already completed focus roots during broad continuation reruns', () => {
  const envSnapshot = {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    MAILCHIMP_STRICT_GAP_SEQUENCE: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    ORCHESTRATOR_REQUESTED_FIDELITY: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    MAILCHIMP_COMPLETED_FOCUS_IDS: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    MAILCHIMP_REQUESTED_AGENT_COUNT: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION,
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE,
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES,
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS,
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '1',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_COMPLETED_FOCUS_IDS: 'focus.ai_predictive_ops_realism,focus.audience_identity_lifecycle',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: '0',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: '',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: '12'
  });
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.semanticDirector.active, true);
    const completedRoots = ['focus.ai_predictive_ops_realism', 'focus.audience_identity_lifecycle'];
    assert.ok(graph.workGraph.workUnits.length > 0);
    assert.ok(graph.workGraph.workUnits.every((unit) => completedRoots.every((root) => !unit.id.startsWith(`${root}::`))), 'completed roots should not be immediately replayed by broad semantic continuation');
    assert.ok(graph.workGraph.summary.semanticDirector.selectedFocusIds.every((focusId) => !completedRoots.includes(focusId)));
    assert.ok(graph.workGraph.summary.semanticDirector.selectedFocusIds.some((focusId) => focusId === 'focus.frontend_client_shell_state' || focusId === 'focus.website_builder_editor_realism'));
  } finally {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('contract-scoped generic product run expands candidateAreas into executable product work instead of strict-gap scaffolding', () => {
  const prevUseStrict = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevUseBenchmark = process.env.MAILCHIMP_USE_BENCHMARK_SCOPE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevProductOnly = process.env.MAILCHIMP_PRODUCT_ONLY;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevContract = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'mailchimp-contract-scoped-generic-test-'));
  const contractPath = path.join(tempDir, 'contract-scoped-generic.json');
  fs.writeFileSync(contractPath, JSON.stringify({
    benchmarkId: 'mailchimp_contract_scoped_generic_product_gate',
    scope: {
      surfaces: [
        {
          id: 'frontend_interaction_parity',
          label: 'Frontend interaction parity',
          lane: 'frontend',
          allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/platform.mjs'],
          verification: ['node --test tests/current-product-browser-realism.test.mjs']
        },
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `generic_product_surface_${index + 1}`,
          label: `Generic product surface ${index + 1}`,
          lane: 'generic_product',
          allowedFiles: [`packages/app/generic-product-surface-${index + 1}.mjs`],
          verification: []
        }))
      ]
    }
  }, null, 2));
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '0';
  process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = '1';
  process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = contractPath;
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.MAILCHIMP_PRODUCT_ONLY = '1';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'production_slice';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.profile, 'mailchimp_benchmark_scope');
    assert.equal(graph.surfaceMatrix.surfaces.length, 10);
    assert.ok(graph.workGraph.workUnits.length > 0, 'expected real work units from the broader contract scope');
    const frontend = graph.workGraph.workUnits.find((unit) => unit.id === 'focus.frontend_interaction_parity');
    assert.ok(frontend, 'frontend interaction parity should be selected as executable work');
    assert.ok(frontend.allowedFiles.includes('packages/app/view.mjs'));
    assert.ok(frontend.allowedFiles.some((filePath) => filePath.startsWith('packages/app/routes/')));
    assert.ok(frontend.evidence.includes('tests/current-product-browser-realism.test.mjs'));
  } finally {
    if (prevUseStrict === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUseStrict;
    if (prevUseBenchmark === undefined) delete process.env.MAILCHIMP_USE_BENCHMARK_SCOPE; else process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = prevUseBenchmark;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevProductOnly === undefined) delete process.env.MAILCHIMP_PRODUCT_ONLY; else process.env.MAILCHIMP_PRODUCT_ONLY = prevProductOnly;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevContract === undefined) delete process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH; else process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = prevContract;
  }
});

test('parity focus plan keeps website builder ownership separate from reports overview', () => {
  const units = buildMailchimpParityFocusWorkGraph().workGraph.workUnits;
  const reporting = units.find((unit) => unit.id === 'focus.reports_overview');
  const website = units.find((unit) => unit.id === 'focus.website_builder');
  assert.ok(reporting, 'reports overview shard should exist');
  assert.ok(website, 'website builder shard should exist');
  assert.ok(reporting.allowedFiles.includes('packages/app/routes/reports.mjs'));
  assert.ok(website.allowedFiles.includes('packages/app/domain-website-builder.mjs'));
  assert.ok(!reporting.allowedFiles.includes('packages/app/domain-website-builder.mjs'));
  const overlap = reporting.allowedFiles.filter((file) => website.allowedFiles.includes(file));
  assert.deepEqual(overlap, []);
});

test('parity focus plan keeps landing pages ownership separate from website builder', () => {
  const units = buildMailchimpParityFocusWorkGraph().workGraph.workUnits;
  const landing = units.find((unit) => unit.id === 'focus.landing_pages');
  const website = units.find((unit) => unit.id === 'focus.website_builder');
  assert.ok(landing, 'landing pages shard should exist');
  assert.ok(website, 'website builder shard should exist');
  assert.deepEqual(landing.allowedFiles, ['packages/app/routes/website-builder.mjs']);
  assert.deepEqual(website.allowedFiles, ['packages/app/domain-website-builder.mjs']);
  const overlap = landing.allowedFiles.filter((file) => website.allowedFiles.includes(file));
  assert.deepEqual(overlap, []);
});

test('extractVerifiedFocusIdsFromPatchQueue only counts focus merges with product-surface proof, not skipped tests', () => {
  const focusIds = extractVerifiedFocusIdsFromPatchQueue({
    merged: [
      { taskId: 'focus.website_builder', filePaths: ['packages/app/domain-website-builder.mjs'] },
      { taskId: 'focus.reports_overview', filePaths: [], verifierResults: [{ verifier: 'lint', ok: true }] },
      { taskId: 'focus.landing_pages', filePaths: ['tests/browser-realism.test.mjs'] },
      { shardId: 'focus.reports_detail_views', filePaths: ['packages/app/domain-campaigns.mjs'] },
      { taskId: 'focus.contacts_table', filePaths: [], verifierResults: [{ verifier: 'tests', ok: true, skipped: true }] },
      { taskId: 'focus.segments', filePaths: [], verifierResults: [{ verifier: 'tests', ok: true }] },
      {
        taskId: 'focus.account_workspace_setup',
        filePaths: ['packages/app/index.mjs'],
        verifierResults: [{ verifier: 'tests', ok: true }],
        metadata: { implementation: { metadata: { claimIntegrityKind: 'synthetic_parity_delta' } } }
      },
      {
        taskId: 'focus.dashboard_home',
        filePaths: ['packages/app/index.mjs'],
        verifierResults: [{ verifier: 'tests', ok: true }],
        metadata: { implementation: { stdout: '{"metadata":{"claimIntegrityKind":"synthetic_parity_delta"}}' } }
      },
      {
        taskId: 'focus.ai_predictive_ops_realism',
        filePaths: ['packages/app/ai-provider.mjs'],
        verifierResults: [{ verifier: 'tests', ok: true }],
        metadata: { implementation: { metadata: { claimIntegrityKind: 'marker_only_remediation_delta', markerOnlyProductDelta: true } } }
      },
      {
        taskId: 'focus.frontend_client_shell_state',
        filePaths: ['packages/app/view.mjs'],
        verifierResults: [{ verifier: 'tests', ok: true }],
        metadata: { implementation: { stdout: '{"metadata":{"claimIntegrityKind":"marker_only_remediation_delta","markerOnlyProductDelta":true}}' } }
      },
      {
        taskId: 'focus.persistence_jobs_operational_parity',
        filePaths: [],
        verifierResults: [{ verifier: 'tests', ok: true }],
        metadata: {
          implementation: { modifiedFiles: [] },
          verifierResults: [{ verifier: 'tests', ok: true, skipped: true, reason: 'product_only_mode' }]
        }
      }
    ]
  });
  assert.deepEqual(focusIds, ['focus.website_builder', 'focus.reports_detail_views']);
});

test('extractVerifiedFocusIdsFromPatchQueue requires deep architecture evidence for semantic/deep-architecture credit', () => {
  const prevDeepCredit = process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT;
  try {
    const shallowSemanticEntry = {
      taskId: 'focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands',
      filePaths: ['packages/app/routes/public.mjs'],
      verifierResults: [{ verifier: 'tests', ok: true }],
      metadata: {
        contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
        implementation: {
          modifiedFiles: ['packages/app/routes/public.mjs'],
          metadata: {
            architectureEvidence: {
              ok: false,
              layerCount: 1,
              modifiedPrimaryRuntimeFiles: ['packages/app/routes/public.mjs'],
              evidencePrimaryRuntimeFiles: ['packages/app/routes/public.mjs'],
              signaledFiles: ['packages/app/routes/public.mjs'],
              modifiedSignaledFiles: ['packages/app/routes/public.mjs'],
              markerOnly: false,
              reason: 'shallow_or_single_layer_semantic_patch'
            }
          }
        }
      }
    };
    const deepSemanticEntry = {
      taskId: 'focus.website_builder_editor_realism::semantic-frontier-001#02-integrated_user_path_evidence',
      filePaths: ['packages/app/routes/website-builder.mjs', 'packages/app/domain-website-builder.mjs'],
      verifierResults: [{ verifier: 'tests', ok: true }],
      metadata: {
        contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
        implementation: {
          modifiedFiles: ['packages/app/routes/website-builder.mjs'],
          metadata: {
            architectureEvidence: {
              ok: true,
              layerCount: 2,
              modifiedPrimaryRuntimeFiles: ['packages/app/routes/website-builder.mjs'],
              adoptedPrimaryRuntimeFiles: ['packages/app/domain-website-builder.mjs'],
              evidencePrimaryRuntimeFiles: ['packages/app/routes/website-builder.mjs', 'packages/app/domain-website-builder.mjs'],
              layers: ['route_or_server', 'domain_or_persistence'],
              modifiedLayers: ['route_or_server'],
              requiredLayers: ['route_or_server', 'domain_or_persistence'],
              presentRequiredLayers: ['route_or_server', 'domain_or_persistence'],
              modifiedRequiredLayers: ['route_or_server'],
              signaledFiles: ['packages/app/routes/website-builder.mjs', 'packages/app/domain-website-builder.mjs'],
              modifiedSignaledFiles: ['packages/app/routes/website-builder.mjs'],
              runtimeIntegrationEvidence: {
                ok: true,
                files: ['packages/app/routes/website-builder.mjs'],
                signalCount: 2,
                reason: 'concrete_runtime_delta_present'
              },
              markerOnly: false,
              reason: 'semantic_architecture_gate_passed'
            }
          }
        }
      }
    };

    assert.deepEqual(extractVerifiedFocusIdsFromPatchQueue({ merged: [shallowSemanticEntry, deepSemanticEntry] }), [
      'focus.website_builder_editor_realism'
    ]);

    process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT = '1';
    assert.deepEqual(extractVerifiedFocusIdsFromPatchQueue({
      merged: [
        {
          taskId: 'focus.reports_detail_views',
          filePaths: ['packages/app/domain-campaigns.mjs'],
          verifierResults: [{ verifier: 'tests', ok: true }]
        },
        deepSemanticEntry
      ]
    }), ['focus.website_builder_editor_realism']);
  } finally {
    if (prevDeepCredit === undefined) delete process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT;
    else process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT = prevDeepCredit;
  }
});

test('extractVerifiedFocusIdsFromPatchQueue marks semantic-bloat focus credit suspect instead of verified', () => {
  const bloatEntry = {
    taskId: 'focus.dashboard_home::semantic-frontier-001#01-primary_runtime_spine',
    filePaths: ['packages/app/index.mjs'],
    verifierResults: [{ verifier: 'tests', ok: true }],
    metadata: {
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      implementation: {
        modifiedFiles: ['packages/app/index.mjs'],
        metadata: {
          claimIntegrityKind: 'semantic_bloat_delta',
          semanticBloatAudit: {
            semanticBloatSuspect: true,
            reasons: ['high_duplicate_normalized_added_line_ratio', 'remediation_blueprint_boilerplate_concentration']
          },
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['packages/app/index.mjs'],
            evidencePrimaryRuntimeFiles: ['packages/app/index.mjs', 'packages/app/domain-campaigns.mjs'],
            signaledFiles: ['packages/app/index.mjs', 'packages/app/domain-campaigns.mjs'],
            modifiedSignaledFiles: ['packages/app/index.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            runtimeIntegrationEvidence: { ok: true, signalCount: 2 },
            markerOnly: false,
            semanticBloatAudit: { semanticBloatSuspect: true }
          }
        }
      }
    }
  };

  assert.deepEqual(extractVerifiedFocusIdsFromPatchQueue({ merged: [bloatEntry] }), []);
  assert.deepEqual(extractSuspectFocusIdsFromPatchQueue({ merged: [bloatEntry] }), ['focus.dashboard_home']);
});

test('extractVerifiedFocusIdsFromPatchQueue rejects zero-added substantive claims without runtime evidence', () => {
  const zeroAddedEntry = {
    taskId: 'focus.audience_overview::continuation-001#15',
    filePaths: ['packages/app/domain-audience.mjs'],
    verifierResults: [{ name: 'tests', ok: true }],
    metadata: {
      implementation: {
        metadata: {
          claimIntegrityKind: 'substantive_product_delta',
          semanticBloatAudit: {
            addedNonblankLines: 0,
            runtimeIntegrationEvidence: { ok: false, reason: 'missing_concrete_runtime_delta' },
            semanticBloatSuspect: false
          }
        }
      }
    }
  };
  assert.deepEqual(extractVerifiedFocusIdsFromPatchQueue({ merged: [zeroAddedEntry] }), []);
});

test('continuation remediation satisfaction recognizes primary-runtime adoption evidence, not only old marker modules', () => {
  const relPath = 'packages/app/__tmp-continuation-adoption-satisfaction.mjs';
  const absPath = path.join(ROOT, relPath);
  fs.writeFileSync(absPath, `export function probe() {\n  return { auditEvent: { type: 'primary_runtime_adoption_evaluated', surfaceId: "ai_predictive_ops_realism", phaseId: "continuation_wave_001_service_backed_provider_contracts" } };\n}\n`);
  try {
    assert.equal(remediationLeafUnitAlreadySatisfied({
      metadata: {
        surfaceId: 'ai_predictive_ops_realism',
        structuralPhaseId: 'continuation_wave_001_service_backed_provider_contracts',
        primaryAdoptionFiles: [relPath]
      }
    }), true);
  } finally {
    fs.rmSync(absPath, { force: true });
  }
});

test('full-clone continuation falls back to unsaturated global leaves when selected lanes are exhausted', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevExcluded = process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  const prevAgentCount = process.env.MAILCHIMP_REQUESTED_AGENT_COUNT;
  const prevStructural = process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION;
  const prevFrontier = process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION;
  const prevRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION;
  const prevStrictRemediation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION;
  const prevContinuation = process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = [
    'focus.tags_groups_interests',
    'focus.signup_forms_popups',
    'focus.reports_overview',
    'focus.automations_overview',
    'focus.frontend_client_shell_state',
    'focus.website_builder_editor_realism',
    'focus.integration_provider_sync',
    'focus.ai_predictive_ops_realism'
  ].join(',');
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = '';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.ok(graph.workGraph.summary.allSaturatedContinuationLeafCount < graph.workGraph.summary.allContinuationLeafCount,
      'fixture should leave at least one global continuation leaf unsaturated');
    assert.equal(graph.surfaceMatrix.status, 'partial',
      'durable completed focus credit must not mark the continuation matrix complete while fresh continuation leaves remain unsaturated');
    assert.ok(graph.workGraph.workUnits.length > 0,
      'planner must not return a zero-shard live graph while continuation leaves remain unsaturated');
    const rootFocusIds = new Set(graph.workGraph.workUnits.map((unit) => unit.metadata.rootFocusId || unit.metadata.focusId || unit.id.split('::')[0]));
    assert.ok(rootFocusIds.has('focus.ai_predictive_ops_realism'),
      'fresh continuation waves must reopen completed root focus lanes instead of letting old durable focus credit narrow the graph');
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.id.includes('::continuation-')));
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevExcluded === undefined) delete process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS; else process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = prevExcluded;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
    if (prevAgentCount === undefined) delete process.env.MAILCHIMP_REQUESTED_AGENT_COUNT; else process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = prevAgentCount;
    if (prevStructural === undefined) delete process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION; else process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = prevStructural;
    if (prevFrontier === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = prevFrontier;
    if (prevRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = prevRemediation;
    if (prevStrictRemediation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = prevStrictRemediation;
    if (prevContinuation === undefined) delete process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION; else process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = prevContinuation;
  }
});

test('full-clone continuation hard-skips verified completed roots before selecting broad leaves', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    verified: process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS,
    excluded: process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS,
    ignoreSatisfied: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    structural: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    frontier: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    remediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    strictRemediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    continuation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION,
    semantic: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    semanticForce: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '0',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_COMPLETED_FOCUS_IDS: 'focus.ai_predictive_ops_realism,focus.audience_identity_lifecycle',
    MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: 'focus.ai_predictive_ops_realism,focus.audience_identity_lifecycle',
    MAILCHIMP_EXCLUDED_FOCUS_IDS: 'focus.audience_identity_lifecycle::continuation-001#17,focus.ai_predictive_ops_realism::continuation-001#1#1',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '0'
  });
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    const completedRoots = ['focus.ai_predictive_ops_realism', 'focus.audience_identity_lifecycle'];
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.ok(graph.workGraph.workUnits.length > 0, 'fixture should still have non-completed work to run');
    assert.ok(graph.workGraph.summary.selectedRootFocusIds.every((focusId) => !completedRoots.includes(focusId)));
    assert.ok(graph.workGraph.workUnits.every((unit) => completedRoots.every((root) => !unit.id.startsWith(`${root}::`) && unit.id !== root)), 'verified completed roots must not be replayed as continuation leaves');
    for (const root of completedRoots) {
      const surface = graph.surfaceMatrix.surfaces.find((entry) => entry.focusId === root);
      assert.equal(surface?.status, 'proven_complete');
    }
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: previous.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: previous.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: previous.profile,
      MAILCHIMP_COMPLETED_FOCUS_IDS: previous.completed,
      MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: previous.verified,
      MAILCHIMP_EXCLUDED_FOCUS_IDS: previous.excluded,
      MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: previous.ignoreSatisfied,
      ORCHESTRATOR_REQUESTED_FIDELITY: previous.fidelity,
      MAILCHIMP_REQUESTED_AGENT_COUNT: previous.agentCount,
      MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: previous.structural,
      MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: previous.frontier,
      MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: previous.remediation,
      MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: previous.strictRemediation,
      MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: previous.continuation,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: previous.semantic,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: previous.semanticForce
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('full-clone continuation reopens verified roots only after every ordinary lane is exhausted', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    verified: process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS,
    excluded: process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS,
    ignoreSatisfied: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    structural: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    frontier: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    remediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    strictRemediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    continuation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION,
    semantic: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    semanticForce: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '0',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_EXCLUDED_FOCUS_IDS: '',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '0'
  });
  try {
    const allFocusIds = fullCloneObjectiveInventory().map((gap) => `focus.${gap.id}`).join(',');
    process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = allFocusIds;
    process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS = allFocusIds;

    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.equal(graph.workGraph.summary.reopenVerifiedContinuationRoots, true);
    assert.equal(graph.surfaceMatrix.status, 'partial');
    assert.ok(graph.workGraph.summary.allContinuationLeafCount >= 100, 'verified-root fallback should still create a 100-agent-sized architecture-epic graph');
    assert.ok(graph.workGraph.workUnits.length > 0, 'verified completed roots must not collapse full-clone-red continuation into zero work');
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.id.includes('::continuation-')));
    assert.ok(graph.workGraph.summary.continuationFallbackRootFocusIds.length > 0);
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: previous.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: previous.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: previous.profile,
      MAILCHIMP_COMPLETED_FOCUS_IDS: previous.completed,
      MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: previous.verified,
      MAILCHIMP_EXCLUDED_FOCUS_IDS: previous.excluded,
      MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: previous.ignoreSatisfied,
      ORCHESTRATOR_REQUESTED_FIDELITY: previous.fidelity,
      MAILCHIMP_REQUESTED_AGENT_COUNT: previous.agentCount,
      MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: previous.structural,
      MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: previous.frontier,
      MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: previous.remediation,
      MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: previous.strictRemediation,
      MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: previous.continuation,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: previous.semantic,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: previous.semanticForce
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('semantic director can target one architecture epic for staged rich-client/editor proof', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    verified: process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS,
    excluded: process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS,
    ignoreSatisfied: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    semantic: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    semanticForce: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE,
    semanticMax: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS,
    epicTargets: process.env.MAILCHIMP_ARCHITECTURE_EPIC_TARGET_IDS,
    epicStage: process.env.MAILCHIMP_ARCHITECTURE_EPIC_STAGE,
    epicMax: process.env.MAILCHIMP_ARCHITECTURE_EPIC_MAX_EPICS
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '0',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_COMPLETED_FOCUS_IDS: '',
    MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: '',
    MAILCHIMP_EXCLUDED_FOCUS_IDS: '',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '12',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: '3',
    MAILCHIMP_ARCHITECTURE_EPIC_TARGET_IDS: 'rich_client_editor_architecture',
    MAILCHIMP_ARCHITECTURE_EPIC_STAGE: 'single_epic',
    MAILCHIMP_ARCHITECTURE_EPIC_MAX_EPICS: '1'
  });
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    const semantic = graph.workGraph.summary.semanticDirector;
    assert.equal(semantic.active, true);
    assert.equal(semantic.architectureEpicPlan.status, 'planned');
    assert.equal(semantic.architectureEpicPlan.epics.length, 1);
    assert.equal(semantic.architectureEpicPlan.epics[0].id, 'rich_client_editor_architecture');
    assert.ok(graph.workGraph.workUnits.length > 0);
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.architectureEpicId === 'rich_client_editor_architecture'));
    assert.ok(graph.workGraph.workUnits.some((unit) => unit.metadata.architectureRole === 'editor_runtime_builder'));
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.metadata.assignmentContract.artifactKind === 'product_diff'));
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: previous.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: previous.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: previous.profile,
      MAILCHIMP_COMPLETED_FOCUS_IDS: previous.completed,
      MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: previous.verified,
      MAILCHIMP_EXCLUDED_FOCUS_IDS: previous.excluded,
      MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: previous.ignoreSatisfied,
      ORCHESTRATOR_REQUESTED_FIDELITY: previous.fidelity,
      MAILCHIMP_REQUESTED_AGENT_COUNT: previous.agentCount,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: previous.semantic,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: previous.semanticForce,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: previous.semanticMax,
      MAILCHIMP_ARCHITECTURE_EPIC_TARGET_IDS: previous.epicTargets,
      MAILCHIMP_ARCHITECTURE_EPIC_STAGE: previous.epicStage,
      MAILCHIMP_ARCHITECTURE_EPIC_MAX_EPICS: previous.epicMax
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('full-clone continuation excludes failed subshard leaf ids before relaunching another wave', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    excluded: process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS,
    ignoreSatisfied: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    structural: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    frontier: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    remediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    strictRemediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    continuation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION
  };
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  const excludedLeafIds = [
    'focus.audience_identity_lifecycle::continuation-001#17',
    'focus.ai_predictive_ops_realism::continuation-001#1#1'
  ];
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.MAILCHIMP_REQUESTED_AGENT_COUNT = '100';
  process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION = '1';
  process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.ai_predictive_ops_realism,focus.audience_identity_lifecycle';
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = excludedLeafIds.join(',');
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.summary.continuationMode, true);
    assert.ok(graph.workGraph.workUnits.length > 0);
    for (const unit of graph.workGraph.workUnits) {
      assert.ok(!excludedLeafIds.some((excludedId) => excludedId === unit.id
        || excludedId.startsWith(`${unit.id}#`)
        || unit.id.startsWith(`${excludedId}#`)), `${unit.id} must not replay a failed excluded leaf`);
    }
  } finally {
    restore('MAILCHIMP_USE_STRICT_GAP_INVENTORY', previous.use);
    restore('MAILCHIMP_STRICT_GAP_SEQUENCE', previous.seq);
    restore('ORCHESTRATOR_IMPLEMENTATION_PROFILE', previous.profile);
    restore('MAILCHIMP_COMPLETED_FOCUS_IDS', previous.completed);
    restore('MAILCHIMP_EXCLUDED_FOCUS_IDS', previous.excluded);
    restore('MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION', previous.ignoreSatisfied);
    restore('ORCHESTRATOR_REQUESTED_FIDELITY', previous.fidelity);
    restore('MAILCHIMP_REQUESTED_AGENT_COUNT', previous.agentCount);
    restore('MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION', previous.structural);
    restore('MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION', previous.frontier);
    restore('MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION', previous.remediation);
    restore('MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION', previous.strictRemediation);
    restore('MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION', previous.continuation);
  }
});

test('continuation shard ids credit their canonical root focus id', () => {
  assert.equal(canonicalizeFocusId('focus.audience_identity_lifecycle::continuation-001#16#2'), 'focus.audience_identity_lifecycle');
  assert.deepEqual(extractVerifiedFocusIdsFromPatchQueue({
    merged: [
      {
        shardId: 'focus.ai_predictive_ops_realism::continuation-001#13#1',
        taskId: 'focus.ai_predictive_ops_realism::continuation-001#13#1',
        filePaths: ['packages/app/ai-provider.mjs'],
        verifierResults: [{ verifier: 'tests', ok: true }]
      }
    ]
  }), ['focus.ai_predictive_ops_realism']);
});

test('canonical audience surface includes targeted tests in product-only mode', () => {
  const graph = buildMailchimpParityFocusWorkGraph();
  const audience = graph.workGraph.workUnits.find((unit) => unit.id === 'focus.audience_overview');
  assert.ok(audience);
  assert.deepEqual([...audience.requiredVerifiers].sort(), ['imports', 'lint', 'tests']);
  assert.equal(audience.metadata.testFile, 'tests/audience-core.test.mjs');
  assert.equal(audience.metadata.assignmentContract.artifactKind, 'product_diff');
  assert.deepEqual([...audience.metadata.assignmentContract.verifierRequirements].sort(), ['imports', 'lint', 'tests']);
  assert.ok(audience.metadata.assignmentContract.successPredicate.length >= 3);
});

test('parity focus plan spans the canonical one-pass Mailchimp surface checklist while selecting non-overlapping active shards', () => {
  const graph = buildMailchimpParityFocusWorkGraph();
  assert.equal(MAILCHIMP_PARITY_FOCUS_IDS.length, 26);
  assert.equal(graph.workGraph.workUnits.length, 9);
  assert.equal(graph.surfaceMatrix.surfaces.length, 26);
  assert.ok(graph.workGraph.workUnits.some((unit) => unit.id === 'focus.signup_onboarding'));
  assert.ok(graph.workGraph.workUnits.some((unit) => unit.id === 'focus.reports_overview'));
  assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.settings_domains'));
  assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.team_roles_permissions'));
  const settingsDomains = graph.surfaceMatrix.surfaces.find((surface) => surface.id === 'settings_domains');
  const teamRoles = graph.surfaceMatrix.surfaces.find((surface) => surface.id === 'team_roles_permissions');
  assert.deepEqual(settingsDomains?.issueIds, ['focus.settings_domains']);
  assert.deepEqual(teamRoles?.issueIds, ['focus.team_roles_permissions']);
});

test('benchmark scope plan expands to the production-creation contract surfaces and clears the prelaunch shard floor', () => {
  const prevScope = process.env.MAILCHIMP_USE_BENCHMARK_SCOPE;
  const prevContract = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevStrict = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'mailchimp-benchmark-contract-test-'));
  const contractPath = path.join(tempDir, 'production-creation-contract.json');
  const contractSurfaces = [
    'frontend_client_shell_state',
    'campaign_editor_template_workflows',
    'audience_crm',
    'campaign_wizard',
    'email_builder',
    'automation_journey_builder',
    'reports_overview',
    'report_detail',
    'integrations_marketplace',
    'api_keys_webhooks',
    'signup_forms_popups',
    'content_studio'
  ].map((id, index) => ({
    id,
    label: id.split('_').join(' '),
    lane: ['frontend', 'campaigns', 'audience', 'automations', 'reporting', 'platform'][index % 6],
    allowedFiles: [`packages/app/${id}.mjs`],
    verification: []
  }));
  fs.writeFileSync(contractPath, JSON.stringify({ scope: { surfaces: contractSurfaces } }, null, 2));
  process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = '1';
  process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = contractPath;
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '0';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '0';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.profile, 'mailchimp_benchmark_scope');
    assert.equal(graph.surfaceMatrix.surfaces.length, 12);
    assert.ok(graph.workGraph.workUnits.length >= 10);
    assert.ok(graph.workGraph.workUnits.some((unit) => unit.id === 'focus.frontend_client_shell_state'));
    assert.ok(graph.workGraph.workUnits.some((unit) => unit.id === 'focus.campaign_editor_template_workflows'));
    assert.ok(graph.workGraph.summary.selectedParityFocusIds.length >= 10);
    assert.ok(new Set(graph.workGraph.workUnits.map((unit) => unit.lane)).size >= 3);
    assert.equal(graph.contractInput.requestedScope.length, 12);
  } finally {
    if (prevScope === undefined) delete process.env.MAILCHIMP_USE_BENCHMARK_SCOPE; else process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = prevScope;
    if (prevContract === undefined) delete process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH; else process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = prevContract;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevStrict === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevStrict;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('benchmark scope owns parity focus ids even when strict gap inventory is enabled for the same launch', () => {
  const prevScope = process.env.MAILCHIMP_USE_BENCHMARK_SCOPE;
  const prevContract = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevStrict = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'mailchimp-benchmark-strict-priority-test-'));
  const contractPath = path.join(tempDir, 'production-creation-contract.json');
  const contractSurfaces = [
    {
      id: 'integration_provider_sync',
      label: 'Integration provider sync',
      lane: 'integration_provider_parity',
      allowedFiles: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs'],
      verification: ['node --test tests/integrations-marketplace.test.mjs']
    },
    {
      id: 'audience_sync_warehouse',
      label: 'Audience sync warehouse',
      lane: 'audience_crm_parity',
      allowedFiles: ['packages/audience-sync/service-audience-sync.mjs', 'packages/audience-warehouse/service-audience-warehouse.mjs'],
      verification: []
    }
  ];
  fs.writeFileSync(contractPath, JSON.stringify({ benchmarkId: 'mailchimp_production_creation_gate', scope: { surfaces: contractSurfaces } }, null, 2));
  process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = '1';
  process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = contractPath;
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.integration_provider_sync';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.profile, 'mailchimp_benchmark_scope');
    assert.deepEqual(graph.workGraph.summary.selectedParityFocusIds, ['focus.audience_sync_warehouse']);
    assert.deepEqual(remainingParityFocusIds(), ['focus.audience_sync_warehouse']);
    assert.equal(graph.surfaceMatrix.surfaces.find((surface) => surface.id === 'integration_provider_sync')?.status, 'proven_complete');
    assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.frontend_interaction_parity'), 'strict-gap ids must not leak into benchmark-scope progress accounting');
  } finally {
    if (prevScope === undefined) delete process.env.MAILCHIMP_USE_BENCHMARK_SCOPE; else process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = prevScope;
    if (prevContract === undefined) delete process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH; else process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = prevContract;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevStrict === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevStrict;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('benchmark scope credits already satisfied canonical product surfaces instead of launching no-op shards', () => {
  const prevScope = process.env.MAILCHIMP_USE_BENCHMARK_SCOPE;
  const prevContract = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
  const prevProfile = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  const prevStrict = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'mailchimp-benchmark-satisfied-test-'));
  const contractPath = path.join(tempDir, 'substantial-canonical-contract.json');
  fs.writeFileSync(contractPath, JSON.stringify({
    benchmarkId: 'mailchimp_substantial_canonical_parity_expansion_gate',
    scope: {
      surfaces: [
        {
          id: 'signup_onboarding',
          label: 'Signup and onboarding wizard',
          lane: 'wave_1_core_funnel_and_audience',
          allowedFiles: ['packages/app/index.mjs', 'packages/app/routes/public.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'],
          verification: ['node --test tests/platform-spine.test.mjs']
        },
        {
          id: 'account_workspace_setup',
          label: 'Account workspace setup',
          lane: 'wave_1_core_funnel_and_audience',
          allowedFiles: ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'],
          verification: ['node --test tests/platform-spine.test.mjs']
        }
      ]
    }
  }, null, 2));
  process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = '1';
  process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = contractPath;
  process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = 'mailchimp_parity_focus';
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '0';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  try {
    withTemporarySatisfactionMarkers(() => {
      assert.equal(strictGapAlreadySatisfied('signup_onboarding'), true);
      assert.equal(strictGapAlreadySatisfied('account_workspace_setup'), true);
      const graph = buildMailchimpParityFocusWorkGraph();
      assert.equal(graph.workGraph.profile, 'mailchimp_benchmark_scope');
      assert.equal(graph.workGraph.workUnits.length, 0);
      assert.deepEqual(graph.workGraph.summary.selectedParityFocusIds, []);
      assert.equal(graph.surfaceMatrix.status, 'all_complete');
      assert.ok(graph.surfaceMatrix.surfaces.every((surface) => surface.status === 'proven_complete'));
    });
  } finally {
    if (prevScope === undefined) delete process.env.MAILCHIMP_USE_BENCHMARK_SCOPE; else process.env.MAILCHIMP_USE_BENCHMARK_SCOPE = prevScope;
    if (prevContract === undefined) delete process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH; else process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH = prevContract;
    if (prevProfile === undefined) delete process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE; else process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE = prevProfile;
    if (prevStrict === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevStrict;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
  }
});

test('parity focus plan keeps campaign index as one cross-file work unit', () => {
  const graph = buildMailchimpParityFocusWorkGraph();
  const campaignIndexUnits = graph.workGraph.workUnits.filter((unit) => unit.id.startsWith('focus.campaign_index'));
  assert.equal(campaignIndexUnits.length, 1);
  assert.equal(campaignIndexUnits[0].id, 'focus.campaign_index');
  assert.deepEqual(campaignIndexUnits[0].allowedFiles.sort(), ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'].sort());
});


test('selectNonOverlappingFocusIds serializes direct and partial file collisions without collapsing unrelated lanes', () => {
  assert.deepEqual(
    selectNonOverlappingFocusIds(['focus.settings_domains', 'focus.team_roles_permissions']),
    ['focus.settings_domains']
  );
  assert.deepEqual(
    selectNonOverlappingFocusIds(['focus.campaign_index', 'focus.automations_overview', 'focus.reports_overview']),
    ['focus.campaign_index', 'focus.reports_overview']
  );
  assert.deepEqual(
    selectNonOverlappingFocusIds(['focus.content_studio', 'focus.template_library']),
    ['focus.content_studio']
  );
  assert.deepEqual(
    selectNonOverlappingFocusIds(['focus.signup_onboarding', 'focus.reports_overview']),
    ['focus.signup_onboarding', 'focus.reports_overview']
  );
  assert.deepEqual(
    selectNonOverlappingFocusIds(['focus.team_roles_permissions']),
    ['focus.team_roles_permissions']
  );

  const original = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = [
    'focus.signup_onboarding',
    'focus.account_workspace_setup',
    'focus.dashboard_home',
    'focus.reports_overview',
    'focus.api_keys_webhooks',
    'focus.billing_plans',
    'focus.settings_domains'
  ].join(',');
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.ok(graph.workGraph.workUnits.some((unit) => unit.id === 'focus.team_roles_permissions'));
    assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.settings_domains'));
    assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.reports_overview'));
  } finally {
    if (original === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
    else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = original;
  }
});

test('full-clone objective credit does not expand file-collision equivalents into completion', () => {
  const previousFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  try {
    assert.deepEqual(objectiveCreditFocusIds(['focus.audience_overview']), ['focus.audience_overview']);
    withStrictGapSequence('focus.audience_overview', (graph) => {
      assert.equal(graph.workGraph.workUnits.length, 1);
      assert.equal(graph.workGraph.workUnits[0].id, 'focus.signup_onboarding');
      const contacts = graph.surfaceMatrix.surfaces.find((surface) => surface.id === 'contacts_table');
      assert.notEqual(contacts?.status, 'proven_complete', 'contacts_table must not be completed by equivalent audience_overview credit');
    });
  } finally {
    if (previousFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
    else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = previousFidelity;
  }
});

test('full-clone strict sequence skips excluded failed focus ids and advances the objective', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  const prevExcluded = process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS;
  const prevIgnoreSatisfied = process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
  const prevFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.signup_onboarding';
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = 'focus.account_workspace_setup';
  process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = '1';
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.dashboard_home');
    const excluded = graph.surfaceMatrix.surfaces.find((surface) => surface.id === 'account_workspace_setup');
    assert.equal(excluded?.status, 'excluded_until_repaired');
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
    if (prevExcluded === undefined) delete process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS; else process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = prevExcluded;
    if (prevIgnoreSatisfied === undefined) delete process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION; else process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION = prevIgnoreSatisfied;
    if (prevFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY; else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = prevFidelity;
  }
});

test('full-clone strict sequence keeps generating work after a partial collision-group completion set', () => {
  const completed = [
    'focus.signup_onboarding',
    'focus.account_workspace_setup',
    'focus.dashboard_home',
    'focus.audience_overview',
    'focus.tags_groups_interests',
    'focus.segments',
    'focus.signup_forms_popups',
    'focus.campaign_index',
    'focus.campaign_wizard',
    'focus.email_builder',
    'focus.template_library',
    'focus.content_studio',
    'focus.reports_overview',
    'focus.report_detail',
    'focus.automations_overview',
    'focus.landing_pages',
    'focus.website_builder',
    'focus.integrations_marketplace',
    'focus.api_keys_webhooks',
    'focus.billing_plans',
    'focus.settings_domains',
    'focus.team_roles_permissions'
  ].join(',');
  withStrictGapSequence(completed, (graph) => {
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.contacts_table');
    assert.equal(graph.surfaceMatrix.status, 'partial');
    const open = graph.surfaceMatrix.surfaces
      .filter((surface) => !['proven_complete', 'all_complete', 'complete'].includes(surface.status))
      .map((surface) => surface.id);
    assert.deepEqual(open, [
      'contacts_table',
      'contact_profile',
      'send_schedule_review',
      'automation_journey_builder',
      'frontend_client_shell_state',
      'website_builder_editor_realism',
      'campaign_editor_template_workflows',
      'automation_journey_execution',
      'campaign_ops_calendar_workflow',
      'audience_identity_lifecycle',
      'audience_sync_warehouse',
      'reporting_metrics_pipeline',
      'integration_provider_sync',
      'auth_session_security_hardening',
      'persistence_jobs_operational_db',
      'ai_predictive_ops_realism'
    ]);
  });
});

test('parity focus plan excludes completed focus ids instead of falling back to the full focus set', () => {
  const original = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = MAILCHIMP_PARITY_FOCUS_IDS.join(',');
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.workUnits.length, 0);
    assert.equal(graph.surfaceMatrix.surfaces.length, MAILCHIMP_PARITY_FOCUS_IDS.length);
    assert.ok(graph.surfaceMatrix.surfaces.every((surface) => surface.status === 'proven_complete'));
    assert.ok(graph.surfaceMatrix.surfaces.every((surface) => surface.issueIds[0] === `focus.${surface.id}`));
  } finally {
    if (original === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
    else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = original;
  }
});

test('production clean plan disables deterministic chaos unless explicitly requested', () => {
  const prevInjections = process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS;
  const prevChaos = process.env.ORCHESTRATOR_ENABLE_CHAOS;
  delete process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS;
  delete process.env.ORCHESTRATOR_ENABLE_CHAOS;
  try {
    const shards = Array.from({ length: 50 }, (_, index) => ({ id: `focus.test_${index}` }));
    assert.deepEqual(buildFailurePlan({ shardPlan: { shards }, leaseTtlMs: 10 }), []);
    process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS = '1';
    assert.ok(buildFailurePlan({ shardPlan: { shards }, leaseTtlMs: 10 }).some((entry) => entry.mode === 'crash'));
  } finally {
    if (prevInjections === undefined) delete process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS;
    else process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS = prevInjections;
    if (prevChaos === undefined) delete process.env.ORCHESTRATOR_ENABLE_CHAOS;
    else process.env.ORCHESTRATOR_ENABLE_CHAOS = prevChaos;
  }
});

test('parity planner can quarantine failed focus ids for the next wave without crediting them complete', () => {
  const prevExcluded = process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = 'focus.website_builder';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  try {
    assert.ok(!remainingParityFocusIds([]).includes('focus.website_builder'));
    const graph = buildMailchimpParityFocusWorkGraph();
    const surface = graph.surfaceMatrix.surfaces.find((entry) => entry.issueIds?.[0] === 'focus.website_builder');
    assert.equal(surface?.status, 'excluded_until_repaired');
    assert.ok(!graph.workGraph.workUnits.some((unit) => unit.id === 'focus.website_builder'));
  } finally {
    if (prevExcluded === undefined) delete process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS;
    else process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS = prevExcluded;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
    else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('semantic director can target a narrow deep-architecture focus set instead of broad LOC waves', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    ignore: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    structural: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    frontier: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    remediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    strictRemediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    continuation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION,
    semantic: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    force: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE,
    skipAdopted: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES,
    targets: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS,
    maxGaps: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '1',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_COMPLETED_FOCUS_IDS: '',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: '0',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: 'signup_onboarding,dashboard_home',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: '2'
  });
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.deepEqual(graph.workGraph.summary.semanticDirector.targetFocusIds, ['focus.signup_onboarding', 'focus.dashboard_home']);
    assert.deepEqual(graph.workGraph.summary.semanticDirector.selectedFocusIds, ['focus.signup_onboarding', 'focus.dashboard_home']);
    assert.ok(graph.workGraph.workUnits.length > 0);
    assert.ok(graph.workGraph.workUnits.every((unit) => unit.id.startsWith('focus.signup_onboarding::semantic-frontier-') || unit.id.startsWith('focus.dashboard_home::semantic-frontier-')));
    const dashboardUserPath = graph.workGraph.workUnits.find((unit) => unit.id.startsWith('focus.dashboard_home::semantic-frontier-') && unit.metadata.semanticPhaseId === 'integrated_user_path_evidence');
    assert.ok(dashboardUserPath, 'targeted dashboard semantic plan should emit integrated user-path work');
    assert.ok(dashboardUserPath.allowedFiles.some((filePath) => /packages\/app\/(?:domain-current-product-ops|storage)\.mjs$/.test(filePath)), 'dashboard integrated user-path work must include domain/persistence evidence, not only shell/index files');
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: previous.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: previous.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: previous.profile,
      ORCHESTRATOR_REQUESTED_FIDELITY: previous.fidelity,
      MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: previous.ignore,
      MAILCHIMP_COMPLETED_FOCUS_IDS: previous.completed,
      MAILCHIMP_REQUESTED_AGENT_COUNT: previous.agentCount,
      MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: previous.structural,
      MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: previous.frontier,
      MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: previous.remediation,
      MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: previous.strictRemediation,
      MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: previous.continuation,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: previous.semantic,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: previous.force,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: previous.skipAdopted,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: previous.targets,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: previous.maxGaps
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('strict hierarchical planner binds full-clone work units to deep anti-noop plan nodes', () => {
  const previous = {
    use: process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY,
    seq: process.env.MAILCHIMP_STRICT_GAP_SEQUENCE,
    profile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    fidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY,
    ignore: process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION,
    completed: process.env.MAILCHIMP_COMPLETED_FOCUS_IDS,
    agentCount: process.env.MAILCHIMP_REQUESTED_AGENT_COUNT,
    structural: process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION,
    frontier: process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION,
    remediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION,
    strictRemediation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION,
    continuation: process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION,
    semantic: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR,
    force: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE
  };
  Object.assign(process.env, {
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '1',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_COMPLETED_FOCUS_IDS: '',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '0'
  });
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    const plan = graph.strictHierarchicalPlan;
    assert.ok(plan, 'strict hierarchical plan should be emitted beside the work graph');
    assert.equal(graph.workGraph.summary.strictHierarchicalPlan.enabled, true);
    assert.equal(plan.summary.workUnitCoverage, 1);
    assert.ok(plan.summary.maxDepth >= 5, 'plan must decompose objective/domain/surface/phase/step/proof');
    assert.ok(plan.summary.novelPlannerFeatures.includes('anti_noop_replan_microsteps'));
    assert.ok(plan.nodes.some((node) => node.type === 'proof_gate'));
    const unit = graph.workGraph.workUnits[0];
    assert.ok(unit.metadata.strictHierarchicalPlanning, 'each runnable unit should carry its plan slice');
    assert.ok(unit.metadata.strictHierarchicalPlanning.depthPath.length >= 6);
    assert.ok(unit.metadata.strictHierarchicalPlanning.acceptanceGates.some((gate) => gate.id === 'surviving_product_diff'));
    assert.ok(unit.inputRefs.includes('strictHierarchicalPlanPolicy'));
    assert.ok(unit.metadata.assignmentContract.successPredicate.some((predicate) => /strict hierarchical plan node/.test(predicate)));
    const directives = deriveHierarchicalReplanDirectives({
      plan,
      failedWorkUnitIds: [unit.id],
      failureKind: 'zero_surviving_product_diff'
    });
    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, 'split_to_primary_runtime_microplan');
    assert.ok(directives[0].microSteps.length >= 1, 'zero-diff failures should produce target-file microsteps');
  } finally {
    for (const [key, value] of Object.entries({
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: previous.use,
      MAILCHIMP_STRICT_GAP_SEQUENCE: previous.seq,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: previous.profile,
      ORCHESTRATOR_REQUESTED_FIDELITY: previous.fidelity,
      MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: previous.ignore,
      MAILCHIMP_COMPLETED_FOCUS_IDS: previous.completed,
      MAILCHIMP_REQUESTED_AGENT_COUNT: previous.agentCount,
      MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: previous.structural,
      MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: previous.frontier,
      MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: previous.remediation,
      MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: previous.strictRemediation,
      MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: previous.continuation,
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: previous.semantic,
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: previous.force
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
