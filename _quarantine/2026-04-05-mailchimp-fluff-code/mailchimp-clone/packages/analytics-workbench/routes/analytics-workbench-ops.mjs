import { buildAnalyticsWorkbenchSnapshot, createAnalyticsWorkbenchReadinessBoard } from '../service-analytics-workbench.mjs';

export function createAnalyticsWorkbenchOpsRoutes(basePath = '/ops/analytics-workbench') {
  const snapshot = buildAnalyticsWorkbenchSnapshot();
  return [
    { id: 'analytics-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsWorkbenchReadinessBoard(snapshot) },
    { id: 'analytics-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

