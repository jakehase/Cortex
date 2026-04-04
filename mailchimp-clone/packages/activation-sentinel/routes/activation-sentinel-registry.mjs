import { buildActivationSentinelSnapshot, createActivationSentinelRouteSummary } from '../service-activation-sentinel.mjs';

export function createActivationSentinelRegistryRoutes(basePath = '/registry/activation-sentinel') {
  const snapshot = buildActivationSentinelSnapshot();
  return [
    { id: 'activation-sentinel.registry.summary', method: 'GET', path: basePath, summary: createActivationSentinelRouteSummary(snapshot) },
    { id: 'activation-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

