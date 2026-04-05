import { buildCampaignWorkbenchSnapshot, createCampaignWorkbenchReadinessBoard } from '../service-campaign-workbench.mjs';

export function createCampaignWorkbenchOpsRoutes(basePath = '/ops/campaign-workbench') {
  const snapshot = buildCampaignWorkbenchSnapshot();
  return [
    { id: 'campaign-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignWorkbenchReadinessBoard(snapshot) },
    { id: 'campaign-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

