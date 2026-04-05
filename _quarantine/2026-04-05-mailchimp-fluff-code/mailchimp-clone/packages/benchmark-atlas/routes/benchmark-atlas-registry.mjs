import { buildBenchmarkAtlasSnapshot, createBenchmarkAtlasRouteSummary } from '../service-benchmark-atlas.mjs';

export function createBenchmarkAtlasRegistryRoutes(basePath = '/registry/benchmark-atlas') {
  const snapshot = buildBenchmarkAtlasSnapshot();
  return [
    { id: 'benchmark-atlas.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkAtlasRouteSummary(snapshot) },
    { id: 'benchmark-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

