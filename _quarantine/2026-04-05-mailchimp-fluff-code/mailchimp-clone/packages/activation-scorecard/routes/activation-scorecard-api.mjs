import { buildActivationScorecardSnapshot, createActivationScorecardApiDocument } from '../service-activation-scorecard.mjs';

export function createActivationScorecardApiRoutes(basePath = '/api/activation-scorecard') {
  const snapshot = buildActivationScorecardSnapshot();
  return [
    { id: 'activation-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createActivationScorecardApiDocument(snapshot) }
  ];
}

