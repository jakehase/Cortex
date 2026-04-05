import { buildCustomerCockpitSnapshot, createCustomerCockpitRouteSummary } from '../service-customer-cockpit.mjs';

export function createCustomerCockpitRegistryRoutes(basePath = '/registry/customer-cockpit') {
  const snapshot = buildCustomerCockpitSnapshot();
  return [
    { id: 'customer-cockpit.registry.summary', method: 'GET', path: basePath, summary: createCustomerCockpitRouteSummary(snapshot) },
    { id: 'customer-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

