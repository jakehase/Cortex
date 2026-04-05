import { buildAdvocacySentinelSnapshot, createAdvocacySentinelRouteSummary } from '../service-advocacy-sentinel.mjs';

export function createAdvocacySentinelRegistryRoutes(basePath = '/registry/advocacy-sentinel') {
  const snapshot = buildAdvocacySentinelSnapshot();
  return [
    { id: 'advocacy-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAdvocacySentinelRouteSummary(snapshot) },
    { id: 'advocacy-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

