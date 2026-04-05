import { buildLifecycleScorecardSnapshot, createLifecycleScorecardApiDocument } from '../service-lifecycle-scorecard.mjs';

export function createLifecycleScorecardApiRoutes(basePath = '/api/lifecycle-scorecard') {
  const snapshot = buildLifecycleScorecardSnapshot();
  return [
    { id: 'lifecycle-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleScorecardApiDocument(snapshot) }
  ];
}

