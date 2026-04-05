import { buildAudienceNotebookSnapshot, createAudienceNotebookRouteSummary } from '../service-audience-notebook.mjs';

export function createAudienceNotebookRegistryRoutes(basePath = '/registry/audience-notebook') {
  const snapshot = buildAudienceNotebookSnapshot();
  return [
    { id: 'audience-notebook.registry.summary', method: 'GET', path: basePath, summary: createAudienceNotebookRouteSummary(snapshot) },
    { id: 'audience-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

