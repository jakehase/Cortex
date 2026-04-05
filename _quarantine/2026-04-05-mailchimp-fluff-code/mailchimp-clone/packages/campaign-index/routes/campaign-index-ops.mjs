import { buildCampaignIndexSnapshot, createCampaignIndexReadinessBoard } from '../service-campaign-index.mjs';

export function createCampaignIndexOpsRoutes(basePath = '/ops/campaign-index') {
  const snapshot = buildCampaignIndexSnapshot();
  return [
    { id: 'campaign-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignIndexReadinessBoard(snapshot) },
    { id: 'campaign-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

