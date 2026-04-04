import { buildBillingConsoleSnapshot, createBillingConsoleRouteSummary } from '../service-billing-console.mjs';

export function createBillingConsoleRegistryRoutes(basePath = '/registry/billing-console') {
  const snapshot = buildBillingConsoleSnapshot();
  return [
    { id: 'billing-console.registry.summary', method: 'GET', path: basePath, summary: createBillingConsoleRouteSummary(snapshot) },
    { id: 'billing-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

