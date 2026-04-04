import { buildBenchmarkCockpitSnapshot, createBenchmarkCockpitRouteSummary } from '../service-benchmark-cockpit.mjs';

export function createBenchmarkCockpitRegistryRoutes(basePath = '/registry/benchmark-cockpit') {
  const snapshot = buildBenchmarkCockpitSnapshot();
  return [
    { id: 'benchmark-cockpit.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkCockpitRouteSummary(snapshot) },
    { id: 'benchmark-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

