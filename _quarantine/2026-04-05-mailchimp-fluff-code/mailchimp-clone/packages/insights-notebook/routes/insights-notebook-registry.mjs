import { buildInsightsNotebookSnapshot, createInsightsNotebookRouteSummary } from '../service-insights-notebook.mjs';

export function createInsightsNotebookRegistryRoutes(basePath = '/registry/insights-notebook') {
  const snapshot = buildInsightsNotebookSnapshot();
  return [
    { id: 'insights-notebook.registry.summary', method: 'GET', path: basePath, summary: createInsightsNotebookRouteSummary(snapshot) },
    { id: 'insights-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

