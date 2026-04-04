import { buildDataScorecardSnapshot, createDataScorecardRouteSummary } from '../service-data-scorecard.mjs';

export function createDataScorecardRegistryRoutes(basePath = '/registry/data-scorecard') {
  const snapshot = buildDataScorecardSnapshot();
  return [
    { id: 'data-scorecard.registry.summary', method: 'GET', path: basePath, summary: createDataScorecardRouteSummary(snapshot) },
    { id: 'data-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

