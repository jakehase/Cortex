import { buildCampaignVaultSnapshot, createCampaignVaultRouteSummary } from '../service-campaign-vault.mjs';

export function createCampaignVaultDashboardRoutes(basePath = '/campaign-vault') {
  const snapshot = buildCampaignVaultSnapshot();
  return [
    { id: 'campaign-vault.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignVaultRouteSummary(snapshot) },
    { id: 'campaign-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

