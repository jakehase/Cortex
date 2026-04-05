import { buildBenchmarkVaultSnapshot, createBenchmarkVaultApiDocument } from '../service-benchmark-vault.mjs';

export function createBenchmarkVaultApiRoutes(basePath = '/api/benchmark-vault') {
  const snapshot = buildBenchmarkVaultSnapshot();
  return [
    { id: 'benchmark-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-vault.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkVaultApiDocument(snapshot) }
  ];
}

