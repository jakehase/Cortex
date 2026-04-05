import { buildLocalizationExchangeSnapshot, createLocalizationExchangeRouteSummary } from '../service-localization-exchange.mjs';

export function createLocalizationExchangeRegistryRoutes(basePath = '/registry/localization-exchange') {
  const snapshot = buildLocalizationExchangeSnapshot();
  return [
    { id: 'localization-exchange.registry.summary', method: 'GET', path: basePath, summary: createLocalizationExchangeRouteSummary(snapshot) },
    { id: 'localization-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

