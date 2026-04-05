import { buildAnalyticsNotebookSnapshot, createAnalyticsNotebookRouteSummary } from '../service-analytics-notebook.mjs';

export function createAnalyticsNotebookRegistryRoutes(basePath = '/registry/analytics-notebook') {
  const snapshot = buildAnalyticsNotebookSnapshot();
  return [
    { id: 'analytics-notebook.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsNotebookRouteSummary(snapshot) },
    { id: 'analytics-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

