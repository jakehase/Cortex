import { buildInsightsScorecardSnapshot, createInsightsScorecardApiDocument } from '../service-insights-scorecard.mjs';

export function createInsightsScorecardApiRoutes(basePath = '/api/insights-scorecard') {
  const snapshot = buildInsightsScorecardSnapshot();
  return [
    { id: 'insights-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createInsightsScorecardApiDocument(snapshot) }
  ];
}

