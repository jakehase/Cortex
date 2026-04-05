import { buildContentScorecardSnapshot, createContentScorecardRouteSummary } from '../service-content-scorecard.mjs';

export function createContentScorecardRegistryRoutes(basePath = '/registry/content-scorecard') {
  const snapshot = buildContentScorecardSnapshot();
  return [
    { id: 'content-scorecard.registry.summary', method: 'GET', path: basePath, summary: createContentScorecardRouteSummary(snapshot) },
    { id: 'content-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

