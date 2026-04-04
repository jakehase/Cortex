import { buildJourneyMetricsSnapshot, createJourneyMetricsChecklist } from '../service-journey-metrics.mjs';

export function createJourneyMetricsOpsRoutes(basePath = '/ops/journey-metrics') {
  const snapshot = buildJourneyMetricsSnapshot();
  return [
    { id: 'journey-metrics.ops.health', method: 'GET', path: basePath + '/health', checklist: createJourneyMetricsChecklist(snapshot) },
    { id: 'journey-metrics.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'journey-metrics.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
