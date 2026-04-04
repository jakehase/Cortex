import { buildServiceRecoverySnapshot, createServiceRecoveryApiDocument } from '../service-service-recovery.mjs';

export function createServiceRecoveryApiRoutes(basePath = '/api/service-recovery') { const snapshot = buildServiceRecoverySnapshot(); return [{ id: 'service-recovery.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'service-recovery.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'service-recovery.api.document', method: 'GET', path: basePath + '/document', document: createServiceRecoveryApiDocument(snapshot) }]; }

