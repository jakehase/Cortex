import { buildAcquisitionScorecardSnapshot, createAcquisitionScorecardApiDocument } from '../service-acquisition-scorecard.mjs';

export function createAcquisitionScorecardApiRoutes(basePath = '/api/acquisition-scorecard') {
  const snapshot = buildAcquisitionScorecardSnapshot();
  return [
    { id: 'acquisition-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionScorecardApiDocument(snapshot) }
  ];
}

