import { buildCampaignVaultSnapshot, createCampaignVaultApiDocument } from '../service-campaign-vault.mjs';

export function createCampaignVaultApiRoutes(basePath = '/api/campaign-vault') {
  const snapshot = buildCampaignVaultSnapshot();
  return [
    { id: 'campaign-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-vault.api.document', method: 'GET', path: basePath + '/document', document: createCampaignVaultApiDocument(snapshot) }
  ];
}

