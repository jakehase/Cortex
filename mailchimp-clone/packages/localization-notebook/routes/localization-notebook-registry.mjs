import { buildLocalizationNotebookSnapshot, createLocalizationNotebookRouteSummary } from '../service-localization-notebook.mjs';

export function createLocalizationNotebookRegistryRoutes(basePath = '/registry/localization-notebook') {
  const snapshot = buildLocalizationNotebookSnapshot();
  return [
    { id: 'localization-notebook.registry.summary', method: 'GET', path: basePath, summary: createLocalizationNotebookRouteSummary(snapshot) },
    { id: 'localization-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

