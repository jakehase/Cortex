import { buildCampaignStudioSnapshot, createCampaignStudioReadinessBoard } from '../service-campaign-studio.mjs';

export function createCampaignStudioOpsRoutes(basePath = '/ops/campaign-studio') {
  const snapshot = buildCampaignStudioSnapshot();
  return [
    { id: 'campaign-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignStudioReadinessBoard(snapshot) },
    { id: 'campaign-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

