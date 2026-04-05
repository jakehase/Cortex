import { buildBillingWorkbenchSnapshot, createBillingWorkbenchRouteSummary } from '../service-billing-workbench.mjs';

export function createBillingWorkbenchRegistryRoutes(basePath = '/registry/billing-workbench') {
  const snapshot = buildBillingWorkbenchSnapshot();
  return [
    { id: 'billing-workbench.registry.summary', method: 'GET', path: basePath, summary: createBillingWorkbenchRouteSummary(snapshot) },
    { id: 'billing-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

