import { buildAnalyticsAtlasSnapshot, createAnalyticsAtlasRouteSummary } from '../service-analytics-atlas.mjs';

export function createAnalyticsAtlasRegistryRoutes(basePath = '/registry/analytics-atlas') {
  const snapshot = buildAnalyticsAtlasSnapshot();
  return [
    { id: 'analytics-atlas.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsAtlasRouteSummary(snapshot) },
    { id: 'analytics-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

