import { buildDataActivationSnapshot, createDataActivationApiDocument } from '../service-data-activation.mjs';

export function createDataActivationApiRoutes(basePath = '/api/data-activation') { const snapshot = buildDataActivationSnapshot(); return [{ id: 'data-activation.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'data-activation.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'data-activation.api.document', method: 'GET', path: basePath + '/document', document: createDataActivationApiDocument(snapshot) }]; }

