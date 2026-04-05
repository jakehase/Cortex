import { buildAutomationScorecardSnapshot, createAutomationScorecardApiDocument } from '../service-automation-scorecard.mjs';

export function createAutomationScorecardApiRoutes(basePath = '/api/automation-scorecard') {
  const snapshot = buildAutomationScorecardSnapshot();
  return [
    { id: 'automation-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAutomationScorecardApiDocument(snapshot) }
  ];
}

