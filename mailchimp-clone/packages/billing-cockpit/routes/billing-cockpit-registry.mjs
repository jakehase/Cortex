import { buildBillingCockpitSnapshot, createBillingCockpitRouteSummary } from '../service-billing-cockpit.mjs';

export function createBillingCockpitRegistryRoutes(basePath = '/registry/billing-cockpit') {
  const snapshot = buildBillingCockpitSnapshot();
  return [
    { id: 'billing-cockpit.registry.summary', method: 'GET', path: basePath, summary: createBillingCockpitRouteSummary(snapshot) },
    { id: 'billing-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

