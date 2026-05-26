import { createHttpServer } from '../../packages/app/http-runtime.mjs';
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
import { registerLeadRoutes } from '../../packages/app/routes/leads.mjs';
import { registerReportRoutes } from '../../packages/app/routes/reports.mjs';
import { registerContentAssetTemplateRoutes } from '../../packages/app/routes/content-asset-templates.mjs';
import { registerContentLibraryRoutes } from '../../packages/app/routes/content-library.mjs';
import { registerContentOpsRoutes } from '../../packages/app/routes/content-ops.mjs';
import { registerTemplateRoutes } from '../../packages/app/routes/templates.mjs';
import { registerIntegrationRoutes } from '../../packages/app/routes/integrations.mjs';
import { registerCommerceRevenueRoutes } from '../../packages/app/routes/commerce-revenue.mjs';
import { registerCollaborationApprovalRoutes } from '../../packages/app/routes/collaboration-approval.mjs';
import { registerDeliverabilityComplianceRoutes } from '../../packages/app/routes/deliverability-compliance.mjs';
import { registerWebsiteRoutes } from '../../packages/app/routes/websites.mjs';
import { registerCurrentProductParityRoutes } from '../../packages/app/routes/current-product-parity.mjs';
import { registerConversationInboxRoutes } from '../../packages/conversation-inbox/index.mjs';
import { registerPreferencesCenterRoutes } from '../../packages/preferences-center/index.mjs';
import { registerCustomerJourneyRoutes } from '../../packages/customer-journeys/index.mjs';
import { registerSurveyFeedbackRoutes } from '../../packages/surveys-feedback/index.mjs';
import { registerMobileAppRoutes } from '../../packages/mobile-app/index.mjs';

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
  registerLeadRoutes(router, deps);
  registerReportRoutes(router, deps);
  registerContentAssetTemplateRoutes(router, deps);
  registerContentLibraryRoutes(router, deps);
  registerContentOpsRoutes(router, deps);
  registerTemplateRoutes(router, deps);
  registerIntegrationRoutes(router, deps);
  registerCommerceRevenueRoutes(router, deps);
  registerCollaborationApprovalRoutes(router, deps);
  registerDeliverabilityComplianceRoutes(router, deps);
  registerWebsiteRoutes(router, deps);
  registerCurrentProductParityRoutes(router, deps);
  registerConversationInboxRoutes(router, deps);
  registerPreferencesCenterRoutes(router, deps);
  registerCustomerJourneyRoutes(router, deps);
  registerSurveyFeedbackRoutes(router, deps);
  registerMobileAppRoutes(router, deps);

  const server = createHttpServer(async (req, res) => {
    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);
    pruneSecurityState(state);
    const url = new URL(req.url, 'http://local');
    const handled = await router.handle({ state, req, res, url });
    if (!handled) text(res, 404, page('Not found', getCurrentActor(state, req), '<div class="warn">Route not found.</div>'));
  });

  Object.assign(server, {
    start({ port = 3000 } = {}) {
      return new Promise((resolve) => {
        state.jobLoop = startJobLoop(state, 100);
        server.listen(port, () => resolve(server.address()));
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (state.jobLoop) state.jobLoop.stop();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    state
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.start({ port }).then((address) => console.log(`Anchor Mailer listening on http://127.0.0.1:${address.port}`));
}

export const persistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeContract = {
  "surfaceId": "persistence_jobs_operational_db",
  "focusGroup": "delivery_jobs",
  "phaseId": "interactive_state_and_commands",
  "shardId": "focus.persistence_jobs_operational_db::semantic-frontier-001#09-interactive_state_and_commands#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildPersistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...persistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: persistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeContract.surfaceId,
      phaseId: persistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeContract.phaseId,
      shardId: persistenceJobsOperationalDbInteractiveStateAndCommandsSemanticRuntimeContract.shardId
    }
  };
}

export const frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract = {
  "surfaceId": "frontend_client_shell_state",
  "focusGroup": "frontend_architecture",
  "phaseId": "interactive_state_and_commands",
  "shardId": "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildFrontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract.surfaceId,
      phaseId: frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract.phaseId,
      shardId: frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract.shardId
    }
  };
}

export const websiteBuilderInteractiveStateAndCommandsSemanticRuntimeContract = {
  "surfaceId": "website_builder",
  "focusGroup": "frontend_architecture",
  "phaseId": "interactive_state_and_commands",
  "shardId": "focus.website_builder::semantic-frontier-001#05-interactive_state_and_commands#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildWebsiteBuilderInteractiveStateAndCommandsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...websiteBuilderInteractiveStateAndCommandsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: websiteBuilderInteractiveStateAndCommandsSemanticRuntimeContract.surfaceId,
      phaseId: websiteBuilderInteractiveStateAndCommandsSemanticRuntimeContract.phaseId,
      shardId: websiteBuilderInteractiveStateAndCommandsSemanticRuntimeContract.shardId
    }
  };
}

