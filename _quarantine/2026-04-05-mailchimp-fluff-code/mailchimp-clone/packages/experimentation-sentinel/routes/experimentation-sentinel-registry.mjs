import { buildExperimentationSentinelSnapshot, createExperimentationSentinelRouteSummary } from '../service-experimentation-sentinel.mjs';

export function createExperimentationSentinelRegistryRoutes(basePath = '/registry/experimentation-sentinel') {
  const snapshot = buildExperimentationSentinelSnapshot();
  return [
    { id: 'experimentation-sentinel.registry.summary', method: 'GET', path: basePath, summary: createExperimentationSentinelRouteSummary(snapshot) },
    { id: 'experimentation-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

