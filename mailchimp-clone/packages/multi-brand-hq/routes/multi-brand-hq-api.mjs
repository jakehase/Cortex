import { buildMultiBrandHqSnapshot, createMultiBrandHqApiDocument } from '../service-multi-brand-hq.mjs';

export function createMultiBrandHqApiRoutes(basePath = '/api/multi-brand-hq') {
  const snapshot = buildMultiBrandHqSnapshot();
  return [
    { id: 'multi-brand-hq.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'multi-brand-hq.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'multi-brand-hq.api.document', method: 'GET', path: basePath + '/document', document: createMultiBrandHqApiDocument(snapshot) }
  ];
}
