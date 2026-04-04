import { buildAudienceWorkbenchSnapshot, createAudienceWorkbenchRouteSummary } from '../service-audience-workbench.mjs';

export function createAudienceWorkbenchRegistryRoutes(basePath = '/registry/audience-workbench') {
  const snapshot = buildAudienceWorkbenchSnapshot();
  return [
    { id: 'audience-workbench.registry.summary', method: 'GET', path: basePath, summary: createAudienceWorkbenchRouteSummary(snapshot) },
    { id: 'audience-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

