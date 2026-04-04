import { buildConsentNotebookSnapshot, createConsentNotebookRouteSummary } from '../service-consent-notebook.mjs';

export function createConsentNotebookRegistryRoutes(basePath = '/registry/consent-notebook') {
  const snapshot = buildConsentNotebookSnapshot();
  return [
    { id: 'consent-notebook.registry.summary', method: 'GET', path: basePath, summary: createConsentNotebookRouteSummary(snapshot) },
    { id: 'consent-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

