import { buildAnalyticsWorkbenchSnapshot, createAnalyticsWorkbenchRouteSummary } from '../service-analytics-workbench.mjs';

export function createAnalyticsWorkbenchRegistryRoutes(basePath = '/registry/analytics-workbench') {
  const snapshot = buildAnalyticsWorkbenchSnapshot();
  return [
    { id: 'analytics-workbench.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsWorkbenchRouteSummary(snapshot) },
    { id: 'analytics-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

