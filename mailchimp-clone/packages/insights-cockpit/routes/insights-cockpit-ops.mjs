import { buildInsightsCockpitSnapshot, createInsightsCockpitReadinessBoard } from '../service-insights-cockpit.mjs';

export function createInsightsCockpitOpsRoutes(basePath = '/ops/insights-cockpit') {
  const snapshot = buildInsightsCockpitSnapshot();
  return [
    { id: 'insights-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsCockpitReadinessBoard(snapshot) },
    { id: 'insights-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

