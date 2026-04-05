import { buildCommerceScorecardSnapshot, createCommerceScorecardRouteSummary } from '../service-commerce-scorecard.mjs';

export function createCommerceScorecardRegistryRoutes(basePath = '/registry/commerce-scorecard') {
  const snapshot = buildCommerceScorecardSnapshot();
  return [
    { id: 'commerce-scorecard.registry.summary', method: 'GET', path: basePath, summary: createCommerceScorecardRouteSummary(snapshot) },
    { id: 'commerce-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

