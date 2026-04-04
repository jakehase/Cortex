import { buildAnalyticsScorecardSnapshot, createAnalyticsScorecardRouteSummary } from '../service-analytics-scorecard.mjs';

export function createAnalyticsScorecardRegistryRoutes(basePath = '/registry/analytics-scorecard') {
  const snapshot = buildAnalyticsScorecardSnapshot();
  return [
    { id: 'analytics-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsScorecardRouteSummary(snapshot) },
    { id: 'analytics-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

