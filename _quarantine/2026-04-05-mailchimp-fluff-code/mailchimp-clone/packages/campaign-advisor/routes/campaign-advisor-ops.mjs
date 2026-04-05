import { buildCampaignAdvisorSnapshot, createCampaignAdvisorReadinessBoard } from '../service-campaign-advisor.mjs';

export function createCampaignAdvisorOpsRoutes(basePath = '/ops/campaign-advisor') {
  const snapshot = buildCampaignAdvisorSnapshot();
  return [
    { id: 'campaign-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignAdvisorReadinessBoard(snapshot) },
    { id: 'campaign-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

