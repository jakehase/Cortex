import { buildEcommerceScorecardSnapshot, createEcommerceScorecardRouteSummary } from '../service-ecommerce-scorecard.mjs';

export function createEcommerceScorecardRegistryRoutes(basePath = '/registry/ecommerce-scorecard') {
  const snapshot = buildEcommerceScorecardSnapshot();
  return [
    { id: 'ecommerce-scorecard.registry.summary', method: 'GET', path: basePath, summary: createEcommerceScorecardRouteSummary(snapshot) },
    { id: 'ecommerce-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

