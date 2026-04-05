import { buildCampaignLedgerSnapshot, createCampaignLedgerApiDocument } from '../service-campaign-ledger.mjs';

export function createCampaignLedgerApiRoutes(basePath = '/api/campaign-ledger') {
  const snapshot = buildCampaignLedgerSnapshot();
  return [
    { id: 'campaign-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-ledger.api.document', method: 'GET', path: basePath + '/document', document: createCampaignLedgerApiDocument(snapshot) }
  ];
}

