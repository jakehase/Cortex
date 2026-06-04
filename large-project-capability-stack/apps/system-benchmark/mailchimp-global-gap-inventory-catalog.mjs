const PLATFORM_PRODUCT_FILES = ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'];
const PLATFORM_TESTS = ['tests/platform-spine.test.mjs', 'tests/phase9-platform-parity.test.mjs'];
const AUDIENCE_PRODUCT_FILES = ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs'];
const AUDIENCE_TESTS = ['tests/audience-core.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
const CAMPAIGN_PRODUCT_FILES = ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/storage.mjs'];
const CAMPAIGN_TESTS = ['tests/phase9-campaign-parity.test.mjs', 'tests/campaign-editor-depth.test.mjs'];
const EDITOR_PRODUCT_FILES = ['apps/web/public/editor-client.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/storage.mjs'];
const EDITOR_TESTS = ['tests/campaign-editor-client.test.mjs', 'tests/campaign-editor-depth.test.mjs'];
const CONTENT_PRODUCT_FILES = ['packages/app/domain-template-assets.mjs', 'packages/app/domain-content-ecosystem-depth.mjs', 'packages/app/routes/content-asset-templates.mjs', 'packages/app/storage.mjs'];
const CONTENT_TESTS = ['tests/content-asset-templates.test.mjs', 'tests/content-studio-runtime.test.mjs'];
const REPORT_PRODUCT_FILES = ['packages/app/analytics-events.mjs', 'packages/app/routes/reports.mjs', 'packages/app/storage.mjs'];
const REPORT_TESTS = ['tests/reports-admin.test.mjs', 'tests/reporting-telemetry-pipeline.test.mjs'];
const AUTOMATION_PRODUCT_FILES = ['packages/app/domain-journeys.mjs', 'packages/app/routes/automations.mjs', 'apps/web/public/journey-designer-client.mjs', 'packages/app/storage.mjs'];
const AUTOMATION_TESTS = ['tests/automation-journeys.test.mjs', 'tests/journey-designer-client.test.mjs'];
const WEBSITE_PRODUCT_FILES = ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs', 'apps/web/public/website-designer-client.mjs', 'packages/app/storage.mjs'];
const WEBSITE_TESTS = ['tests/website-builder-publish-runtime.test.mjs', 'tests/website-designer-client.test.mjs'];
const INTEGRATION_PRODUCT_FILES = ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs', 'packages/app/integration-provider.mjs', 'packages/app/storage.mjs'];
const INTEGRATION_TESTS = ['tests/integrations-marketplace.test.mjs', 'tests/integration-provider-account-runtime.test.mjs'];
const DEVELOPER_PRODUCT_FILES = ['packages/app/domain-core.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'];
const DEVELOPER_TESTS = ['tests/developer-api-webhook-runtime.test.mjs', 'tests/platform-spine.test.mjs'];
const BILLING_PRODUCT_FILES = ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'];
const BILLING_TESTS = ['tests/billing-entitlements-runtime.test.mjs', 'tests/platform-spine.test.mjs'];
const DELIVERABILITY_PRODUCT_FILES = ['packages/app/domain-deliverability-compliance.mjs', 'packages/app/routes/deliverability-compliance.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'];
const DELIVERABILITY_TESTS = ['tests/settings-domains-deliverability-runtime.test.mjs', 'tests/deliverability-compliance.test.mjs'];
const TEAM_PRODUCT_FILES = ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'];
const TEAM_TESTS = ['tests/team-governance-runtime.test.mjs', 'tests/platform-spine.test.mjs'];

export const MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG = [
  { id: 'signup_onboarding', label: 'Signup and onboarding wizard', productFiles: PLATFORM_PRODUCT_FILES, targetedTests: PLATFORM_TESTS, sourceLabels: ['Signup', 'Onboarding', 'Workspace setup'] },
  { id: 'account_workspace_setup', label: 'Account workspace setup', productFiles: PLATFORM_PRODUCT_FILES, targetedTests: PLATFORM_TESTS, sourceLabels: ['Account', 'Workspace', 'Settings'] },
  { id: 'dashboard_home', label: 'Dashboard / home', productFiles: ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'], targetedTests: ['tests/dashboard-home-runtime.test.mjs', 'tests/platform-spine.test.mjs'], sourceLabels: ['Dashboard', 'Home', 'Insights'] },
  { id: 'audience_overview', label: 'Audience overview', productFiles: AUDIENCE_PRODUCT_FILES, targetedTests: AUDIENCE_TESTS, sourceLabels: ['Audience dashboard', 'Marketing CRM'] },
  { id: 'contacts_table', label: 'Contacts table', productFiles: AUDIENCE_PRODUCT_FILES, targetedTests: AUDIENCE_TESTS, sourceLabels: ['Contacts', 'Audience table'] },
  { id: 'contact_profile', label: 'Contact profile', productFiles: AUDIENCE_PRODUCT_FILES, targetedTests: AUDIENCE_TESTS, sourceLabels: ['Contact profile', 'Identity'] },
  { id: 'tags_groups_interests', label: 'Tags, groups, and interests management', productFiles: AUDIENCE_PRODUCT_FILES, targetedTests: AUDIENCE_TESTS, sourceLabels: ['Tags', 'Groups', 'Interests'] },
  { id: 'segments', label: 'Segments', productFiles: AUDIENCE_PRODUCT_FILES, targetedTests: AUDIENCE_TESTS, sourceLabels: ['Segments', 'Audience filters'] },
  { id: 'signup_forms_popups', label: 'Signup forms and popup forms', productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs', 'packages/app/domain-growth.mjs', 'packages/app/storage.mjs'], targetedTests: ['tests/forms-landing.test.mjs', 'tests/phase9-lead-capture-parity.test.mjs'], sourceLabels: ['Signup forms', 'Popup forms', 'Lead capture'] },
  { id: 'campaign_index', label: 'Campaign index', productFiles: CAMPAIGN_PRODUCT_FILES, targetedTests: CAMPAIGN_TESTS, sourceLabels: ['Campaigns', 'Campaign index'] },
  { id: 'campaign_wizard', label: 'Campaign creation wizard', productFiles: CAMPAIGN_PRODUCT_FILES, targetedTests: CAMPAIGN_TESTS, sourceLabels: ['Campaign creation', 'Campaign wizard'] },
  { id: 'email_builder', label: 'Email builder', productFiles: EDITOR_PRODUCT_FILES, targetedTests: EDITOR_TESTS, sourceLabels: ['Email builder', 'Campaign editor'] },
  { id: 'template_library', label: 'Template library', productFiles: CONTENT_PRODUCT_FILES, targetedTests: CONTENT_TESTS, sourceLabels: ['Templates', 'Template library'] },
  { id: 'content_studio', label: 'Content studio / asset manager', productFiles: CONTENT_PRODUCT_FILES, targetedTests: CONTENT_TESTS, sourceLabels: ['Content Studio', 'Asset manager'] },
  { id: 'send_schedule_review', label: 'Send / schedule / review', productFiles: CAMPAIGN_PRODUCT_FILES, targetedTests: CAMPAIGN_TESTS, sourceLabels: ['Send', 'Schedule', 'Review'] },
  { id: 'reports_overview', label: 'Reports overview', productFiles: REPORT_PRODUCT_FILES, targetedTests: REPORT_TESTS, sourceLabels: ['Reports', 'Analytics'] },
  { id: 'report_detail', label: 'Report detail', productFiles: REPORT_PRODUCT_FILES, targetedTests: REPORT_TESTS, sourceLabels: ['Report detail', 'Analytics drilldown'] },
  { id: 'automations_overview', label: 'Automations overview', productFiles: AUTOMATION_PRODUCT_FILES, targetedTests: AUTOMATION_TESTS, sourceLabels: ['Automations', 'Customer journeys'] },
  { id: 'automation_journey_builder', label: 'Customer journey / automation builder', productFiles: AUTOMATION_PRODUCT_FILES, targetedTests: AUTOMATION_TESTS, sourceLabels: ['Journey builder', 'Automation builder'] },
  { id: 'landing_pages', label: 'Landing pages', productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs', 'packages/app/domain-growth.mjs', 'packages/app/storage.mjs'], targetedTests: ['tests/forms-landing.test.mjs', 'tests/phase9-lead-capture-parity.test.mjs'], sourceLabels: ['Landing Pages', 'Lead capture'] },
  { id: 'website_builder', label: 'Website builder', productFiles: WEBSITE_PRODUCT_FILES, targetedTests: WEBSITE_TESTS, sourceLabels: ['Website builder', 'Websites'] },
  { id: 'integrations_marketplace', label: 'Integrations marketplace', productFiles: INTEGRATION_PRODUCT_FILES, targetedTests: INTEGRATION_TESTS, sourceLabels: ['Integrations', 'Marketplace'] },
  { id: 'api_keys_webhooks', label: 'API keys and webhooks', productFiles: DEVELOPER_PRODUCT_FILES, targetedTests: DEVELOPER_TESTS, sourceLabels: ['API keys', 'Webhooks', 'Developer tools'] },
  { id: 'billing_plans', label: 'Billing and plans', productFiles: BILLING_PRODUCT_FILES, targetedTests: BILLING_TESTS, sourceLabels: ['Billing', 'Plans', 'Entitlements'] },
  { id: 'settings_domains', label: 'Settings, domains, and authentication', productFiles: DELIVERABILITY_PRODUCT_FILES, targetedTests: DELIVERABILITY_TESTS, sourceLabels: ['Settings', 'Domains', 'Authentication'] },
  { id: 'team_roles_permissions', label: 'Team users, roles, and permissions', productFiles: TEAM_PRODUCT_FILES, targetedTests: TEAM_TESTS, sourceLabels: ['Team', 'Roles', 'Permissions'] }
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testCommandFor(entry) {
  return `node --test --test-concurrency=1 ${entry.targetedTests.join(' ')}`;
}

export function globalGapStrictGap(entry) {
  return `Mailchimp global gap ${entry.label} product-state parity: strict_1to1_gap_inventory id ${entry.id} remains open until real product-surface diff or explicit product-state proof is admitted`;
}

export function buildMailchimpGlobalGapStrictGaps() {
  return MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG.map(globalGapStrictGap);
}

export function buildMailchimpGlobalGapQueueCatalog() {
  return MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG.map((entry, index, entries) => {
    const previous = entries[index - 1] || null;
    return {
      id: `mailchimp_global_gap_${entry.id}_product_state_reconciliation`,
      label: `Global gap ${String(index + 1).padStart(2, '0')}: ${entry.label}`,
      strictGap: globalGapStrictGap(entry),
      sourceLabels: entry.sourceLabels,
      globalGapId: entry.id,
      globalGapLabel: entry.label,
      afterSurfaceIds: previous ? [`mailchimp_global_gap_${previous.id}_product_state_reconciliation`] : [],
      afterStrictGaps: previous ? [globalGapStrictGap(previous)] : [],
      productGoal: `Resolve strict_1to1_gap_inventory remaining gap ${entry.id} (${entry.label}) only with real product-surface diff or explicit product-state proof from canonical product files/tests.`,
      suggestedProductFiles: entry.productFiles,
      targetedTests: entry.targetedTests,
      creditRequirement: 'product_diff_or_explicit_product_state_proof'
    };
  });
}

export function buildMailchimpGlobalGapStrictSurfaces() {
  return MAILCHIMP_GLOBAL_GAP_PRODUCT_STATE_CATALOG.map((entry, index) => ({
    id: `mailchimp_global_gap_${entry.id}_product_state_reconciliation`,
    phase: `global-gap-${String(index + 1).padStart(2, '0')}`,
    label: `Mailchimp global gap ${entry.label} product-state reconciliation`,
    strictGap: globalGapStrictGap(entry),
    match: new RegExp(`${escapeRegex(entry.id)}|${escapeRegex(entry.label)}`, 'i'),
    productFiles: entry.productFiles,
    targetedTests: entry.targetedTests,
    testCommand: testCommandFor(entry),
    proofMapRelPath: `artifacts/real_parity_proofs/global-inventory/${entry.id}.json`,
    proofReason: 'strict_1to1_gap_inventory_product_state_proof_valid',
    requiredAssertions: [
      `global_gap_${entry.id}_product_state_proof`,
      `global_gap_${entry.id}_product_files_present`,
      `global_gap_${entry.id}_targeted_tests_passed`
    ],
    implementationHandler: 'applyMailchimpGlobalGapProductStateProof',
    globalGapId: entry.id,
    globalGapLabel: entry.label,
    sourceLabels: entry.sourceLabels
  }));
}
