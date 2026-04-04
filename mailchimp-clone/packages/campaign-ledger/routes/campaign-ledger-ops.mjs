import { buildCampaignLedgerSnapshot, createCampaignLedgerReadinessBoard } from '../service-campaign-ledger.mjs';

export function createCampaignLedgerOpsRoutes(basePath = '/ops/campaign-ledger') {
  const snapshot = buildCampaignLedgerSnapshot();
  return [
    { id: 'campaign-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignLedgerReadinessBoard(snapshot) },
    { id: 'campaign-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

