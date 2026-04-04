import { buildAnalyticsDossierSnapshot, createAnalyticsDossierApiDocument } from '../service-analytics-dossier.mjs';

export function createAnalyticsDossierApiRoutes(basePath = '/api/analytics-dossier') {
  const snapshot = buildAnalyticsDossierSnapshot();
  return [
    { id: 'analytics-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsDossierApiDocument(snapshot) }
  ];
}

