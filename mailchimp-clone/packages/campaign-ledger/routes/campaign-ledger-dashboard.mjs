import { buildCampaignLedgerSnapshot, createCampaignLedgerRouteSummary } from '../service-campaign-ledger.mjs';

export function createCampaignLedgerDashboardRoutes(basePath = '/campaign-ledger') {
  const snapshot = buildCampaignLedgerSnapshot();
  return [
    { id: 'campaign-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignLedgerRouteSummary(snapshot) },
    { id: 'campaign-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

