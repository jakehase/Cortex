import { buildAttributionSentinelSnapshot, createAttributionSentinelRouteSummary } from '../service-attribution-sentinel.mjs';

export function createAttributionSentinelRegistryRoutes(basePath = '/registry/attribution-sentinel') {
  const snapshot = buildAttributionSentinelSnapshot();
  return [
    { id: 'attribution-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAttributionSentinelRouteSummary(snapshot) },
    { id: 'attribution-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

