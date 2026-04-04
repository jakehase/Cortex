import { buildAttributionModelingSnapshot, createAttributionModelingApiDocument } from '../service-attribution-modeling.mjs';

export function createAttributionModelingApiRoutes(basePath = '/api/attribution-modeling') { const snapshot = buildAttributionModelingSnapshot(); return [{ id: 'attribution-modeling.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'attribution-modeling.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'attribution-modeling.api.document', method: 'GET', path: basePath + '/document', document: createAttributionModelingApiDocument(snapshot) }]; }

