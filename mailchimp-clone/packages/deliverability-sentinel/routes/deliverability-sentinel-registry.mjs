import { buildDeliverabilitySentinelSnapshot, createDeliverabilitySentinelRouteSummary } from '../service-deliverability-sentinel.mjs';

export function createDeliverabilitySentinelRegistryRoutes(basePath = '/registry/deliverability-sentinel') {
  const snapshot = buildDeliverabilitySentinelSnapshot();
  return [
    { id: 'deliverability-sentinel.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilitySentinelRouteSummary(snapshot) },
    { id: 'deliverability-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

