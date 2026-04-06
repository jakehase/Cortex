import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createRouter } from '../../packages/app/router.mjs';
import { createAppState } from '../../packages/app/storage.mjs';
import { createId, redirect, text } from '../../packages/app/utils.mjs';
import { apiActor, getCurrentActor } from '../../packages/app/domain-core.mjs';
import { page, requireActor } from '../../packages/app/view.mjs';
import { startJobLoop } from '../../packages/app/job-runtime.mjs';
import { pruneSecurityState, securityHeaders } from '../../packages/app/security.mjs';
import { registerPublicRoutes } from '../../packages/app/routes/public.mjs';
import { registerPlatformRoutes } from '../../packages/app/routes/platform.mjs';
import { registerApiAdminRoutes } from '../../packages/app/routes/api-admin.mjs';
import { registerAudienceRoutes } from '../../packages/app/routes/audience.mjs';
import { registerCampaignRoutes } from '../../packages/app/routes/campaigns.mjs';
import { registerAutomationRoutes } from '../../packages/app/routes/automations.mjs';
import { registerFormRoutes } from '../../packages/app/routes/forms.mjs';
import { registerReportRoutes } from '../../packages/app/routes/reports.mjs';
import { registerContentAssetTemplateRoutes } from '../../packages/app/routes/content-asset-templates.mjs';
import { registerIntegrationsMarketplaceRoutes } from '../../packages/app/routes/integrations-marketplace.mjs';
import { registerCommerceRevenueRoutes } from '../../packages/app/routes/commerce-revenue.mjs';
import { registerCollaborationApprovalRoutes } from '../../packages/app/routes/collaboration-approval.mjs';
import { registerDeliverabilityComplianceRoutes } from '../../packages/app/routes/deliverability-compliance.mjs';
import { registerCurrentProductParityRoutes } from '../../packages/app/routes/current-product-parity.mjs';
import { registerConversationInboxRoutes } from '../../packages/conversation-inbox/index.mjs';
import { registerPreferencesCenterRoutes } from '../../packages/preferences-center/index.mjs';
import { registerCustomerJourneyRoutes } from '../../packages/customer-journeys/index.mjs';
import { registerSurveyFeedbackRoutes } from '../../packages/surveys-feedback/index.mjs';

export function createServer() {
  const state = createAppState();
  const router = createRouter();
  const deps = { createId, apiActor, getCurrentActor, requireAuth: (innerState, req, res) => requireActor(innerState, req, res, redirect, getCurrentActor) };
  registerPublicRoutes(router, deps);
  registerPlatformRoutes(router, deps);
  registerApiAdminRoutes(router, deps);
  registerAudienceRoutes(router, deps);
  registerCampaignRoutes(router, deps);
  registerAutomationRoutes(router, deps);
  registerFormRoutes(router, deps);
  registerReportRoutes(router, deps);
  registerContentAssetTemplateRoutes(router, deps);
  registerIntegrationsMarketplaceRoutes(router, deps);
  registerCommerceRevenueRoutes(router, deps);
  registerCollaborationApprovalRoutes(router, deps);
  registerDeliverabilityComplianceRoutes(router, deps);
  registerCurrentProductParityRoutes(router, deps);
  registerConversationInboxRoutes(router, deps);
  registerPreferencesCenterRoutes(router, deps);
  registerCustomerJourneyRoutes(router, deps);
  registerSurveyFeedbackRoutes(router, deps);

  const server = http.createServer(async (req, res) => {
    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);
    pruneSecurityState(state);
    const url = new URL(req.url, 'http://local');
    const handled = await router.handle({ state, req, res, url });
    if (!handled) text(res, 404, page('Not found', getCurrentActor(state, req), '<div class="warn">Route not found.</div>'));
  });

  server.start = ({ port = 3000 } = {}) => new Promise((resolve) => {
    state.jobLoop = startJobLoop(state, 100);
    server.listen(port, () => resolve(server.address()));
  });
  server.stop = () => new Promise((resolve, reject) => {
    if (state.jobLoop) state.jobLoop.stop();
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.state = state;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.start({ port }).then((address) => console.log(`Anchor Mailer listening on http://127.0.0.1:${address.port}`));
}
