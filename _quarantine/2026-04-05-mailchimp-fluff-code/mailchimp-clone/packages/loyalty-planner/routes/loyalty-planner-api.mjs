import { buildLoyaltyPlannerSnapshot, createLoyaltyPlannerApiDocument } from '../service-loyalty-planner.mjs';

export function createLoyaltyPlannerApiRoutes(basePath = '/api/loyalty-planner') {
  const snapshot = buildLoyaltyPlannerSnapshot();
  return [
    { id: 'loyalty-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-planner.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyPlannerApiDocument(snapshot) }
  ];
}

