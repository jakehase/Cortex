import { buildAcquisitionSentinelSnapshot, createAcquisitionSentinelRouteSummary } from '../service-acquisition-sentinel.mjs';

export function createAcquisitionSentinelRegistryRoutes(basePath = '/registry/acquisition-sentinel') {
  const snapshot = buildAcquisitionSentinelSnapshot();
  return [
    { id: 'acquisition-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionSentinelRouteSummary(snapshot) },
    { id: 'acquisition-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

