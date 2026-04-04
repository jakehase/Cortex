import { buildInsightsVaultSnapshot, createInsightsVaultApiDocument } from '../service-insights-vault.mjs';

export function createInsightsVaultApiRoutes(basePath = '/api/insights-vault') {
  const snapshot = buildInsightsVaultSnapshot();
  return [
    { id: 'insights-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-vault.api.document', method: 'GET', path: basePath + '/document', document: createInsightsVaultApiDocument(snapshot) }
  ];
}

