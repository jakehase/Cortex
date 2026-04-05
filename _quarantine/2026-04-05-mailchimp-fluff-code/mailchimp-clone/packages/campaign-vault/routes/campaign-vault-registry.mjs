import { buildCampaignVaultSnapshot, createCampaignVaultRouteSummary } from '../service-campaign-vault.mjs';

export function createCampaignVaultRegistryRoutes(basePath = '/registry/campaign-vault') {
  const snapshot = buildCampaignVaultSnapshot();
  return [
    { id: 'campaign-vault.registry.summary', method: 'GET', path: basePath, summary: createCampaignVaultRouteSummary(snapshot) },
    { id: 'campaign-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

