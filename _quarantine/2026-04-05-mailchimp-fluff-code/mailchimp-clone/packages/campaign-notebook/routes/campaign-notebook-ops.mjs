import { buildCampaignNotebookSnapshot, createCampaignNotebookReadinessBoard } from '../service-campaign-notebook.mjs';

export function createCampaignNotebookOpsRoutes(basePath = '/ops/campaign-notebook') {
  const snapshot = buildCampaignNotebookSnapshot();
  return [
    { id: 'campaign-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignNotebookReadinessBoard(snapshot) },
    { id: 'campaign-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

