import { page } from '../view.mjs';
import { text, escapeHtml } from '../utils.mjs';
import { summarizeAttributionModeling } from '../../attribution-modeling/index.mjs';
import { summarizeBenchmarkStudio } from '../../benchmark-studio/index.mjs';
import { summarizeCalendarApprovals } from '../../calendar-approvals/index.mjs';
import { summarizeCampaignSandboxes } from '../../campaign-sandboxes/index.mjs';
import { summarizeChannelPlaybooks } from '../../channel-playbooks/index.mjs';
import { summarizeComplianceIncidents } from '../../compliance-incidents/index.mjs';
import { summarizeConsentLedger } from '../../consent-ledger/index.mjs';
import { summarizeCreativeBriefBuilder } from '../../creative-brief-builder/index.mjs';
import { summarizeCreativeQa } from '../../creative-qa/index.mjs';
import { summarizeCustomerHealth } from '../../customer-health/index.mjs';
import { summarizeDataActivation } from '../../data-activation/index.mjs';
import { summarizeDeliverabilityWarRoom } from '../../deliverability-war-room/index.mjs';
import { summarizeEcommerceInsights } from '../../ecommerce-insights/index.mjs';
import { summarizeEngagementForecasting } from '../../engagement-forecasting/index.mjs';
import { summarizeLocalizationQa } from '../../localization-qa/index.mjs';
import { summarizeMultiAccountControl } from '../../multi-account-control/index.mjs';
import { summarizePartnerCertification } from '../../partner-certification/index.mjs';
import { summarizePredictiveSegments } from '../../predictive-segments/index.mjs';
import { summarizeProfileEnrichment } from '../../profile-enrichment/index.mjs';
import { summarizeReleaseCommandCenter } from '../../release-command-center/index.mjs';
import { summarizeRetentionOffers } from '../../retention-offers/index.mjs';
import { summarizeRevenueAttribution } from '../../revenue-attribution/index.mjs';
import { summarizeSegmentationQuality } from '../../segmentation-quality/index.mjs';
import { summarizeSenderRotation } from '../../sender-rotation/index.mjs';
import { summarizeServiceRecovery } from '../../service-recovery/index.mjs';
import { summarizeSubscriptionIntelligence } from '../../subscription-intelligence/index.mjs';
import { summarizeTemplateApprovals } from '../../template-approvals/index.mjs';
import { summarizeTemplateVariants } from '../../template-variants/index.mjs';
import { summarizeTrustAutomation } from '../../trust-automation/index.mjs';
import { summarizeWebhookInspector } from '../../webhook-inspector/index.mjs';

const WAVE6_GROUPS = [
  { title: "Growth & planning", modules: [
      { id: "attribution-modeling", ...summarizeAttributionModeling() },
      { id: "benchmark-studio", ...summarizeBenchmarkStudio() },
      { id: "calendar-approvals", ...summarizeCalendarApprovals() },
      { id: "campaign-sandboxes", ...summarizeCampaignSandboxes() },
      { id: "channel-playbooks", ...summarizeChannelPlaybooks() },
      { id: "compliance-incidents", ...summarizeComplianceIncidents() }
    ] },
  { title: "Compliance & trust", modules: [
      { id: "consent-ledger", ...summarizeConsentLedger() },
      { id: "creative-brief-builder", ...summarizeCreativeBriefBuilder() },
      { id: "creative-qa", ...summarizeCreativeQa() },
      { id: "customer-health", ...summarizeCustomerHealth() },
      { id: "data-activation", ...summarizeDataActivation() },
      { id: "deliverability-war-room", ...summarizeDeliverabilityWarRoom() }
    ] },
  { title: "Lifecycle & retention", modules: [
      { id: "ecommerce-insights", ...summarizeEcommerceInsights() },
      { id: "engagement-forecasting", ...summarizeEngagementForecasting() },
      { id: "localization-qa", ...summarizeLocalizationQa() },
      { id: "multi-account-control", ...summarizeMultiAccountControl() },
      { id: "partner-certification", ...summarizePartnerCertification() },
      { id: "predictive-segments", ...summarizePredictiveSegments() }
    ] },
  { title: "Data & segmentation", modules: [
      { id: "profile-enrichment", ...summarizeProfileEnrichment() },
      { id: "release-command-center", ...summarizeReleaseCommandCenter() },
      { id: "retention-offers", ...summarizeRetentionOffers() },
      { id: "revenue-attribution", ...summarizeRevenueAttribution() },
      { id: "segmentation-quality", ...summarizeSegmentationQuality() },
      { id: "sender-rotation", ...summarizeSenderRotation() }
    ] },
  { title: "Templates & ecosystem", modules: [
      { id: "service-recovery", ...summarizeServiceRecovery() },
      { id: "subscription-intelligence", ...summarizeSubscriptionIntelligence() },
      { id: "template-approvals", ...summarizeTemplateApprovals() },
      { id: "template-variants", ...summarizeTemplateVariants() },
      { id: "trust-automation", ...summarizeTrustAutomation() },
      { id: "webhook-inspector", ...summarizeWebhookInspector() }
    ] }
];

const APP_SHELLS = ["Lifecycle Studio","Compliance Hub","Integrations Studio"];

function renderGroup(group) {
  return '<section class="card"><h3>' + escapeHtml(group.title) + '</h3><div class="grid">' + group.modules.map((module) => '<div class="card"><h4>' + escapeHtml(module.name) + '</h4><p>' + escapeHtml(module.focus) + '</p><p>Metrics: ' + module.metricCount + ' · Active programs: ' + module.activePrograms + '</p></div>').join('') + '</div></section>';
}

export function registerScaleWaveSixRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/scale-wave-six', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;

    const totalModules = WAVE6_GROUPS.reduce((sum, group) => sum + group.modules.length, 0);
    const totalMetrics = WAVE6_GROUPS.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.metricCount, 0), 0);
    const body = [
      '<div class="grid">',
      '<section class="card">',
      '<h3>Wave 6 scale expansion</h3>',
      '<p>This page exposes the first true large-scale expansion wave wired into the main authenticated product shell.</p>',
      '<p>Total new modules: ' + totalModules + ' · Total scorecards: ' + totalMetrics + ' · New app shells: ' + APP_SHELLS.length + '</p>',
      '<p>App shells: ' + escapeHtml(APP_SHELLS.join(', ')) + '</p>',
      '</section>',
      '</div>',
      WAVE6_GROUPS.map(renderGroup).join('')
    ].join('');

    text(res, 200, page('Scale Wave Six', actor, body));
  });
}

