import { buildAcquisitionFoundrySnapshot, createAcquisitionFoundryRouteSummary } from '../service-acquisition-foundry.mjs';

export function createAcquisitionFoundryRegistryRoutes(basePath = '/registry/acquisition-foundry') {
  const snapshot = buildAcquisitionFoundrySnapshot();
  return [
    { id: 'acquisition-foundry.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionFoundryRouteSummary(snapshot) },
    { id: 'acquisition-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

