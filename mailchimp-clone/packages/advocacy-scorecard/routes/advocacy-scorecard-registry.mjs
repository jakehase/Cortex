import { buildAdvocacyScorecardSnapshot, createAdvocacyScorecardRouteSummary } from '../service-advocacy-scorecard.mjs';

export function createAdvocacyScorecardRegistryRoutes(basePath = '/registry/advocacy-scorecard') {
  const snapshot = buildAdvocacyScorecardSnapshot();
  return [
    { id: 'advocacy-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyScorecardRouteSummary(snapshot) },
    { id: 'advocacy-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

