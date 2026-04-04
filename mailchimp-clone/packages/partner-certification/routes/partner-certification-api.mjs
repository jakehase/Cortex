import { buildPartnerCertificationSnapshot, createPartnerCertificationApiDocument } from '../service-partner-certification.mjs';

export function createPartnerCertificationApiRoutes(basePath = '/api/partner-certification') { const snapshot = buildPartnerCertificationSnapshot(); return [{ id: 'partner-certification.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'partner-certification.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'partner-certification.api.document', method: 'GET', path: basePath + '/document', document: createPartnerCertificationApiDocument(snapshot) }]; }

