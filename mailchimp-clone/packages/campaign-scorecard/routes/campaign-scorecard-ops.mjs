import { buildCampaignScorecardSnapshot, createCampaignScorecardReadinessBoard } from '../service-campaign-scorecard.mjs';

export function createCampaignScorecardOpsRoutes(basePath = '/ops/campaign-scorecard') {
  const snapshot = buildCampaignScorecardSnapshot();
  return [
    { id: 'campaign-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignScorecardReadinessBoard(snapshot) },
    { id: 'campaign-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

