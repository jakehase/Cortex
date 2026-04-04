import { buildAdvocacyHubSnapshot, createAdvocacyHubRouteSummary } from '../service-advocacy-hub.mjs';

export function createAdvocacyHubRegistryRoutes(basePath = '/registry/advocacy-hub') {
  const snapshot = buildAdvocacyHubSnapshot();
  return [
    { id: 'advocacy-hub.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyHubRouteSummary(snapshot) },
    { id: 'advocacy-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

