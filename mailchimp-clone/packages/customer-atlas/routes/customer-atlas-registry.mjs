import { buildCustomerAtlasSnapshot, createCustomerAtlasRouteSummary } from '../service-customer-atlas.mjs';

export function createCustomerAtlasRegistryRoutes(basePath = '/registry/customer-atlas') {
  const snapshot = buildCustomerAtlasSnapshot();
  return [
    { id: 'customer-atlas.registry.summary', method: 'GET', path: basePath, summary: createCustomerAtlasRouteSummary(snapshot) },
    { id: 'customer-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

