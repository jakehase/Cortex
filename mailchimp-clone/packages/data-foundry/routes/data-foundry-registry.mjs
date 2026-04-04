import { buildDataFoundrySnapshot, createDataFoundryRouteSummary } from '../service-data-foundry.mjs';

export function createDataFoundryRegistryRoutes(basePath = '/registry/data-foundry') {
  const snapshot = buildDataFoundrySnapshot();
  return [
    { id: 'data-foundry.registry.summary', method: 'GET', path: basePath, summary: createDataFoundryRouteSummary(snapshot) },
    { id: 'data-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

