import { buildAudienceSentinelSnapshot, createAudienceSentinelRouteSummary } from '../service-audience-sentinel.mjs';

export function createAudienceSentinelRegistryRoutes(basePath = '/registry/audience-sentinel') {
  const snapshot = buildAudienceSentinelSnapshot();
  return [
    { id: 'audience-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAudienceSentinelRouteSummary(snapshot) },
    { id: 'audience-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

