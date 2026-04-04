import { buildConsentExchangeSnapshot, createConsentExchangeRouteSummary } from '../service-consent-exchange.mjs';

export function createConsentExchangeRegistryRoutes(basePath = '/registry/consent-exchange') {
  const snapshot = buildConsentExchangeSnapshot();
  return [
    { id: 'consent-exchange.registry.summary', method: 'GET', path: basePath, summary: createConsentExchangeRouteSummary(snapshot) },
    { id: 'consent-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

