import { buildCampaignSentinelSnapshot, createCampaignSentinelReadinessBoard } from '../service-campaign-sentinel.mjs';

export function createCampaignSentinelOpsRoutes(basePath = '/ops/campaign-sentinel') {
  const snapshot = buildCampaignSentinelSnapshot();
  return [
    { id: 'campaign-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignSentinelReadinessBoard(snapshot) },
    { id: 'campaign-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

