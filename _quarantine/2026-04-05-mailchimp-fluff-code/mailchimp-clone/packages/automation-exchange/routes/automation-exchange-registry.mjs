import { buildAutomationExchangeSnapshot, createAutomationExchangeRouteSummary } from '../service-automation-exchange.mjs';

export function createAutomationExchangeRegistryRoutes(basePath = '/registry/automation-exchange') {
  const snapshot = buildAutomationExchangeSnapshot();
  return [
    { id: 'automation-exchange.registry.summary', method: 'GET', path: basePath, summary: createAutomationExchangeRouteSummary(snapshot) },
    { id: 'automation-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

