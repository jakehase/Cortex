import { buildAdvocacyIndexSnapshot, createAdvocacyIndexRouteSummary } from '../service-advocacy-index.mjs';

export function createAdvocacyIndexRegistryRoutes(basePath = '/registry/advocacy-index') {
  const snapshot = buildAdvocacyIndexSnapshot();
  return [
    { id: 'advocacy-index.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyIndexRouteSummary(snapshot) },
    { id: 'advocacy-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

