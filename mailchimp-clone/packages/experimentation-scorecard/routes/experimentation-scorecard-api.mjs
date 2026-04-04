import { buildExperimentationScorecardSnapshot, createExperimentationScorecardApiDocument } from '../service-experimentation-scorecard.mjs';

export function createExperimentationScorecardApiRoutes(basePath = '/api/experimentation-scorecard') {
  const snapshot = buildExperimentationScorecardSnapshot();
  return [
    { id: 'experimentation-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationScorecardApiDocument(snapshot) }
  ];
}

