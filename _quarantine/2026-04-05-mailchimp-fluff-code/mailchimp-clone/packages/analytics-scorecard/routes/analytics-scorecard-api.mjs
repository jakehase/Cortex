import { buildAnalyticsScorecardSnapshot, createAnalyticsScorecardApiDocument } from '../service-analytics-scorecard.mjs';

export function createAnalyticsScorecardApiRoutes(basePath = '/api/analytics-scorecard') {
  const snapshot = buildAnalyticsScorecardSnapshot();
  return [
    { id: 'analytics-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsScorecardApiDocument(snapshot) }
  ];
}

