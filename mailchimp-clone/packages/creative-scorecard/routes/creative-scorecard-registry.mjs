import { buildCreativeScorecardSnapshot, createCreativeScorecardRouteSummary } from '../service-creative-scorecard.mjs';

export function createCreativeScorecardRegistryRoutes(basePath = '/registry/creative-scorecard') {
  const snapshot = buildCreativeScorecardSnapshot();
  return [
    { id: 'creative-scorecard.registry.summary', method: 'GET', path: basePath, summary: createCreativeScorecardRouteSummary(snapshot) },
    { id: 'creative-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

