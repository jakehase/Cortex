import { buildBenchmarkNotebookSnapshot, createBenchmarkNotebookRouteSummary } from '../service-benchmark-notebook.mjs';

export function createBenchmarkNotebookRegistryRoutes(basePath = '/registry/benchmark-notebook') {
  const snapshot = buildBenchmarkNotebookSnapshot();
  return [
    { id: 'benchmark-notebook.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkNotebookRouteSummary(snapshot) },
    { id: 'benchmark-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

