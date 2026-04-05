import { buildExperimentationPlannerSnapshot, createExperimentationPlannerApiDocument } from '../service-experimentation-planner.mjs';

export function createExperimentationPlannerApiRoutes(basePath = '/api/experimentation-planner') {
  const snapshot = buildExperimentationPlannerSnapshot();
  return [
    { id: 'experimentation-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-planner.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationPlannerApiDocument(snapshot) }
  ];
}

