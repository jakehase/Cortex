import { buildEcommerceCockpitSnapshot, createEcommerceCockpitRouteSummary } from '../service-ecommerce-cockpit.mjs';

export function createEcommerceCockpitRegistryRoutes(basePath = '/registry/ecommerce-cockpit') {
  const snapshot = buildEcommerceCockpitSnapshot();
  return [
    { id: 'ecommerce-cockpit.registry.summary', method: 'GET', path: basePath, summary: createEcommerceCockpitRouteSummary(snapshot) },
    { id: 'ecommerce-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

