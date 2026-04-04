import { buildAdvocacyStudioSnapshot, createAdvocacyStudioRouteSummary } from '../service-advocacy-studio.mjs';

export function createAdvocacyStudioRegistryRoutes(basePath = '/registry/advocacy-studio') {
  const snapshot = buildAdvocacyStudioSnapshot();
  return [
    { id: 'advocacy-studio.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyStudioRouteSummary(snapshot) },
    { id: 'advocacy-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

