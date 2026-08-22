export const SURFACE_FAMILY_CATALOG = [
  { id: 'platform_foundation', label: 'Platform foundation', cluster: 'core_platform', routePatterns: ['platform', 'public'], testPatterns: ['platform-spine'], modulePatterns: ['domain-core', 'storage', 'router'] },
  { id: 'audience_crm', label: 'Audience / CRM', cluster: 'core_marketing', routePatterns: ['audience'], testPatterns: ['audience-core'], modulePatterns: ['domain-audience'] },
  { id: 'campaign_authoring_delivery', label: 'Campaign authoring / delivery', cluster: 'core_marketing', routePatterns: ['campaign'], testPatterns: ['campaign-pipeline'], modulePatterns: ['domain-campaigns'] },
  { id: 'automation_journeys', label: 'Automation journeys', cluster: 'core_marketing', routePatterns: ['automation'], testPatterns: ['automation-journeys'], modulePatterns: ['domain-growth', 'jobs'] },
  { id: 'forms_landing_pages', label: 'Forms / landing pages', cluster: 'growth_surface', routePatterns: ['forms', 'public'], testPatterns: ['forms-landing'], modulePatterns: ['view'] },
  { id: 'reporting_analytics', label: 'Reporting / analytics', cluster: 'growth_surface', routePatterns: ['report'], testPatterns: ['reports-admin'], modulePatterns: ['domain-growth'] },
  { id: 'admin_api_ops', label: 'Admin / API / ops', cluster: 'ops_governance', routePatterns: ['api-admin', 'admin', 'api'], testPatterns: ['reports-admin', 'platform-spine'], modulePatterns: ['domain-core', 'utils'] },
  { id: 'content_asset_templates', label: 'Content studio / assets / templates', cluster: 'content_authoring', routePatterns: ['content', 'template', 'asset'], testPatterns: ['content', 'template', 'asset'], modulePatterns: ['asset', 'template', 'editor', 'media'] },
  { id: 'integrations_marketplace', label: 'Integrations / marketplace', cluster: 'ecosystem', routePatterns: ['integration', 'marketplace', 'connector'], testPatterns: ['integration', 'marketplace'], modulePatterns: ['integration', 'connector', 'webhook'] },
  { id: 'commerce_revenue', label: 'Commerce / revenue attribution', cluster: 'ecosystem', routePatterns: ['commerce', 'store', 'product', 'order', 'revenue'], testPatterns: ['commerce', 'revenue'], modulePatterns: ['commerce', 'revenue', 'catalog'] },
  { id: 'collaboration_approval', label: 'Collaboration / approvals', cluster: 'ops_governance', routePatterns: ['approval', 'team', 'collaboration', 'comment'], testPatterns: ['approval', 'team', 'collaboration'], modulePatterns: ['approval', 'team', 'invite', 'permission'] },
  { id: 'deliverability_compliance', label: 'Deliverability / compliance', cluster: 'ops_governance', routePatterns: ['deliverability', 'compliance', 'suppression', 'domain'], testPatterns: ['deliverability', 'compliance'], modulePatterns: ['compliance', 'domain', 'suppression', 'auth'] }
];

export const TOP_TIER_BROWSER_JOURNEYS = [
  { id: 'dashboard_workspace', label: 'Dashboard / workspace shell', patterns: ['dashboard', 'workspace', 'app', 'platform'] },
  { id: 'audience_contacts', label: 'Audience / contact management', patterns: ['audience', 'contact'] },
  { id: 'campaign_editor', label: 'Campaign editor / authoring', patterns: ['campaign', 'editor', 'template'] },
  { id: 'automation_lifecycle', label: 'Automation / journey lifecycle', patterns: ['automation', 'journey'] },
  { id: 'reporting_analytics', label: 'Reporting / analytics', patterns: ['report', 'analytics'] },
  { id: 'admin_permissions', label: 'Admin / permissions / governance', patterns: ['admin', 'permission', 'team', 'approval'] },
  { id: 'integrations_ecosystem', label: 'Integrations / ecosystem', patterns: ['integration', 'marketplace', 'connector', 'webhook'] },
  { id: 'public_forms', label: 'Public forms / signup / landing flow', patterns: ['signup', 'public', 'form', 'landing'] }
];

export const ARTIFACT_CLASS_CATALOG = [
  { id: 'architecture', patterns: ['architecture'] },
  { id: 'certification', patterns: ['certification', 'claim_'] },
  { id: 'parity', patterns: ['parity'] },
  { id: 'tests', patterns: ['test', 'repo_tests', 'mailchimp_tests'] },
  { id: 'supervisor', patterns: ['supervisor', 'program_state', 'surface_matrix'] },
  { id: 'notification', patterns: ['notify', 'notification'] },
  { id: 'recovery', patterns: ['recovery', 'ledger', 'checkpoint'] },
  { id: 'reporting', patterns: ['report', 'summary', 'completion'] },
  { id: 'roadmap', patterns: ['roadmap', 'trajectory', 'gap_analysis', 'thresholds_model'] }
];

export const ENTERPRISE_FAMILY_IDS = ['admin_api_ops', 'collaboration_approval', 'deliverability_compliance'];
export const ECOSYSTEM_FAMILY_IDS = ['integrations_marketplace', 'commerce_revenue', 'deliverability_compliance'];
export const SCALE_OPS_FAMILY_IDS = ['platform_foundation', 'admin_api_ops', 'deliverability_compliance'];
