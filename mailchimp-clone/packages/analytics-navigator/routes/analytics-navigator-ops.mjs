import { buildAnalyticsNavigatorSnapshot, createAnalyticsNavigatorReadinessBoard } from '../service-analytics-navigator.mjs';

export function createAnalyticsNavigatorOpsRoutes(basePath = '/ops/analytics-navigator') {
  const snapshot = buildAnalyticsNavigatorSnapshot();
  return [
    { id: 'analytics-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsNavigatorReadinessBoard(snapshot) },
    { id: 'analytics-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

