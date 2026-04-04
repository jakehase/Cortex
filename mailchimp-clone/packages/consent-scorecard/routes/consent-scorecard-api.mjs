import { buildConsentScorecardSnapshot, createConsentScorecardApiDocument } from '../service-consent-scorecard.mjs';

export function createConsentScorecardApiRoutes(basePath = '/api/consent-scorecard') {
  const snapshot = buildConsentScorecardSnapshot();
  return [
    { id: 'consent-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createConsentScorecardApiDocument(snapshot) }
  ];
}

