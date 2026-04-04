import { buildAudienceConsoleSnapshot, createAudienceConsoleRouteSummary } from '../service-audience-console.mjs';

export function createAudienceConsoleRegistryRoutes(basePath = '/registry/audience-console') {
  const snapshot = buildAudienceConsoleSnapshot();
  return [
    { id: 'audience-console.registry.summary', method: 'GET', path: basePath, summary: createAudienceConsoleRouteSummary(snapshot) },
    { id: 'audience-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

