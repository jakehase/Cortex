import { buildCampaignLedgerSnapshot, createCampaignLedgerRouteSummary } from '../service-campaign-ledger.mjs';

export function createCampaignLedgerRegistryRoutes(basePath = '/registry/campaign-ledger') {
  const snapshot = buildCampaignLedgerSnapshot();
  return [
    { id: 'campaign-ledger.registry.summary', method: 'GET', path: basePath, summary: createCampaignLedgerRouteSummary(snapshot) },
    { id: 'campaign-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

