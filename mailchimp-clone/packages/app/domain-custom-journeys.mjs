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
