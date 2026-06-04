const FRONTIER_PRODUCT_FILES = [
  'packages/app/domain-mailchimp-continuous-frontier.mjs',
  'packages/app/domain-current-product.mjs',
  'packages/app/routes/current-product-ops.mjs',
  'packages/app/storage.mjs'
];

const FRONTIER_TARGETED_TESTS = [
  'tests/mailchimp-continuous-frontier-runtime.test.mjs',
  'tests/current-product-parity.test.mjs'
];

export const MAILCHIMP_FRONTIER_BASE_SURFACES = [
  { id: 'email_marketing_campaigns', label: 'Email marketing campaigns', sourceLabels: ['Email Marketing', 'Email Builder', 'Campaign Manager'] },
  { id: 'campaign_creation_send_flow', label: 'Campaign creation and send flow', sourceLabels: ['Campaign Manager', 'Send scheduling', 'Email Marketing'] },
  { id: 'email_builder_content_blocks', label: 'Email builder content blocks', sourceLabels: ['Email Builder', 'Content creation tools', 'Dynamic Content'] },
  { id: 'ab_testing_experimentation', label: 'A/B testing and experimentation', sourceLabels: ['A/B Testing', 'Experimentation', 'Campaign optimization'] },
  { id: 'dynamic_content_personalization', label: 'Dynamic content and personalization', sourceLabels: ['Dynamic Content', 'Personalization', 'Customer journeys'] },
  { id: 'customer_journey_automation', label: 'Customer journey automation', sourceLabels: ['Customer Journeys', 'Marketing Automation Flows', 'Pre-built Automations'] },
  { id: 'prebuilt_automations', label: 'Pre-built automations', sourceLabels: ['Pre-built Automations', 'Marketing automation', 'Customer journeys'] },
  { id: 'audience_crm_dashboard', label: 'Marketing CRM and audience dashboard', sourceLabels: ['Marketing CRM', 'Audience dashboard', 'All audience tools'] },
  { id: 'contact_profiles_identity', label: 'Contact profiles and identity', sourceLabels: ['Tags & Customer Profiles', 'Marketing CRM', 'Audience dashboard'] },
  { id: 'segmentation_advanced', label: 'Advanced segmentation', sourceLabels: ['Segmentation', 'Tags', 'Groups and interests'] },
  { id: 'predictive_demographics_scoring', label: 'Predictive demographics and contact scoring', sourceLabels: ['Predictive Demographics', 'Predicted demographics', 'Smart Recommendations'] },
  { id: 'signup_forms_popups', label: 'Sign-up forms and popup forms', sourceLabels: ['Sign-Up Forms', 'Popup forms', 'Audience growth'] },
  { id: 'landing_pages', label: 'Landing pages', sourceLabels: ['Landing Pages', 'Lead capture', 'Conversion funnels'] },
  { id: 'website_builder', label: 'Website builder', sourceLabels: ['Websites', 'Landing pages', 'Website builder'] },
  { id: 'content_studio_assets', label: 'Content Studio and creative assets', sourceLabels: ['Content Studio', 'Content creation tools', 'Creative Assistant'] },
  { id: 'template_library_brand', label: 'Template library and brand governance', sourceLabels: ['Templates', 'Brand Kit', 'Content Studio'] },
  { id: 'generative_ai_subject_helper', label: 'Generative AI and Subject Line Helper', sourceLabels: ['Generative AI', 'Subject Line Helper', 'AI marketing tools'] },
  { id: 'smart_recommendations', label: 'Smart Recommendations', sourceLabels: ['Smart Recommendations', 'AI marketing tools', 'Optimization'] },
  { id: 'send_time_optimization', label: 'Send Time Optimization', sourceLabels: ['Send Time Optimization', 'Predictive optimization', 'Campaign scheduling'] },
  { id: 'sms_marketing_native', label: 'SMS marketing', sourceLabels: ['SMS marketing', 'Transactional SMS', 'Omnichannel messaging'] },
  { id: 'social_posts_publishing', label: 'Social posts and publishing', sourceLabels: ['Social media marketing', 'Social Posts', 'Campaign calendar'] },
  { id: 'retargeting_digital_ads', label: 'Retargeting and digital ads', sourceLabels: ['Retargeting Ads', 'Digital ads', 'Ad audience sync'] },
  { id: 'postcards_direct_mail', label: 'Postcards and direct mail', sourceLabels: ['Postcards', 'Direct mail', 'Omnichannel campaigns'] },
  { id: 'transactional_email', label: 'Transactional email', sourceLabels: ['Transactional Emails', 'Transactional API', 'Mandrill'] },
  { id: 'transactional_sms', label: 'Transactional SMS', sourceLabels: ['Transactional SMS', 'Transactional messaging', 'SMS'] },
  { id: 'reporting_analytics', label: 'Marketing reports and analytics', sourceLabels: ['Marketing Reports', 'Reports & analytics', 'Campaign reports'] },
  { id: 'omnichannel_attribution', label: 'Omnichannel attribution', sourceLabels: ['Reports & analytics', 'Omnichannel marketing', 'Attribution'] },
  { id: 'integrations_directory', label: '300+ integrations directory', sourceLabels: ['300+ Integrations', 'Shopify', 'WooCommerce', 'Canva', 'Zapier', 'Salesforce'] },
  { id: 'commerce_revenue', label: 'E-commerce products, orders, discounts, and revenue attribution', sourceLabels: ['E-commerce', 'Shopify', 'WooCommerce', 'Create discount codes', 'Create orders'] },
  { id: 'webhooks_developer_tools', label: 'Webhooks and developer tools', sourceLabels: ['Webhooks', 'Developer tools', 'API docs'] },
  { id: 'mobile_app_experience', label: 'Mobile app experience', sourceLabels: ['Mobile App', 'iOS app', 'Android app'] },
  { id: 'conversation_inbox', label: 'Conversation inbox and customer conversations', sourceLabels: ['Mailchimp Inbox', 'Customer conversations', 'Conversation messages'] },
  { id: 'surveys_feedback', label: 'Surveys and feedback', sourceLabels: ['Surveys', 'Feedback', 'Audience insights'] },
  { id: 'preferences_consent_center', label: 'Preference center, consent, and exports', sourceLabels: ['Preference center', 'GDPR Compliance', 'Tags & Customer Profiles'] },
  { id: 'deliverability_compliance', label: 'Deliverability, compliance, and trust operations', sourceLabels: ['Deliverability', 'GDPR Compliance', 'Security', 'Status'] },
  { id: 'settings_domains_authentication', label: 'Settings, domains, and authentication', sourceLabels: ['Domains', 'Authentication', 'Sender settings'] },
  { id: 'billing_plans_entitlements', label: 'Billing plans and entitlements', sourceLabels: ['Billing and plans', 'Usage meters', 'Entitlements'] },
  { id: 'team_roles_permissions', label: 'Team roles and permissions', sourceLabels: ['Team users, roles, and permissions', 'Enterprise identity', 'SCIM'] },
  { id: 'collaboration_approvals_calendar', label: 'Approvals, collaboration, and marketing calendar', sourceLabels: ['Approvals', 'Collaboration', 'Marketing calendar'] },
  { id: 'admin_audit_operability', label: 'Admin audit and operability', sourceLabels: ['Admin tools', 'Audit logs', 'Operational readiness'] }
];

export const MAILCHIMP_FRONTIER_DIMENSIONS = [
  { id: 'primary_runtime_depth', label: 'primary runtime depth' },
  { id: 'route_ui_workflow_depth', label: 'route and UI workflow depth' },
  { id: 'state_persistence_depth', label: 'state persistence and lifecycle depth' },
  { id: 'audit_telemetry_depth', label: 'audit and telemetry depth' },
  { id: 'api_contract_depth', label: 'API contract depth' },
  { id: 'automation_handoff_depth', label: 'automation handoff depth' },
  { id: 'reporting_attribution_depth', label: 'reporting and attribution depth' },
  { id: 'governance_controls_depth', label: 'governance and controls depth' }
];

function frontierId(base, dimension, ordinal) {
  return `mailchimp_frontier_${String(ordinal).padStart(3, '0')}_${base.id}_${dimension.id}_runtime_layer`;
}

function frontierStrictGap(base, dimension) {
  return `${base.label} ${dimension.label} parity: ${base.label} exists partially, but Mailchimp-grade ${dimension.label}, normal workflow adoption, durable evidence, API/runtime proof, and full-clone parity evidence remain open`;
}

export function buildMailchimpFrontierEntries() {
  const entries = [];
  for (const base of MAILCHIMP_FRONTIER_BASE_SURFACES) {
    for (const dimension of MAILCHIMP_FRONTIER_DIMENSIONS) {
      const ordinal = entries.length + 1;
      const id = frontierId(base, dimension, ordinal);
      const strictGap = frontierStrictGap(base, dimension);
      entries.push({ id, ordinal, base, dimension, strictGap });
    }
  }
  return entries;
}

export function buildMailchimpFrontierStrictGaps() {
  return buildMailchimpFrontierEntries().map((entry) => entry.strictGap);
}

export function buildMailchimpFrontierQueueCatalog() {
  const entries = buildMailchimpFrontierEntries();
  return entries.map((entry, index) => {
    const previous = entries[index - 1] || null;
    return {
      id: entry.id,
      label: `Frontier ${entry.ordinal}: ${entry.base.label} — ${entry.dimension.label}`,
      strictGap: entry.strictGap,
      sourceLabels: entry.base.sourceLabels,
      afterSurfaceIds: previous ? [previous.id] : ['omnichannel_reporting_attribution_runtime_layer'],
      afterStrictGaps: previous ? [previous.strictGap] : ['omnichannel reporting attribution parity: channel programs exist, but Mailchimp-grade channel mix dashboards, objective rollups, touchpoint attribution events, durable reporting snapshots, and API evidence remain open'],
      productGoal: `Close or honestly block Mailchimp frontier tranche ${entry.ordinal}: ${entry.base.label} ${entry.dimension.label}, using the official source labels ${entry.base.sourceLabels.join(', ')}.`,
      frontierBaseLabel: entry.base.label,
      frontierSourceLabels: entry.base.sourceLabels,
      frontierDimensionLabel: entry.dimension.label,
      frontierDimensionId: entry.dimension.id,
      suggestedProductFiles: FRONTIER_PRODUCT_FILES,
      targetedTests: FRONTIER_TARGETED_TESTS
    };
  });
}

export function buildMailchimpFrontierStrictSurfaces({ testCommand, targetedTests = FRONTIER_TARGETED_TESTS } = {}) {
  return buildMailchimpFrontierEntries().map((entry) => ({
    id: entry.id,
    phase: `frontier${String(entry.ordinal).padStart(3, '0')}`,
    label: `Mailchimp frontier ${entry.ordinal}: ${entry.base.label} — ${entry.dimension.label}`,
    strictGap: entry.strictGap,
    match: /mailchimp frontier|official surface|runtime depth|workflow depth|attribution depth|governance controls/i,
    productFiles: FRONTIER_PRODUCT_FILES,
    targetedTests,
    testCommand,
    proofMapRelPath: `artifacts/real_parity_proofs/frontier/${entry.id}.json`,
    proofReason: 'autonomous_mailchimp_continuous_frontier_runtime_product_test_proof_valid',
    frontierBaseSurfaceId: entry.base.id,
    frontierBaseLabel: entry.base.label,
    frontierSourceLabels: entry.base.sourceLabels,
    frontierDimensionId: entry.dimension.id,
    frontierDimensionLabel: entry.dimension.label,
    requiredAssertions: [
      'mailchimp_continuous_frontier_runtime_contract',
      'frontier_surface_run_ledger',
      'frontier_evidence_event_ledger',
      'frontier_runtime_snapshot_persistence',
      'frontier_runtime_api_evidence',
      `official_surface_anchor_${entry.base.id}`,
      `proof_dimension_${entry.dimension.id}`
    ],
    implementationHandler: 'applyMailchimpContinuousFrontierRuntime'
  }));
}

export { FRONTIER_PRODUCT_FILES, FRONTIER_TARGETED_TESTS };
