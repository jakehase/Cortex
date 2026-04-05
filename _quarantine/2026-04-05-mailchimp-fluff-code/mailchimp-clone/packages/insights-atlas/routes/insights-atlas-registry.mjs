import { buildInsightsAtlasSnapshot, createInsightsAtlasRouteSummary } from '../service-insights-atlas.mjs';

export function createInsightsAtlasRegistryRoutes(basePath = '/registry/insights-atlas') {
  const snapshot = buildInsightsAtlasSnapshot();
  return [
    { id: 'insights-atlas.registry.summary', method: 'GET', path: basePath, summary: createInsightsAtlasRouteSummary(snapshot) },
    { id: 'insights-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

