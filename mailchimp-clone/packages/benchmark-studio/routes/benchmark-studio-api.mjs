import { buildBenchmarkStudioSnapshot, createBenchmarkStudioApiDocument } from '../service-benchmark-studio.mjs';

export function createBenchmarkStudioApiRoutes(basePath = '/api/benchmark-studio') { const snapshot = buildBenchmarkStudioSnapshot(); return [{ id: 'benchmark-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'benchmark-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'benchmark-studio.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkStudioApiDocument(snapshot) }]; }

