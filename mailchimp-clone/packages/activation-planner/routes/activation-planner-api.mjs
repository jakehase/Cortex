import { buildActivationPlannerSnapshot, createActivationPlannerApiDocument } from '../service-activation-planner.mjs';

export function createActivationPlannerApiRoutes(basePath = '/api/activation-planner') {
  const snapshot = buildActivationPlannerSnapshot();
  return [
    { id: 'activation-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-planner.api.document', method: 'GET', path: basePath + '/document', document: createActivationPlannerApiDocument(snapshot) }
  ];
}

