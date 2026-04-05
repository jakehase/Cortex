import { buildCampaignCockpitSnapshot, createCampaignCockpitReadinessBoard } from '../service-campaign-cockpit.mjs';

export function createCampaignCockpitOpsRoutes(basePath = '/ops/campaign-cockpit') {
  const snapshot = buildCampaignCockpitSnapshot();
  return [
    { id: 'campaign-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignCockpitReadinessBoard(snapshot) },
    { id: 'campaign-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

