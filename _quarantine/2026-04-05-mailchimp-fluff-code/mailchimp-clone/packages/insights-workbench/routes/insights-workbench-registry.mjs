import { buildInsightsWorkbenchSnapshot, createInsightsWorkbenchRouteSummary } from '../service-insights-workbench.mjs';

export function createInsightsWorkbenchRegistryRoutes(basePath = '/registry/insights-workbench') {
  const snapshot = buildInsightsWorkbenchSnapshot();
  return [
    { id: 'insights-workbench.registry.summary', method: 'GET', path: basePath, summary: createInsightsWorkbenchRouteSummary(snapshot) },
    { id: 'insights-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

