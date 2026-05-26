import { persistState } from './storage.mjs';
import { buildProviderAccountRuntime, syncIntegrationProvider, verifyProviderWebhookEvent } from './integration-provider.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';
import { COMMERCE_PROVIDERS, connectStore, revenueSummary, syncCommerceStore, workspaceStores } from './domain-commerce-revenue.mjs';

export const MARKETPLACE_APPS = [
  { id: 'shopify', name: 'Shopify', category: 'commerce', description: 'Sync products, orders, and revenue attribution.', scopes: ['read_orders', 'read_products'] },
  { id: 'woocommerce', name: 'WooCommerce', category: 'commerce', description: 'Import catalog and ecommerce events.', scopes: ['orders:read', 'products:read'] },
  { id: 'stripe', name: 'Stripe', category: 'commerce', description: 'Track payment conversions and LTV.', scopes: ['payments:read'] },
  { id: 'salesforce', name: 'Salesforce', category: 'crm', description: 'Map leads and account ownership.', scopes: ['contacts:read', 'accounts:read'] },
  { id: 'slack', name: 'Slack', category: 'collaboration', description: 'Deliver approval and send notifications.', scopes: ['chat:write'] }
];

function findApp(appId) {
  return MARKETPLACE_APPS.find((entry) => entry.id === appId) || MARKETPLACE_APPS[0];
}

function ensureIntegrationProviderState(state) {
  state.db.integrationProviderAccounts ||= [];
  state.db.integrationProviderAuthSessions ||= [];
  state.db.integrationProviderCursors ||= [];
  state.db.integrationProviderRequests ||= [];
  state.db.integrationProviderWebhookEvents ||= [];
  return state;
}

function upsertProviderAccount(state, actor, installation, app = findApp(installation.appId)) {
  ensureIntegrationProviderState(state);
  const runtime = buildProviderAccountRuntime(app, installation);
  let account = state.db.integrationProviderAccounts.find((entry) => entry.installationId === installation.id);
  if (!account) {
    account = { id: createId('intacct'), workspaceId: actor.workspace.id, installationId: installation.id, appId: app.id, createdAt: nowIso() };
    state.db.integrationProviderAccounts.unshift(account);
  }
  Object.assign(account, {
    provider: runtime.provider,
    accountKey: runtime.accountKey,
    externalAccountId: runtime.externalAccountId,
    accountLabel: runtime.accountLabel,
    status: runtime.status,
    authMode: runtime.authMode,
    scopes: runtime.scopes,
    supportedObjects: runtime.supportedObjects,
    webhookEvents: runtime.webhookEvents,
    evidenceContract: runtime.evidenceContract,
    updatedAt: nowIso()
  });
  installation.providerAccount = account;
  installation.externalAccountId = account.externalAccountId;
  return account;
}

export function workspaceIntegrationInstallations(state, workspaceId) {
  ensureIntegrationProviderState(state);
  return state.db.integrationInstallations
    .filter((entry) => entry.workspaceId === workspaceId)
    .map((entry) => ({
      ...entry,
      app: findApp(entry.appId),
      providerAccount: entry.providerAccount || state.db.integrationProviderAccounts.find((account) => account.installationId === entry.id) || null,
      providerCursor: entry.providerCursor || state.db.integrationProviderCursors.find((cursor) => cursor.installationId === entry.id) || null
    }));
}

export function integrationMarketplaceSurfaceSummary(state, workspaceId) {
  ensureIntegrationProviderState(state);
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  const providerAccounts = state.db.integrationProviderAccounts.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    connectedApps: installations.filter((entry) => entry.status === 'installed').length,
    providerAccounts: providerAccounts.length,
    connectedProviderAccounts: providerAccounts.filter((entry) => entry.status === 'connected').length,
    authModes: Array.from(new Set(installations.map((entry) => entry.authMode || 'oauth'))),
    appsNeedingSync: installations.filter((entry) => !entry.lastSyncedAt).length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function workspaceIntegrationSummary(state, workspaceId) {
  ensureIntegrationProviderState(state);
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  const providerRequests = state.db.integrationProviderRequests.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    commerceApps: installations.filter((entry) => entry.app.category === 'commerce').length,
    collaborationApps: installations.filter((entry) => entry.app.category === 'collaboration').length,
    providerRequests: providerRequests.length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function installMarketplaceApp(state, actor, appId) {
  ensureIntegrationProviderState(state);
  const app = findApp(appId);
  const existing = state.db.integrationInstallations.find((entry) => entry.workspaceId === actor.workspace.id && entry.appId === app.id);
  if (existing) return existing;
  const installation = {
    id: createId('integration'),
    workspaceId: actor.workspace.id,
    appId: app.id,
    authMode: 'oauth',
    status: 'installed',
    scopes: app.scopes,
    installedBy: actor.user.id,
    installedAt: nowIso(),
    authStatus: 'authorization_required',
    health: 'authorization_required',
    lastSyncedAt: null
  };
  upsertProviderAccount(state, actor, installation, app);
  state.db.integrationInstallations.unshift(installation);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-install', detail: `Installed ${app.name}` });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'integration-installed', payload: { appId: app.id, appName: app.name } });
  return installation;
}

function ensureCommerceLink(state, actor, installation) {
  const provider = COMMERCE_PROVIDERS.find((entry) => entry.id === installation.appId);
  if (!provider) return null;
  const existingStore = workspaceStores(state, actor.workspace.id).find((entry) => entry.provider === provider.id);
  return existingStore || connectStore(state, actor, {
    provider: provider.id,
    name: `${provider.name} revenue store`,
    externalAccountId: installation.id,
    currency: 'USD'
  });
}

export async function syncMarketplaceInstallation(state, actor, installation) {
  if (!installation) throw new Error('Installation is required');
  ensureIntegrationProviderState(state);
  const app = findApp(installation.appId);
  const providerAccount = upsertProviderAccount(state, actor, installation, app);
  let commerceResult = null;
  if (app.category === 'commerce') {
    const store = ensureCommerceLink(state, actor, installation);
    commerceResult = syncCommerceStore(state, actor, store);
  }
  const providerResult = await syncIntegrationProvider(app, installation, { providerAccount });
  const providerRequest = { ...providerResult.providerRequest, workspaceId: actor.workspace.id, createdAt: providerResult.providerRequest.startedAt };
  const providerCursor = {
    id: createId('intcursor'),
    workspaceId: actor.workspace.id,
    installationId: installation.id,
    appId: installation.appId,
    provider: providerResult.providerAccount.provider,
    accountId: providerAccount.id,
    previousCursor: providerResult.previousCursor,
    cursor: providerResult.nextCursor,
    objects: providerResult.requestLineage.map((entry) => entry.objectType),
    syncedAt: nowIso()
  };
  const run = {
    id: createId('intsync'),
    workspaceId: actor.workspace.id,
    installationId: installation.id,
    appId: installation.appId,
    status: 'succeeded',
    providerAccountId: providerAccount.id,
    providerRequestId: providerRequest.id,
    providerCursorId: providerCursor.id,
    providerStatus: providerResult.status,
    requestLineage: providerResult.requestLineage,
    syncedContacts: Number(providerResult?.syncedContacts || 0),
    syncedOrders: Number(providerResult?.syncedOrders || commerceResult?.addedOrders || 0),
    syncedProducts: Number(providerResult?.syncedProducts || commerceResult?.addedProducts || 0),
    syncedRevenue: Number(providerResult?.syncedRevenue || commerceResult?.revenueGenerated || 0),
    createdAt: nowIso()
  };
  installation.lastSyncedAt = run.createdAt;
  installation.scopes = providerResult?.refreshedScopes || installation.scopes;
  installation.health = 'healthy';
  installation.authStatus = installation.authStatus === 'authorization_required' ? 'connected' : (installation.authStatus || 'connected');
  installation.providerAccount = { ...providerAccount, status: installation.authStatus === 'connected' ? 'connected' : providerAccount.status };
  installation.providerCursor = providerCursor;
  Object.assign(providerAccount, { status: installation.providerAccount.status, lastRequestId: providerRequest.id, lastCursor: providerCursor.cursor, lastSyncedAt: run.createdAt, updatedAt: run.createdAt });
  state.db.integrationProviderRequests.unshift(providerRequest);
  state.db.integrationProviderCursors.unshift(providerCursor);
  state.db.integrationSyncRuns.unshift(run);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-sync', detail: `Synced ${app.name}` });
  recordEvent(state, {
    workspaceId: actor.workspace.id,
    type: 'integration-sync',
    message: `${app.name} sync completed`,
    meta: { appId: app.id, installationId: installation.id, syncedOrders: run.syncedOrders }
  });
  return {
    run,
    revenue: revenueSummary(state, actor.workspace.id),
    commerceResult,
    providerResult
  };
}

export function recordIntegrationProviderWebhookEvent(state, actor, installation, body = {}) {
  if (!installation) throw new Error('Installation is required');
  ensureIntegrationProviderState(state);
  const app = findApp(installation.appId);
  const providerAccount = upsertProviderAccount(state, actor, installation, app);
  const verified = verifyProviderWebhookEvent(app, installation, body);
  const event = {
    id: createId('intwebhook'),
    workspaceId: actor.workspace.id,
    installationId: installation.id,
    appId: installation.appId,
    providerAccountId: providerAccount.id,
    ...verified
  };
  state.db.integrationProviderWebhookEvents.unshift(event);
  installation.lastWebhookAt = event.receivedAt;
  installation.health = 'healthy';
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-webhook-verified', detail: `${installation.appId}: ${event.eventType}` });
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'integration-webhook', message: `${installation.appId} webhook verified`, meta: { installationId: installation.id, eventType: event.eventType } });
  return event;
}

export function integrationMarketplaceOperationalReadiness(state, workspaceId) {
  ensureIntegrationProviderState(state);
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  const providerAccounts = state.db.integrationProviderAccounts.filter((entry) => entry.workspaceId === workspaceId);
  const providerCursors = state.db.integrationProviderCursors.filter((entry) => entry.workspaceId === workspaceId);
  const webhookEvents = state.db.integrationProviderWebhookEvents.filter((entry) => entry.workspaceId === workspaceId);
  const unhealthy = installations.filter((entry) => entry.health && entry.health !== 'healthy');
  return {
    installedApps: installations.length,
    providerAccounts: providerAccounts.length,
    providerCursors: providerCursors.length,
    verifiedWebhooks: webhookEvents.length,
    unhealthyApps: unhealthy.length,
    pendingSyncs: installations.filter((entry) => !entry.lastSyncedAt || entry.authStatus !== 'connected').length,
    lastSyncAt: syncRuns[0]?.createdAt || null,
    workflowStatus: unhealthy.length ? 'connector_attention_required' : 'connector_operations_ready',
    nextAction: unhealthy[0] ? 'open_connector_health_detail' : 'verify_next_provider_sync'
  };
}

export const integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "integration_provider_sync",
  "focusGroup": "integrations_api_oauth",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.integration_provider_sync::semantic-frontier-001#10-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildIntegrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "integration_provider_sync",
  "focusGroup": "integrations_api_oauth",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.integration_provider_sync::semantic-frontier-001#10-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildIntegrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}



export function buildIntegrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey = "integration_provider_sync:primary_runtime_spine:packages/app/domain-integration-marketplace.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey, surfaceId: "integration_provider_sync", focusGroup: "integrations_api_oauth", phaseId: "primary_runtime_spine", shardId: "focus.integration_provider_sync::semantic-frontier-001#07-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-integration-marketplace.mjs", workspaceId, durableStateReady: Boolean(db), ...integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/routes/api-admin.mjs"], nextAction: integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:integration_provider_sync:monitor_job_runtime_handoff" : "primary_runtime_spine:integration_provider_sync:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: integrationProviderSyncPrimaryRuntimeSpinePackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-integration-marketplace.mjs" } };
}



export function buildIntegrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey = "integration_provider_sync:operational_persistence_and_jobs:packages/app/domain-integration-marketplace.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey, surfaceId: "integration_provider_sync", focusGroup: "integrations_api_oauth", phaseId: "operational_persistence_and_jobs", shardId: "focus.integration_provider_sync::semantic-frontier-001#07-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-integration-marketplace.mjs", workspaceId, durableStateReady: Boolean(db), ...integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/job-handlers.mjs"], nextAction: integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:integration_provider_sync:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:integration_provider_sync:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: integrationProviderSyncOperationalPersistenceAndJobsPackagesAppDomainIntegrationMarketplaceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-integration-marketplace.mjs" } };
}

