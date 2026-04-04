import { buildCampaignAtlasSnapshot, createCampaignAtlasReadinessBoard } from '../service-campaign-atlas.mjs';

export function createCampaignAtlasOpsRoutes(basePath = '/ops/campaign-atlas') {
  const snapshot = buildCampaignAtlasSnapshot();
  return [
    { id: 'campaign-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignAtlasReadinessBoard(snapshot) },
    { id: 'campaign-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

