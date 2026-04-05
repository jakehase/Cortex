import { buildBenchmarkNotebookSnapshot, createBenchmarkNotebookApiDocument } from '../service-benchmark-notebook.mjs';

export function createBenchmarkNotebookApiRoutes(basePath = '/api/benchmark-notebook') {
  const snapshot = buildBenchmarkNotebookSnapshot();
  return [
    { id: 'benchmark-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-notebook.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkNotebookApiDocument(snapshot) }
  ];
}

