import { buildDataResidencySnapshot, createDataResidencyApiDocument } from '../service-data-residency.mjs';

export function createDataResidencyApiRoutes(basePath = '/api/data-residency') {
  const snapshot = buildDataResidencySnapshot();
  return [
    { id: 'data-residency.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-residency.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-residency.api.document', method: 'GET', path: basePath + '/document', document: createDataResidencyApiDocument(snapshot) }
  ];
}
