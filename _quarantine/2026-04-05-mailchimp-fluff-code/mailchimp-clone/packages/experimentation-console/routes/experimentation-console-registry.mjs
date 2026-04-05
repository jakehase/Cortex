import { buildExperimentationConsoleSnapshot, createExperimentationConsoleRouteSummary } from '../service-experimentation-console.mjs';

export function createExperimentationConsoleRegistryRoutes(basePath = '/registry/experimentation-console') {
  const snapshot = buildExperimentationConsoleSnapshot();
  return [
    { id: 'experimentation-console.registry.summary', method: 'GET', path: basePath, summary: createExperimentationConsoleRouteSummary(snapshot) },
    { id: 'experimentation-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

