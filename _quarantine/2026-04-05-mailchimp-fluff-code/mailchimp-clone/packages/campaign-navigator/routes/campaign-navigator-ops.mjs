import { buildCampaignNavigatorSnapshot, createCampaignNavigatorReadinessBoard } from '../service-campaign-navigator.mjs';

export function createCampaignNavigatorOpsRoutes(basePath = '/ops/campaign-navigator') {
  const snapshot = buildCampaignNavigatorSnapshot();
  return [
    { id: 'campaign-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignNavigatorReadinessBoard(snapshot) },
    { id: 'campaign-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

