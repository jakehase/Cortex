import { buildInsightsScorecardSnapshot, createInsightsScorecardReadinessBoard } from '../service-insights-scorecard.mjs';

export function createInsightsScorecardOpsRoutes(basePath = '/ops/insights-scorecard') {
  const snapshot = buildInsightsScorecardSnapshot();
  return [
    { id: 'insights-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsScorecardReadinessBoard(snapshot) },
    { id: 'insights-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

