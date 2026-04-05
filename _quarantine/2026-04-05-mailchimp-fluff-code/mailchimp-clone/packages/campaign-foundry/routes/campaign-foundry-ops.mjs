import { buildCampaignFoundrySnapshot, createCampaignFoundryReadinessBoard } from '../service-campaign-foundry.mjs';

export function createCampaignFoundryOpsRoutes(basePath = '/ops/campaign-foundry') {
  const snapshot = buildCampaignFoundrySnapshot();
  return [
    { id: 'campaign-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignFoundryReadinessBoard(snapshot) },
    { id: 'campaign-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

