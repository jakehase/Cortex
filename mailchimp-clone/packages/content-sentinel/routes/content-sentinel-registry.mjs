import { buildContentSentinelSnapshot, createContentSentinelRouteSummary } from '../service-content-sentinel.mjs';

export function createContentSentinelRegistryRoutes(basePath = '/registry/content-sentinel') {
  const snapshot = buildContentSentinelSnapshot();
  return [
    { id: 'content-sentinel.registry.summary', method: 'GET', path: basePath, summary: createContentSentinelRouteSummary(snapshot) },
    { id: 'content-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

