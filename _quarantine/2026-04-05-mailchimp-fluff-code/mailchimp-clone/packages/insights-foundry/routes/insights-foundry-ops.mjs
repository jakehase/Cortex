import { buildInsightsFoundrySnapshot, createInsightsFoundryReadinessBoard } from '../service-insights-foundry.mjs';

export function createInsightsFoundryOpsRoutes(basePath = '/ops/insights-foundry') {
  const snapshot = buildInsightsFoundrySnapshot();
  return [
    { id: 'insights-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsFoundryReadinessBoard(snapshot) },
    { id: 'insights-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

