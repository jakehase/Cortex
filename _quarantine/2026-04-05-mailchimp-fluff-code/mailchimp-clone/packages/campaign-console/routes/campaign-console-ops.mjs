import { buildCampaignConsoleSnapshot, createCampaignConsoleReadinessBoard } from '../service-campaign-console.mjs';

export function createCampaignConsoleOpsRoutes(basePath = '/ops/campaign-console') {
  const snapshot = buildCampaignConsoleSnapshot();
  return [
    { id: 'campaign-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignConsoleReadinessBoard(snapshot) },
    { id: 'campaign-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

