import { buildAnalyticsExchangeSnapshot, createAnalyticsExchangeRouteSummary } from '../service-analytics-exchange.mjs';

export function createAnalyticsExchangeRegistryRoutes(basePath = '/registry/analytics-exchange') {
  const snapshot = buildAnalyticsExchangeSnapshot();
  return [
    { id: 'analytics-exchange.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsExchangeRouteSummary(snapshot) },
    { id: 'analytics-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

