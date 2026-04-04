import { buildActivationScorecardSnapshot, createActivationScorecardRouteSummary } from '../service-activation-scorecard.mjs';

export function createActivationScorecardRegistryRoutes(basePath = '/registry/activation-scorecard') {
  const snapshot = buildActivationScorecardSnapshot();
  return [
    { id: 'activation-scorecard.registry.summary', method: 'GET', path: basePath, summary: createActivationScorecardRouteSummary(snapshot) },
    { id: 'activation-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

