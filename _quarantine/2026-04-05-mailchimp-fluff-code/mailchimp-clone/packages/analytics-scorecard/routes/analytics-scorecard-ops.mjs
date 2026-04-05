import { buildAnalyticsScorecardSnapshot, createAnalyticsScorecardReadinessBoard } from '../service-analytics-scorecard.mjs';

export function createAnalyticsScorecardOpsRoutes(basePath = '/ops/analytics-scorecard') {
  const snapshot = buildAnalyticsScorecardSnapshot();
  return [
    { id: 'analytics-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsScorecardReadinessBoard(snapshot) },
    { id: 'analytics-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

