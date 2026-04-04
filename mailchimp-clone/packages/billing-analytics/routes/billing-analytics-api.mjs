import { buildBillingAnalyticsSnapshot, createBillingAnalyticsApiDocument } from '../service-billing-analytics.mjs';

export function createBillingAnalyticsApiRoutes(basePath = '/api/billing-analytics') {
  const snapshot = buildBillingAnalyticsSnapshot();
  return [
    { id: 'billing-analytics.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-analytics.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-analytics.api.document', method: 'GET', path: basePath + '/document', document: createBillingAnalyticsApiDocument(snapshot) }
  ];
}
