import { buildInsightsCockpitSnapshot, createInsightsCockpitRouteSummary } from '../service-insights-cockpit.mjs';

export function createInsightsCockpitRegistryRoutes(basePath = '/registry/insights-cockpit') {
  const snapshot = buildInsightsCockpitSnapshot();
  return [
    { id: 'insights-cockpit.registry.summary', method: 'GET', path: basePath, summary: createInsightsCockpitRouteSummary(snapshot) },
    { id: 'insights-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

