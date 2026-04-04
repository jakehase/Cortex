import { buildCreativeQaSnapshot, createCreativeQaApiDocument } from '../service-creative-qa.mjs';

export function createCreativeQaApiRoutes(basePath = '/api/creative-qa') { const snapshot = buildCreativeQaSnapshot(); return [{ id: 'creative-qa.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'creative-qa.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'creative-qa.api.document', method: 'GET', path: basePath + '/document', document: createCreativeQaApiDocument(snapshot) }]; }

