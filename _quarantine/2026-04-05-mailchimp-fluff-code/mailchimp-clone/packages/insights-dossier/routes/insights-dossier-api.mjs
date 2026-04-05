import { buildInsightsDossierSnapshot, createInsightsDossierApiDocument } from '../service-insights-dossier.mjs';

export function createInsightsDossierApiRoutes(basePath = '/api/insights-dossier') {
  const snapshot = buildInsightsDossierSnapshot();
  return [
    { id: 'insights-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-dossier.api.document', method: 'GET', path: basePath + '/document', document: createInsightsDossierApiDocument(snapshot) }
  ];
}

