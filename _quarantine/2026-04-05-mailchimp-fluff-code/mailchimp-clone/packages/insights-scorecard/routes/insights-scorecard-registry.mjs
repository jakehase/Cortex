import { buildInsightsScorecardSnapshot, createInsightsScorecardRouteSummary } from '../service-insights-scorecard.mjs';

export function createInsightsScorecardRegistryRoutes(basePath = '/registry/insights-scorecard') {
  const snapshot = buildInsightsScorecardSnapshot();
  return [
    { id: 'insights-scorecard.registry.summary', method: 'GET', path: basePath, summary: createInsightsScorecardRouteSummary(snapshot) },
    { id: 'insights-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

