import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMailchimpParityFocusWorkGraph,
  extractVerifiedFocusIdsFromPatchQueue,
  MAILCHIMP_PARITY_FOCUS_IDS,
  selectNonOverlappingFocusIds
} from '../scripts/lib/orchestrator-real-repo-clean-plan.mjs';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN } from '../scripts/lib/mailchimp-canonical-one-pass-plan-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('strict gap inventory mode starts with the first remaining strict gap in sequence mode', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = '';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.profile, 'mailchimp_strict_gap_inventory');
    assert.equal(graph.workGraph.summary.strictGapSequenceMode, true);
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.frontend_interaction_parity');
    assert.equal(graph.workGraph.workUnits[0].metadata.focusGroup, 'frontend_architecture');
    assert.equal(graph.workGraph.workUnits[0].metadata.assignmentContract.artifactKind, 'product_diff');
    assert.ok(graph.workGraph.workUnits[0].metadata.assignmentContract.targetFiles.length >= 1);
    assert.deepEqual(graph.workGraph.workUnits[0].metadata.assignmentContract.verifierRequirements, ['tests']);
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('strict gap inventory mode routes campaign editor parity to campaign editor surfaces', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.frontend_interaction_parity';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.campaign_editor_parity');
    assert.equal(graph.workGraph.workUnits[0].metadata.focusGroup, 'campaign_editor');
    assert.ok(graph.workGraph.workUnits[0].allowedFiles.every((filePath) => filePath.startsWith('packages/template-variants/') || filePath.startsWith('packages/template-approvals/')));
    assert.deepEqual(graph.workGraph.workUnits[0].evidence, ['tests/campaign-editor-depth.test.mjs', 'tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs']);
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('strict gap inventory mode routes automation journey parity to automation journey surfaces', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.frontend_interaction_parity,focus.campaign_editor_parity,focus.website_builder_parity';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.automation_journey_parity');
    assert.equal(graph.workGraph.workUnits[0].metadata.focusGroup, 'automation_journey');
    assert.deepEqual(graph.workGraph.workUnits[0].allowedFiles.sort(), ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs'].sort());
    assert.deepEqual(graph.workGraph.workUnits[0].evidence, ['tests/automation-journeys.test.mjs']);
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
  }
});

test('strict gap inventory mode routes reporting analytics parity to revenue reporting surfaces', () => {
  const prevUse = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  const prevSeq = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  const prevCompleted = process.env.MAILCHIMP_COMPLETED_FOCUS_IDS;
  process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = '1';
  process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = '1';
  process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = 'focus.frontend_interaction_parity,focus.campaign_editor_parity,focus.website_builder_parity,focus.automation_journey_parity,focus.audience_crm_parity';
  try {
    const graph = buildMailchimpParityFocusWorkGraph();
    assert.equal(graph.workGraph.workUnits.length, 1);
    assert.equal(graph.workGraph.workUnits[0].id, 'focus.reporting_analytics_parity');
    assert.equal(graph.workGraph.workUnits[0].metadata.focusGroup, 'reporting_analytics');
    assert.deepEqual(graph.workGraph.workUnits[0].allowedFiles, ['packages/app/domain-commerce-revenue.mjs']);
    assert.deepEqual(graph.workGraph.workUnits[0].evidence, ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs']);
  } finally {
    if (prevUse === undefined) delete process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY; else process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY = prevUse;
    if (prevSeq === undefined) delete process.env.MAILCHIMP_STRICT_GAP_SEQUENCE; else process.env.MAILCHIMP_STRICT_GAP_SEQUENCE = prevSeq;
    if (prevCompleted === undefined) delete process.env.MAILCHIMP_COMPLETED_FOCUS_IDS; else process.env.MAILCHIMP_COMPLETED_FOCUS_IDS = prevCompleted;
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
  assert.deepEqual(focusIds, ['focus.website_builder', 'focus.reports_detail_views', 'focus.segments']);
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
