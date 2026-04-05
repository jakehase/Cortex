import { buildExperimentationExchangeSnapshot, createExperimentationExchangeRouteSummary } from '../service-experimentation-exchange.mjs';

export function createExperimentationExchangeRegistryRoutes(basePath = '/registry/experimentation-exchange') {
  const snapshot = buildExperimentationExchangeSnapshot();
  return [
    { id: 'experimentation-exchange.registry.summary', method: 'GET', path: basePath, summary: createExperimentationExchangeRouteSummary(snapshot) },
    { id: 'experimentation-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

