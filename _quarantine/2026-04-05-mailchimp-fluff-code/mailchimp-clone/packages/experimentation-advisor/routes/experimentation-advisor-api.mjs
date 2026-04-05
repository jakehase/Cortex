import { buildExperimentationAdvisorSnapshot, createExperimentationAdvisorApiDocument } from '../service-experimentation-advisor.mjs';

export function createExperimentationAdvisorApiRoutes(basePath = '/api/experimentation-advisor') {
  const snapshot = buildExperimentationAdvisorSnapshot();
  return [
    { id: 'experimentation-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-advisor.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationAdvisorApiDocument(snapshot) }
  ];
}

