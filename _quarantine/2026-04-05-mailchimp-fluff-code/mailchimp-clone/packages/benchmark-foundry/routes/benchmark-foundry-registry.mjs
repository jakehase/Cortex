import { buildBenchmarkFoundrySnapshot, createBenchmarkFoundryRouteSummary } from '../service-benchmark-foundry.mjs';

export function createBenchmarkFoundryRegistryRoutes(basePath = '/registry/benchmark-foundry') {
  const snapshot = buildBenchmarkFoundrySnapshot();
  return [
    { id: 'benchmark-foundry.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkFoundryRouteSummary(snapshot) },
    { id: 'benchmark-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

