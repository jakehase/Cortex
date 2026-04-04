import { buildMultiAccountControlSnapshot, createMultiAccountControlApiDocument } from '../service-multi-account-control.mjs';

export function createMultiAccountControlApiRoutes(basePath = '/api/multi-account-control') { const snapshot = buildMultiAccountControlSnapshot(); return [{ id: 'multi-account-control.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'multi-account-control.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'multi-account-control.api.document', method: 'GET', path: basePath + '/document', document: createMultiAccountControlApiDocument(snapshot) }]; }

