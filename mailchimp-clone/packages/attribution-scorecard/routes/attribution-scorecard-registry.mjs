import { buildAttributionScorecardSnapshot, createAttributionScorecardRouteSummary } from '../service-attribution-scorecard.mjs';

export function createAttributionScorecardRegistryRoutes(basePath = '/registry/attribution-scorecard') {
  const snapshot = buildAttributionScorecardSnapshot();
  return [
    { id: 'attribution-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAttributionScorecardRouteSummary(snapshot) },
    { id: 'attribution-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

