import { buildAnalyticsVaultSnapshot, createAnalyticsVaultApiDocument } from '../service-analytics-vault.mjs';

export function createAnalyticsVaultApiRoutes(basePath = '/api/analytics-vault') {
  const snapshot = buildAnalyticsVaultSnapshot();
  return [
    { id: 'analytics-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-vault.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsVaultApiDocument(snapshot) }
  ];
}

