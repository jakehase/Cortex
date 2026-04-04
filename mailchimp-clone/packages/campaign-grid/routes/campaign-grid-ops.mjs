import { buildCampaignGridSnapshot, createCampaignGridReadinessBoard } from '../service-campaign-grid.mjs';

export function createCampaignGridOpsRoutes(basePath = '/ops/campaign-grid') {
  const snapshot = buildCampaignGridSnapshot();
  return [
    { id: 'campaign-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignGridReadinessBoard(snapshot) },
    { id: 'campaign-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

