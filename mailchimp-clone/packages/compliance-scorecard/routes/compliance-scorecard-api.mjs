import { buildComplianceScorecardSnapshot, createComplianceScorecardApiDocument } from '../service-compliance-scorecard.mjs';

export function createComplianceScorecardApiRoutes(basePath = '/api/compliance-scorecard') {
  const snapshot = buildComplianceScorecardSnapshot();
  return [
    { id: 'compliance-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createComplianceScorecardApiDocument(snapshot) }
  ];
}

