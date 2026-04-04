import { buildJourneyMetricsSnapshot } from '../service-journey-metrics.mjs';

export function createJourneyMetricsDashboardRoutes(basePath = '/journey-metrics') {
  const snapshot = buildJourneyMetricsSnapshot();
  return [
    { id: 'journey-metrics.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'journey-metrics.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'journey-metrics.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
