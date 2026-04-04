import { buildInsightsLedgerSnapshot, createInsightsLedgerApiDocument } from '../service-insights-ledger.mjs';

export function createInsightsLedgerApiRoutes(basePath = '/api/insights-ledger') {
  const snapshot = buildInsightsLedgerSnapshot();
  return [
    { id: 'insights-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-ledger.api.document', method: 'GET', path: basePath + '/document', document: createInsightsLedgerApiDocument(snapshot) }
  ];
}

