import { buildAcquisitionPlannerSnapshot, createAcquisitionPlannerApiDocument } from '../service-acquisition-planner.mjs';

export function createAcquisitionPlannerApiRoutes(basePath = '/api/acquisition-planner') {
  const snapshot = buildAcquisitionPlannerSnapshot();
  return [
    { id: 'acquisition-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-planner.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionPlannerApiDocument(snapshot) }
  ];
}

