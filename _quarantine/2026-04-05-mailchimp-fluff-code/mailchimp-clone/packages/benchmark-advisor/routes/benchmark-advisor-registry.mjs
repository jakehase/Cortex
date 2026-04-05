import { buildBenchmarkAdvisorSnapshot, createBenchmarkAdvisorRouteSummary } from '../service-benchmark-advisor.mjs';

export function createBenchmarkAdvisorRegistryRoutes(basePath = '/registry/benchmark-advisor') {
  const snapshot = buildBenchmarkAdvisorSnapshot();
  return [
    { id: 'benchmark-advisor.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkAdvisorRouteSummary(snapshot) },
    { id: 'benchmark-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

