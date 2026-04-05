import { buildCampaignPlannerSnapshot, createCampaignPlannerReadinessBoard } from '../service-campaign-planner.mjs';

export function createCampaignPlannerOpsRoutes(basePath = '/ops/campaign-planner') {
  const snapshot = buildCampaignPlannerSnapshot();
  return [
    { id: 'campaign-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignPlannerReadinessBoard(snapshot) },
    { id: 'campaign-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

