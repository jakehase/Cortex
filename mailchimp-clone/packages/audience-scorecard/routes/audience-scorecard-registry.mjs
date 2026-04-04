import { buildAudienceScorecardSnapshot, createAudienceScorecardRouteSummary } from '../service-audience-scorecard.mjs';

export function createAudienceScorecardRegistryRoutes(basePath = '/registry/audience-scorecard') {
  const snapshot = buildAudienceScorecardSnapshot();
  return [
    { id: 'audience-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAudienceScorecardRouteSummary(snapshot) },
    { id: 'audience-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

