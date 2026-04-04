import { buildCampaignWatchtowerSnapshot, createCampaignWatchtowerReadinessBoard } from '../service-campaign-watchtower.mjs';

export function createCampaignWatchtowerOpsRoutes(basePath = '/ops/campaign-watchtower') {
  const snapshot = buildCampaignWatchtowerSnapshot();
  return [
    { id: 'campaign-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignWatchtowerReadinessBoard(snapshot) },
    { id: 'campaign-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

