import { buildAnalyticsCockpitSnapshot, createAnalyticsCockpitRouteSummary } from '../service-analytics-cockpit.mjs';

export function createAnalyticsCockpitRegistryRoutes(basePath = '/registry/analytics-cockpit') {
  const snapshot = buildAnalyticsCockpitSnapshot();
  return [
    { id: 'analytics-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsCockpitRouteSummary(snapshot) },
    { id: 'analytics-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

