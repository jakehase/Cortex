import { buildOpsObservabilitySnapshot, createOpsObservabilityApiDocument } from '../service-ops-observability.mjs';

export function createOpsObservabilityApiRoutes(basePath = '/api/ops-observability') {
  const snapshot = buildOpsObservabilitySnapshot();
  return [
    { id: 'ops-observability.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ops-observability.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ops-observability.api.document', method: 'GET', path: basePath + '/document', document: createOpsObservabilityApiDocument(snapshot) }
  ];
}
