import { buildInsightsWorkbenchSnapshot, createInsightsWorkbenchReadinessBoard } from '../service-insights-workbench.mjs';

export function createInsightsWorkbenchOpsRoutes(basePath = '/ops/insights-workbench') {
  const snapshot = buildInsightsWorkbenchSnapshot();
  return [
    { id: 'insights-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsWorkbenchReadinessBoard(snapshot) },
    { id: 'insights-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

