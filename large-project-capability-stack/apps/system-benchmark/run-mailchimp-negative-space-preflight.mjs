#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));
const DEFAULT_PHASE9_ARTIFACT = path.join(DEFAULT_STACK_ROOT, 'artifacts/benchmarks/mailchimp_phase9_real_parity_preflight/remote-wave5-20260511-025217');

const OFFICIAL_SOURCES = [
  {
    url: 'https://mailchimp.com/features/',
    observedAt: '2026-05-11T03:14:00Z',
    evidence: 'Cortex browse observed feature groups: Marketing Essentials, Content Creation, Audience Management, Marketing Automation, Reporting & Analytics Tools, AI Marketing Tools, Integrations.'
  },
  {
    url: 'https://mailchimp.com/marketing-platform/',
    observedAt: '2026-05-11T03:14:00Z',
    evidence: 'Cortex browse observed multichannel platform claims: Email, Landing pages, Digital ads, Social Posts, Campaign Manager, Marketing CRM, Audience dashboard, Segmentation, Personalization, Predicted demographics, Customer Journeys, Pre-built Automations, Transactional Email, Reports & analytics, Smart Recommendations, A/B Testing, Mobile App, Webhooks.'
  },
  {
    url: 'https://mailchimp.com/features/transactional-email/',
    observedAt: '2026-05-11T03:18:00Z',
    evidence: 'Cortex browse found Mailchimp Transactional Email and Transactional SMS feature surface.'
  },
  {
    url: 'https://mailchimp.com/features/mailchimp-mobile/',
    observedAt: '2026-05-11T03:18:00Z',
    evidence: 'Cortex browse found Mailchimp mobile app feature surface.'
  },
  {
    url: 'https://mailchimp.com/help/use-surveys-mailchimp/',
    observedAt: '2026-05-11T03:18:00Z',
    evidence: 'Cortex browse found Mailchimp surveys help/product surface.'
  },
  {
    url: 'https://mailchimp.com/help/view-and-manage-inbox-messages/',
    observedAt: '2026-05-11T03:18:00Z',
    evidence: 'Cortex browse found Mailchimp Inbox message management surface.'
  }
];

const CANDIDATES = [
  { id: 'email_marketing_campaigns', label: 'Email marketing campaigns', official: ['Email Marketing', 'Email Builder', 'Campaign Manager'], phase9: ['campaign_index', 'campaign_wizard', 'email_builder', 'send_schedule_review'], productFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'], targetedTests: ['tests/campaign-editor-depth.test.mjs', 'tests/phase9-campaign-parity.test.mjs'] },
  { id: 'ab_testing_experimentation', label: 'A/B testing and experimentation', official: ['A/B Testing'], phase9: ['campaign_wizard__gap_experimentation_depth', 'report_detail__gap_experimentation_depth'], productFiles: ['packages/app/experiment-engine.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/routes/reports.mjs'], targetedTests: ['tests/experiment-lab.test.mjs', 'tests/current-product-parity.test.mjs'] },
  { id: 'marketing_automation_flows', label: 'Marketing automation flows / customer journeys', official: ['Marketing Automation Flows', 'Customer Journeys', 'Pre-built Automations'], phase9: ['automations_overview', 'automation_journey_builder'], productFiles: ['packages/app/domain-journeys.mjs', 'packages/app/routes/automations.mjs'], targetedTests: ['tests/automation-journeys.test.mjs', 'tests/journey-metrics.test.mjs', 'tests/journey-annotations.test.mjs'] },
  { id: 'content_studio_assets', label: 'Content Studio and creative assets', official: ['Content Studio', 'Content creation tools'], phase9: ['content_studio'], productFiles: ['packages/app/domain-template-assets.mjs', 'packages/app/routes/content-asset-templates.mjs', 'packages/app/routes/content-library.mjs', 'packages/app/routes/content-ops.mjs'], targetedTests: ['tests/content-library.test.mjs', 'tests/content-asset-templates.test.mjs', 'tests/content-checklists.test.mjs'] },
  { id: 'dynamic_content_personalization', label: 'Dynamic content and personalization', official: ['Dynamic Content', 'Personalization'], phase9: ['email_builder', 'content_studio'], productFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-current-product-ops.mjs'], targetedTests: ['tests/current-product-parity.test.mjs'] },
  { id: 'generative_ai_subject_helper', label: 'Generative AI and Subject Line Helper', official: ['Generative AI', 'Subject Line Helper', 'AI marketing tools'], phase9: ['content_studio', 'campaign_wizard__gap_experimentation_depth'], productFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/domain-website-builder.mjs'], targetedTests: ['tests/current-product-parity.test.mjs'] },
  { id: 'audience_crm_dashboard', label: 'Marketing CRM and audience dashboard', official: ['Marketing CRM', 'Audience dashboard', 'All audience tools'], phase9: ['audience_overview', 'contacts_table', 'contact_profile'], productFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'], targetedTests: ['tests/audience-core.test.mjs', 'tests/phase9-audience-parity.test.mjs'] },
  { id: 'predictive_demographics', label: 'Predictive demographics and contact scoring', official: ['Predictive Demographics'], phase9: ['reports_overview__gap_predictive_optimization_depth', 'report_detail__gap_predictive_optimization_depth'], productFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs'], targetedTests: ['tests/current-product-parity.test.mjs', 'tests/segmentation-lab.test.mjs'] },
  { id: 'segmentation_advanced', label: 'Advanced segmentation', official: ['Segmentation'], phase9: ['segments', 'tags_groups_interests'], productFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'], targetedTests: ['tests/audience-funnels.test.mjs', 'tests/segmentation-lab.test.mjs'] },
  { id: 'signup_forms', label: 'Sign-up forms and popup forms', official: ['Sign-Up Forms'], phase9: ['signup_forms_popups'], productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs', 'packages/app/routes/forms.mjs'], targetedTests: ['tests/forms-landing.test.mjs', 'tests/phase9-lead-capture-parity.test.mjs'] },
  { id: 'surveys_feedback', label: 'Surveys and feedback', official: ['Surveys'], phase9: [], productFiles: ['packages/surveys-feedback/index.mjs', 'packages/surveys-feedback/domain-surveys-feedback.mjs', 'packages/surveys-feedback/routes/surveys-feedback.mjs', 'apps/web/server.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs'], targetedTests: ['tests/surveys-feedback.test.mjs'] },
  { id: 'sms_marketing_native', label: 'SMS marketing', official: ['SMS marketing'], phase9: ['signup_forms_popups__gap_omnichannel_depth'], productFiles: ['packages/app/routes/current-product-ops.mjs', 'packages/app/domain-current-product-ops.mjs'], targetedTests: ['tests/sms-orchestration.test.mjs'] },
  { id: 'social_posts_publishing', label: 'Social posts and social media marketing', official: ['Social media marketing', 'Social Posts'], phase9: ['signup_forms_popups__gap_omnichannel_depth'], productFiles: ['packages/app/routes/current-product-ops.mjs', 'packages/app/domain-current-product-ops.mjs'], targetedTests: ['tests/social-publisher.test.mjs'] },
  { id: 'retargeting_digital_ads', label: 'Retargeting ads / digital ads', official: ['Retargeting Ads', 'Digital ads'], phase9: ['signup_forms_popups__gap_omnichannel_depth'], productFiles: ['packages/app/routes/current-product-ops.mjs', 'packages/app/domain-current-product-ops.mjs'], targetedTests: ['tests/current-product-parity.test.mjs'] },
  { id: 'landing_pages', label: 'Landing pages', official: ['Landing Pages'], phase9: ['landing_pages'], productFiles: ['packages/app/routes/leads.mjs', 'packages/app/routes/websites.mjs', 'packages/app/routes/forms.mjs'], targetedTests: ['tests/forms-landing.test.mjs', 'tests/phase9-remaining-parity.test.mjs'] },
  { id: 'website_builder', label: 'Website builder', official: ['Websites', 'Landing pages'], phase9: ['website_builder'], productFiles: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs', 'packages/app/routes/websites.mjs'], targetedTests: ['tests/current-product-parity.test.mjs', 'tests/phase9-remaining-parity.test.mjs'] },
  { id: 'transactional_email', label: 'Transactional email', official: ['Transactional Emails', 'Transactional API', 'Transactional email'], phase9: [], productFiles: ['packages/customer-journeys/index.mjs', 'packages/customer-journeys/domain-customer-journeys.mjs', 'packages/customer-journeys/routes/customer-journeys.mjs', 'apps/web/server.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs'], targetedTests: ['tests/transactional-journeys.test.mjs'] },
  { id: 'reporting_analytics', label: 'Marketing reports and analytics', official: ['Marketing Reports', 'Reports & analytics'], phase9: ['reports_overview', 'report_detail'], productFiles: ['packages/app/routes/reports.mjs', 'packages/app/analytics-events.mjs'], targetedTests: ['tests/reports-admin.test.mjs', 'tests/phase9-remaining-parity.test.mjs'] },
  { id: 'send_time_optimization', label: 'Send Time Optimization', official: ['Send Time Optimization'], phase9: ['campaign_wizard__gap_experimentation_depth', 'reports_overview__gap_predictive_optimization_depth'], productFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs'], targetedTests: ['tests/current-product-parity.test.mjs'] },
  { id: 'smart_recommendations', label: 'Smart Recommendations', official: ['Smart Recommendations'], phase9: ['reports_overview__gap_predictive_optimization_depth'], productFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs'], targetedTests: ['tests/current-product-parity.test.mjs'] },
  { id: 'integrations_300_directory', label: '300+ integrations directory and connector ecosystem', official: ['300+ Integrations', 'Shopify', 'WooCommerce', 'Canva', 'Zapier', 'Salesforce'], phase9: ['integrations_marketplace'], productFiles: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs', 'packages/app/routes/integrations.mjs'], targetedTests: ['tests/integrations-marketplace.test.mjs', 'tests/phase9-remaining-parity.test.mjs'] },
  { id: 'webhooks_developer_tools', label: 'Webhooks and developer tools', official: ['Webhooks', 'Developer tools', 'API docs'], phase9: ['api_keys_webhooks'], productFiles: ['packages/app/routes/api-admin.mjs'], targetedTests: ['tests/reports-admin.test.mjs', 'tests/phase9-remaining-parity.test.mjs'] },
  { id: 'ecommerce_revenue_coupons', label: 'E-commerce products, orders, discounts, and revenue attribution', official: ['E-commerce', 'Shopify', 'WooCommerce', 'Create discount codes', 'Create orders'], phase9: ['integrations_marketplace', 'billing_plans', 'website_builder'], productFiles: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/commerce-revenue.mjs'], targetedTests: ['tests/commerce-revenue.test.mjs', 'tests/commerce-coupons.test.mjs', 'tests/ecommerce-insights.test.mjs'] },
  { id: 'mobile_app', label: 'Mobile app experience', official: ['Mobile App'], phase9: [], productFiles: ['packages/mobile-app/index.mjs', 'packages/mobile-app/domain-mobile-app.mjs', 'packages/mobile-app/routes/mobile-app.mjs', 'apps/web/server.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs', 'packages/app/routes/public.mjs'], targetedTests: ['tests/mobile-app-experience.test.mjs'] },
  { id: 'preferences_consent_center', label: 'Preference center, consent, and exports', official: ['Tags & Customer Profiles', 'Sign-Up Forms', 'GDPR Compliance'], phase9: ['contact_profile', 'signup_forms_popups', 'settings_domains'], productFiles: ['packages/app/routes/current-product-ops.mjs', 'packages/app/domain-current-product-ops.mjs'], targetedTests: ['tests/preferences-center.test.mjs', 'tests/preference-exports.test.mjs'] },
  { id: 'conversation_inbox', label: 'Conversation inbox / customer-service interaction layer', official: ['Mailchimp Inbox', 'Customer conversations', 'Conversation messages'], phase9: [], productFiles: ['packages/conversation-inbox/index.mjs', 'packages/conversation-inbox/domain-conversation-inbox.mjs', 'packages/conversation-inbox/routes/conversation-inbox.mjs', 'apps/web/server.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs'], targetedTests: ['tests/conversation-inbox.test.mjs'] },
  { id: 'deliverability_compliance', label: 'Deliverability, compliance, and trust operations', official: ['GDPR Compliance', 'Security', 'Status'], phase9: ['settings_domains', 'send_schedule_review'], productFiles: ['packages/app/domain-deliverability-compliance.mjs', 'packages/app/routes/deliverability-compliance.mjs'], targetedTests: ['tests/deliverability-compliance.test.mjs', 'tests/deliverability-labs.test.mjs', 'tests/deliverability-war-room.test.mjs'] },
  { id: 'collaboration_approvals_calendar', label: 'Approvals, collaboration, and marketing calendar', official: ['Professional Services', 'Customer success'], phase9: ['send_schedule_review', 'team_roles_permissions'], productFiles: ['packages/app/domain-collaboration-approval.mjs', 'packages/app/routes/collaboration-approval.mjs'], targetedTests: ['tests/collaboration-approval.test.mjs', 'tests/approval-batches.test.mjs', 'tests/calendar-approvals.test.mjs'] }
];

function parseArgs(argv) {
  const args = { benchmarkId: 'mailchimp_phase10_negative_space_preflight', stackRoot: DEFAULT_STACK_ROOT, mailchimpRoot: DEFAULT_MAILCHIMP_ROOT, phase9ArtifactRoot: DEFAULT_PHASE9_ARTIFACT, artifactRoot: null, proofMapPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--phase9-artifact-root') { args.phase9ArtifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--proof-map') { args.proofMapPath = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
  }
  if (!args.artifactRoot) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `bootstrap-${stamp}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileEvidence(root, relPaths = []) {
  return relPaths.map((relPath) => {
    const fullPath = path.join(root, relPath);
    const exists = fs.existsSync(fullPath);
    let source = '';
    if (exists) source = fs.readFileSync(fullPath, 'utf8');
    return { relPath, exists, lineCount: source ? source.split('\n').length : 0, bytes: Buffer.byteLength(source) };
  });
}

function normalizeProofMap(proofDoc) {
  if (!proofDoc || typeof proofDoc !== 'object') return {};
  if (proofDoc.proofs && typeof proofDoc.proofs === 'object' && !Array.isArray(proofDoc.proofs)) return proofDoc.proofs;
  if (Array.isArray(proofDoc.leafProofs)) return Object.fromEntries(proofDoc.leafProofs.map((entry) => [entry.id || entry.surfaceId || entry.parentSurfaceId, entry]).filter(([key]) => key));
  return proofDoc;
}

function proofFor(candidate, proofMap) {
  const proof = proofMap[candidate.id] || proofMap[`${candidate.id}__phase10_negative_space`] || null;
  if (!proof) return { present: false, valid: false, reason: 'missing_proof_entry' };
  const proofProductFiles = new Set(proof.productFiles || proof.files || []);
  const proofTests = new Set(proof.targetedTests || proof.tests || []);
  const productFilesCovered = candidate.productFiles.every((relPath) => proofProductFiles.has(relPath));
  const testsCovered = candidate.targetedTests.every((relPath) => proofTests.has(relPath));
  const testsPassed = proof.testsPassed === true || proof.status === 'green';
  const assertions = Array.isArray(proof.assertions) ? proof.assertions : [];
  return {
    present: true,
    valid: productFilesCovered && testsCovered && testsPassed && assertions.length > 0,
    productFilesCovered,
    testsCovered,
    testsPassed,
    assertionCount: assertions.length,
    runCommand: proof.runCommand || null,
    artifact: proof.artifact || null,
    reason: productFilesCovered && testsCovered && testsPassed && assertions.length > 0 ? 'direct_product_test_proof_valid' : 'proof_entry_incomplete'
  };
}

function classify(candidate, phase9GreenIds, proofMap) {
  const phase9Covered = candidate.phase9.some((id) => phase9GreenIds.has(id) || [...phase9GreenIds].some((green) => green.startsWith(`${id}__`)));
  const hasProductFiles = candidate.productEvidence.every((entry) => entry.exists) && candidate.productEvidence.length > 0;
  const hasTests = candidate.testEvidence.every((entry) => entry.exists) && candidate.testEvidence.length > 0;
  const proof = proofFor(candidate, proofMap);
  candidate.proof = proof;
  if (phase9Covered && hasProductFiles && hasTests) return 'phase9_green_or_mapped_with_product_evidence';
  if (!phase9Covered && hasProductFiles && hasTests && proof.valid) return 'phase10_negative_space_green_product_test_proven';
  if (!phase9Covered && hasProductFiles && hasTests) return 'negative_space_candidate_existing_unproven';
  if (hasProductFiles || hasTests) return 'negative_space_candidate_partial_evidence';
  return 'negative_space_missing_product_surface';
}

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.artifactRoot, { recursive: true });
const phase9Summary = readJson(path.join(args.phase9ArtifactRoot, 'completion_summary.json'), {});
const phase9SurfaceMatrix = readJson(path.join(args.phase9ArtifactRoot, 'surface_matrix.json'), { surfaces: [] });
const leafArray = Array.isArray(phase9SurfaceMatrix?.surfaces) ? phase9SurfaceMatrix.surfaces : [];
const phase9GreenIds = new Set(leafArray.filter((leaf) => leaf.status === 'green').flatMap((leaf) => [leaf.id, leaf.parentSurfaceId].filter(Boolean)));
const proofDoc = args.proofMapPath ? readJson(args.proofMapPath, {}) : {};
const proofMap = normalizeProofMap(proofDoc);

const candidates = CANDIDATES.map((candidate) => {
  const productEvidence = fileEvidence(args.mailchimpRoot, candidate.productFiles);
  const testEvidence = fileEvidence(args.mailchimpRoot, candidate.targetedTests);
  const enriched = { ...candidate, productEvidence, testEvidence };
  return { ...enriched, status: classify(enriched, phase9GreenIds, proofMap) };
});

const nextWorkQueue = candidates
  .filter((candidate) => !['phase9_green_or_mapped_with_product_evidence', 'phase10_negative_space_green_product_test_proven'].includes(candidate.status))
  .map((candidate) => ({
    id: `${candidate.id}__phase10_negative_space`,
    parentSurfaceId: candidate.id,
    lane: candidate.official.includes('Mobile App') ? 'native_mobile_gap' : candidate.official.includes('Transactional Emails') ? 'transactional_messaging' : candidate.official.includes('SMS marketing') ? 'omnichannel_messaging' : 'full_clone_negative_space',
    productGoal: `Close or honestly block Mailchimp negative-space surface: ${candidate.label}. Official source labels: ${candidate.official.join(', ')}.`,
    allowedFiles: candidate.productFiles,
    targetedTests: candidate.targetedTests,
    status: candidate.status,
    stopCondition: 'negative_space_surface_proven_green_or_blocker_report'
  }));

const summary = {
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  runId: `${args.benchmarkId}-${path.basename(args.artifactRoot).replace(/^bootstrap-/, '')}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  fidelity: 'full_clone',
  scope: 'phase10_mailchimp_negative_space_preflight_after_phase9_matrix_green',
  anchorArtifactRoot: args.phase9ArtifactRoot,
  phase9: {
    thresholdPass: phase9Summary.thresholdPass === true,
    parityStatus: phase9Summary.parityStatus || 'unknown',
    greenLeafSurfaceCount: phase9Summary.greenLeafSurfaceCount ?? null,
    redLeafSurfaceCount: phase9Summary.redLeafSurfaceCount ?? null,
    nextWorkQueueCount: phase9Summary.nextWorkQueueCount ?? null
  },
  officialSources: OFFICIAL_SOURCES,
  proofMapPath: args.proofMapPath,
  candidateSurfaceCount: candidates.length,
  phase9MappedGreenCandidateCount: candidates.filter((entry) => entry.status === 'phase9_green_or_mapped_with_product_evidence').length,
  provenNegativeSpaceCandidateCount: candidates.filter((entry) => entry.status === 'phase10_negative_space_green_product_test_proven').length,
  openNegativeSpaceCandidateCount: nextWorkQueue.length,
  negativeSpaceCandidateCount: nextWorkQueue.length,
  missingProductSurfaceCount: candidates.filter((entry) => entry.status === 'negative_space_missing_product_surface').length,
  thresholdPass: phase9Summary.thresholdPass === true && nextWorkQueue.length === 0,
  parityStatus: nextWorkQueue.length === 0 ? 'phase10_negative_space_full_for_current_official_sources' : 'not_full_clone_negative_space_open',
  blocker: nextWorkQueue.length ? {
    blocker: 'Phase 9 matrix is green, but full Mailchimp negative-space inventory remains open beyond the 63-leaf matrix.',
    blockerKind: 'mailchimp_full_clone_negative_space_open',
    nextAction: 'Use next_work_queue.json to prove or implement each negative-space candidate with product files, executable tests, and remote validation; do not claim global Mailchimp full clone from Phase 9 alone.',
    negativeSpaceCandidateCount: nextWorkQueue.length,
    missingProductSurfaceCount: candidates.filter((entry) => entry.status === 'negative_space_missing_product_surface').length
  } : null
};

writeJson(path.join(args.artifactRoot, 'completion_summary.json'), summary);
writeJson(path.join(args.artifactRoot, 'negative_space_candidates.json'), { generatedAt: summary.generatedAt, officialSources: OFFICIAL_SOURCES, candidates });
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt: summary.generatedAt, count: nextWorkQueue.length, work: nextWorkQueue });
console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
