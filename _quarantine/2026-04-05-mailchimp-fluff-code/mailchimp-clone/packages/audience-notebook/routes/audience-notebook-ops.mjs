import { buildAudienceNotebookSnapshot, createAudienceNotebookReadinessBoard } from '../service-audience-notebook.mjs';

export function createAudienceNotebookOpsRoutes(basePath = '/ops/audience-notebook') {
  const snapshot = buildAudienceNotebookSnapshot();
  return [
    { id: 'audience-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceNotebookReadinessBoard(snapshot) },
    { id: 'audience-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

