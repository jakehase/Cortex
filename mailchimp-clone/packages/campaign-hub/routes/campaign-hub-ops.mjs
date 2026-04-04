import { buildCampaignHubSnapshot, createCampaignHubReadinessBoard } from '../service-campaign-hub.mjs';

export function createCampaignHubOpsRoutes(basePath = '/ops/campaign-hub') {
  const snapshot = buildCampaignHubSnapshot();
  return [
    { id: 'campaign-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignHubReadinessBoard(snapshot) },
    { id: 'campaign-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

