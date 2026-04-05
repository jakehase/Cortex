import { buildAudienceExchangeSnapshot, createAudienceExchangeRouteSummary } from '../service-audience-exchange.mjs';

export function createAudienceExchangeRegistryRoutes(basePath = '/registry/audience-exchange') {
  const snapshot = buildAudienceExchangeSnapshot();
  return [
    { id: 'audience-exchange.registry.summary', method: 'GET', path: basePath, summary: createAudienceExchangeRouteSummary(snapshot) },
    { id: 'audience-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

