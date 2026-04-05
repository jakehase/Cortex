import { buildDataSentinelSnapshot, createDataSentinelRouteSummary } from '../service-data-sentinel.mjs';

export function createDataSentinelRegistryRoutes(basePath = '/registry/data-sentinel') {
  const snapshot = buildDataSentinelSnapshot();
  return [
    { id: 'data-sentinel.registry.summary', method: 'GET', path: basePath, summary: createDataSentinelRouteSummary(snapshot) },
    { id: 'data-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

