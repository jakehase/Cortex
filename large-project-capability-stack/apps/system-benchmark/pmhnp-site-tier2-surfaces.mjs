export const PMHNP_SITE_TIER2_SURFACES = Object.freeze([
  { id: 'homepage_conversion_runtime', label: 'Homepage conversion and services navigation', file: 'index.html', tokens: ['PMHNP Billing Services', 'claims', 'Credentialing'], minBytes: 10000 },
  { id: 'claim_guard_dashboard_runtime', label: 'Claim Guard dashboard static app shell', file: 'app/index.html', tokens: ['PMHNP Claim Guard', 'Claim Risk', 'Recovery Dashboard'], minBytes: 5000 },
  { id: 'tebra_intake_static_flow', label: 'Tebra intake static app flow', file: 'app/intake.html', tokens: ['Connect Tebra', 'intake', 'PMHNP'], minBytes: 5000 },
  { id: 'billing_service_page_runtime', label: 'Billing services product page', file: 'services/pmhnp-billing-services.html', tokens: ['PMHNP Billing Services', 'Claims', 'RCM'], minBytes: 5000 },
  { id: 'credentialing_service_page_runtime', label: 'Credentialing services product page', file: 'services/pmhnp-credentialing-services.html', tokens: ['Credentialing', 'CAQH', 'Payer'], minBytes: 5000 },
  { id: 'prior_auth_service_page_runtime', label: 'Prior authorization support product page', file: 'services/prior-authorization-support.html', tokens: ['Prior Authorization', 'Psychiatric', 'PMHNP'], minBytes: 5000 },
  { id: 'denial_appeals_service_page_runtime', label: 'Denial management appeals product page', file: 'services/denial-management-appeals-pmhnp.html', tokens: ['Denial Management', 'Appeals', 'Claim Recovery'], minBytes: 5000 },
  { id: 'telehealth_compliance_page_runtime', label: 'Telehealth billing compliance product page', file: 'services/telehealth-billing-compliance-support.html', tokens: ['Telehealth', 'Billing Compliance', 'Modifiers'], minBytes: 5000 },
  { id: 'blog_index_content_runtime', label: 'Blog index content and guide inventory', file: 'blog/index.html', tokens: ['PMHNP Billing Blog', 'Credentialing', 'Telehealth'], minBytes: 10000 },
  { id: 'denied_claims_appeal_guide_runtime', label: 'Denied claims appeal guide article', file: 'blog/appeal-denied-claims-guide.html', tokens: ['Appeal Denied Claims', 'PMHNP', 'denial'], minBytes: 5000 },
  { id: 'billing_mistakes_article_runtime', label: 'Billing mistakes article', file: 'blog/costly-billing-mistakes.html', tokens: ['Billing Mistakes', 'PMHNP', 'Fix'], minBytes: 5000 },
  { id: 'cpt_codes_article_runtime', label: 'CPT codes article', file: 'blog/essential-cpt-codes-pmhnp-guide.html', tokens: ['CPT Codes', 'Psychiatric', 'Billing'], minBytes: 5000 },
  { id: 'illinois_telehealth_article_runtime', label: 'Illinois telehealth billing guide', file: 'blog/illinois-telehealth-billing-guide.html', tokens: ['Illinois Telehealth', 'PMHNP', '2026'], minBytes: 5000 },
  { id: 'credentialing_article_runtime', label: 'Insurance credentialing article', file: 'blog/insurance-credentialing-pmhnp-illinois.html', tokens: ['Insurance Credentialing', 'PMHNP', 'Illinois'], minBytes: 5000 },
  { id: 'mental_health_parity_article_runtime', label: 'Mental health parity article', file: 'blog/mental-health-parity-illinois.html', tokens: ['Mental Health Parity', 'Illinois', 'PMHNP'], minBytes: 5000 },
  { id: 'clearinghouse_rejections_article_runtime', label: '277CA clearinghouse rejection checklist', file: 'blog/pmhnp-billing-chicago-277ca-rejections-clearinghouse-edits-first-pass-acceptance-checklist-2026.html', tokens: ['277CA', 'clearinghouse', 'First-pass'], minBytes: 5000 },
  { id: 'authorization_denials_article_runtime', label: 'CO-197 authorization denial checklist', file: 'blog/pmhnp-billing-chicago-co-197-denials-no-authorization-on-file-retro-auth-recovery-checklist-2026.html', tokens: ['CO-197', 'authorization', 'Recovery'], minBytes: 5000 },
  { id: 'eligibility_cob_article_runtime', label: 'Eligibility and COB denial prevention checklist', file: 'blog/pmhnp-billing-chicago-eligibility-verification-cob-front-end-denial-prevention-checklist-2026.html', tokens: ['Eligibility', 'COB', 'denial prevention'], minBytes: 5000 },
  { id: 'era_eob_article_runtime', label: 'ERA EOB reconciliation checklist', file: 'blog/pmhnp-billing-chicago-era-eob-posting-plb-takebacks-reconciliation-checklist-2026.html', tokens: ['ERA', 'EOB', 'reconciliation'], minBytes: 5000 },
  { id: 'timely_filing_article_runtime', label: 'Timely filing limits checklist', file: 'blog/pmhnp-billing-chicago-timely-filing-limits-corrected-claims-reconsideration-timeline-checklist-2026.html', tokens: ['Timely Filing', 'Corrected Claims', 'timeline'], minBytes: 5000 },
  { id: 'private_dashboard_runtime', label: 'Private lead-generation dashboard', file: 'private-dashboard/index.html', tokens: ['Lead Generation Dashboard', 'Private', 'PMHNP'], minBytes: 10000 },
  { id: 'private_outreach_runtime', label: 'Private daily outreach dashboard', file: 'private-dashboard/outreach.html', tokens: ['Daily Outreach', 'PMHNP', 'outreach'], minBytes: 3000 },
  { id: 'private_prospects_runtime', label: 'Private prospects database dashboard', file: 'private-dashboard/prospects.html', tokens: ['Prospects Database', 'Private', 'PMHNP'], minBytes: 5000 },
  { id: 'site_interaction_js_runtime', label: 'Global site interaction JavaScript', file: 'assets/site.js', tokens: ['prefersReducedMotion', 'querySelector', 'menu'], minBytes: 1000 },
  { id: 'claim_guard_app_js_runtime', label: 'Claim Guard client app JavaScript', file: 'app/app.js', tokens: ['CLIENT_TOKEN_KEY', 'FALLBACK_SNAPSHOT', 'fetch'], minBytes: 10000 }
]);

export function getPmhnpSiteTier2Surface(id) {
  return PMHNP_SITE_TIER2_SURFACES.find((entry) => entry.id === id) || null;
}
