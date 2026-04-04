import { buildAdvocacyFoundrySnapshot, createAdvocacyFoundryRouteSummary } from '../service-advocacy-foundry.mjs';

export function createAdvocacyFoundryRegistryRoutes(basePath = '/registry/advocacy-foundry') {
  const snapshot = buildAdvocacyFoundrySnapshot();
  return [
    { id: 'advocacy-foundry.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyFoundryRouteSummary(snapshot) },
    { id: 'advocacy-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

