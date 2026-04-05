import { buildAcquisitionExchangeSnapshot, createAcquisitionExchangeRouteSummary } from '../service-acquisition-exchange.mjs';

export function createAcquisitionExchangeRegistryRoutes(basePath = '/registry/acquisition-exchange') {
  const snapshot = buildAcquisitionExchangeSnapshot();
  return [
    { id: 'acquisition-exchange.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionExchangeRouteSummary(snapshot) },
    { id: 'acquisition-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

