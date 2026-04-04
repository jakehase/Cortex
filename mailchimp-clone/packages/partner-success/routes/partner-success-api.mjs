import { buildPartnerSuccessSnapshot, createPartnerSuccessApiDocument } from '../service-partner-success.mjs';

export function createPartnerSuccessApiRoutes(basePath = '/api/partner-success') {
  const snapshot = buildPartnerSuccessSnapshot();
  return [
    { id: 'partner-success.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'partner-success.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'partner-success.api.document', method: 'GET', path: basePath + '/document', document: createPartnerSuccessApiDocument(snapshot) }
  ];
}
