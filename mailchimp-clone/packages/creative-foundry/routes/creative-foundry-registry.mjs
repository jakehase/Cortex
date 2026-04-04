import { buildCreativeFoundrySnapshot, createCreativeFoundryRouteSummary } from '../service-creative-foundry.mjs';

export function createCreativeFoundryRegistryRoutes(basePath = '/registry/creative-foundry') {
  const snapshot = buildCreativeFoundrySnapshot();
  return [
    { id: 'creative-foundry.registry.summary', method: 'GET', path: basePath, summary: createCreativeFoundryRouteSummary(snapshot) },
    { id: 'creative-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

