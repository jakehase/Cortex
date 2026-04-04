import { buildBenchmarkWorkbenchSnapshot, createBenchmarkWorkbenchRouteSummary } from '../service-benchmark-workbench.mjs';

export function createBenchmarkWorkbenchRegistryRoutes(basePath = '/registry/benchmark-workbench') {
  const snapshot = buildBenchmarkWorkbenchSnapshot();
  return [
    { id: 'benchmark-workbench.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkWorkbenchRouteSummary(snapshot) },
    { id: 'benchmark-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

