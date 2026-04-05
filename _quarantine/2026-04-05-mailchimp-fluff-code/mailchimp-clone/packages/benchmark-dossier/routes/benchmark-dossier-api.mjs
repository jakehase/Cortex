import { buildBenchmarkDossierSnapshot, createBenchmarkDossierApiDocument } from '../service-benchmark-dossier.mjs';

export function createBenchmarkDossierApiRoutes(basePath = '/api/benchmark-dossier') {
  const snapshot = buildBenchmarkDossierSnapshot();
  return [
    { id: 'benchmark-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-dossier.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkDossierApiDocument(snapshot) }
  ];
}

