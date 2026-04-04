import { buildComplianceDossierSnapshot, createComplianceDossierApiDocument } from '../service-compliance-dossier.mjs';

export function createComplianceDossierApiRoutes(basePath = '/api/compliance-dossier') {
  const snapshot = buildComplianceDossierSnapshot();
  return [
    { id: 'compliance-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-dossier.api.document', method: 'GET', path: basePath + '/document', document: createComplianceDossierApiDocument(snapshot) }
  ];
}

