import { buildAnalyticsCockpitSnapshot, createAnalyticsCockpitReadinessBoard } from '../service-analytics-cockpit.mjs';

export function createAnalyticsCockpitOpsRoutes(basePath = '/ops/analytics-cockpit') {
  const snapshot = buildAnalyticsCockpitSnapshot();
  return [
    { id: 'analytics-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsCockpitReadinessBoard(snapshot) },
    { id: 'analytics-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

