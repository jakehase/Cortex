import { buildContentFoundrySnapshot, createContentFoundryRouteSummary } from '../service-content-foundry.mjs';

export function createContentFoundryRegistryRoutes(basePath = '/registry/content-foundry') {
  const snapshot = buildContentFoundrySnapshot();
  return [
    { id: 'content-foundry.registry.summary', method: 'GET', path: basePath, summary: createContentFoundryRouteSummary(snapshot) },
    { id: 'content-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

