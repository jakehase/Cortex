import { buildSenderRotationSnapshot, createSenderRotationApiDocument } from '../service-sender-rotation.mjs';

export function createSenderRotationApiRoutes(basePath = '/api/sender-rotation') { const snapshot = buildSenderRotationSnapshot(); return [{ id: 'sender-rotation.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'sender-rotation.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'sender-rotation.api.document', method: 'GET', path: basePath + '/document', document: createSenderRotationApiDocument(snapshot) }]; }

