import { buildAnalyticsLedgerSnapshot, createAnalyticsLedgerApiDocument } from '../service-analytics-ledger.mjs';

export function createAnalyticsLedgerApiRoutes(basePath = '/api/analytics-ledger') {
  const snapshot = buildAnalyticsLedgerSnapshot();
  return [
    { id: 'analytics-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-ledger.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsLedgerApiDocument(snapshot) }
  ];
}

