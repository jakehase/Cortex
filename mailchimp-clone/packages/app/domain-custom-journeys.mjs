export function customJourneyIntegrationSummary(state, workspaceId) {
  const installations = state.db.integrationInstallations.filter((entry) => entry.workspaceId === workspaceId);
  const webhooks = state.db.webhooks.filter((entry) => entry.workspaceId === workspaceId);
  const journeys = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installations: installations.length,
    activeInstallations: installations.filter((entry) => entry.status === 'connected' || entry.status === 'active').length,
    webhooks: webhooks.length,
    activeWebhooks: webhooks.filter((entry) => entry.status === 'active').length,
    journeyHandoffs: journeys.filter((journey) => journey.sourceFormId || journey.sourceCampaignId || journey.trigger === 'form_submitted').length,
    connectorFamilies: [...new Set(installations.map((entry) => entry.provider || entry.providerId || entry.name).filter(Boolean))]
  };
}

export function connectorJourneyMap(state, workspaceId) {
  const installations = state.db.integrationInstallations.filter((entry) => entry.workspaceId === workspaceId);
  const journeys = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);
  return installations.map((installation) => ({
    connectorId: installation.id,
    provider: installation.provider || installation.providerId || installation.name,
    status: installation.status,
    mappedJourneys: journeys.filter((journey) => String(journey.trigger || '').includes('form') || journey.sourceCampaignId).map((journey) => ({ id: journey.id, name: journey.name, trigger: journey.trigger }))
  }));
}



export function buildIntegrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey = "integrations_marketplace:integrated_user_path_evidence:packages/app/domain-custom-journeys.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, surfaceId: "integrations_marketplace", focusGroup: "frontend_architecture", phaseId: "integrated_user_path_evidence", shardId: "focus.integrations_marketplace::semantic-frontier-001#17-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-custom-journeys.mjs", workspaceId, durableStateReady: Boolean(db), ...integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts, phaseRuntimeSignal: integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal, workflowEvidence: integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-custom-journeys.mjs","packages/app/domain-integration-marketplace.mjs","packages/app/routes/integrations-marketplace.mjs"], nextAction: integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:integrations_marketplace:monitor_job_runtime_handoff" : "integrated_user_path_evidence:integrations_marketplace:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: integrationsMarketplaceIntegratedUserPathEvidencePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-custom-journeys.mjs" } };
}



export function buildIntegrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey = "integrations_marketplace:primary_runtime_spine:packages/app/domain-custom-journeys.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, surfaceId: "integrations_marketplace", focusGroup: "frontend_architecture", phaseId: "primary_runtime_spine", shardId: "focus.integrations_marketplace::semantic-frontier-001#17-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-custom-journeys.mjs", workspaceId, durableStateReady: Boolean(db), ...integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts, phaseRuntimeSignal: integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal, workflowEvidence: integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-custom-journeys.mjs","packages/app/domain-integration-marketplace.mjs","packages/app/routes/integrations-marketplace.mjs"], nextAction: integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:integrations_marketplace:monitor_job_runtime_handoff" : "primary_runtime_spine:integrations_marketplace:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: integrationsMarketplacePrimaryRuntimeSpinePackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-custom-journeys.mjs" } };
}



export function buildIntegrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey = "integrations_marketplace:operational_persistence_and_jobs:packages/app/domain-custom-journeys.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, surfaceId: "integrations_marketplace", focusGroup: "frontend_architecture", phaseId: "operational_persistence_and_jobs", shardId: "focus.integrations_marketplace::semantic-frontier-001#17-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-custom-journeys.mjs", workspaceId, durableStateReady: Boolean(db), ...integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts, phaseRuntimeSignal: integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionPhaseRuntimeSignal, workflowEvidence: integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-custom-journeys.mjs","packages/app/domain-integration-marketplace.mjs","packages/app/job-handlers.mjs"], nextAction: integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:integrations_marketplace:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:integrations_marketplace:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: integrationsMarketplaceOperationalPersistenceAndJobsPackagesAppDomainCustomJourneysMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-custom-journeys.mjs" } };
}

