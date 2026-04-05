import { buildLoyaltyScorecardSnapshot, createLoyaltyScorecardRouteSummary } from '../service-loyalty-scorecard.mjs';

export function createLoyaltyScorecardRegistryRoutes(basePath = '/registry/loyalty-scorecard') {
  const snapshot = buildLoyaltyScorecardSnapshot();
  return [
    { id: 'loyalty-scorecard.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyScorecardRouteSummary(snapshot) },
    { id: 'loyalty-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

