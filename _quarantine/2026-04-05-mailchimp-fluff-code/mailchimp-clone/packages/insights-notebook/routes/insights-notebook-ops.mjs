import { buildInsightsNotebookSnapshot, createInsightsNotebookReadinessBoard } from '../service-insights-notebook.mjs';

export function createInsightsNotebookOpsRoutes(basePath = '/ops/insights-notebook') {
  const snapshot = buildInsightsNotebookSnapshot();
  return [
    { id: 'insights-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsNotebookReadinessBoard(snapshot) },
    { id: 'insights-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

