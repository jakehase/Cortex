import { buildAnalyticsNotebookSnapshot, createAnalyticsNotebookReadinessBoard } from '../service-analytics-notebook.mjs';

export function createAnalyticsNotebookOpsRoutes(basePath = '/ops/analytics-notebook') {
  const snapshot = buildAnalyticsNotebookSnapshot();
  return [
    { id: 'analytics-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsNotebookReadinessBoard(snapshot) },
    { id: 'analytics-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

