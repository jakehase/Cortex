import { buildCampaignVaultSnapshot, createCampaignVaultReadinessBoard } from '../service-campaign-vault.mjs';

export function createCampaignVaultOpsRoutes(basePath = '/ops/campaign-vault') {
  const snapshot = buildCampaignVaultSnapshot();
  return [
    { id: 'campaign-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignVaultReadinessBoard(snapshot) },
    { id: 'campaign-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

