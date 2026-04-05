import { buildCommerceScorecardSnapshot, createCommerceScorecardApiDocument } from '../service-commerce-scorecard.mjs';

export function createCommerceScorecardApiRoutes(basePath = '/api/commerce-scorecard') {
  const snapshot = buildCommerceScorecardSnapshot();
  return [
    { id: 'commerce-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createCommerceScorecardApiDocument(snapshot) }
  ];
}

