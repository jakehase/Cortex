import { buildInsightsExchangeSnapshot, createInsightsExchangeRouteSummary } from '../service-insights-exchange.mjs';

export function createInsightsExchangeRegistryRoutes(basePath = '/registry/insights-exchange') {
  const snapshot = buildInsightsExchangeSnapshot();
  return [
    { id: 'insights-exchange.registry.summary', method: 'GET', path: basePath, summary: createInsightsExchangeRouteSummary(snapshot) },
    { id: 'insights-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

