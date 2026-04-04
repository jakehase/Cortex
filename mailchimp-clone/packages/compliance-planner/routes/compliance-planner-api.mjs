import { buildCompliancePlannerSnapshot, createCompliancePlannerApiDocument } from '../service-compliance-planner.mjs';

export function createCompliancePlannerApiRoutes(basePath = '/api/compliance-planner') {
  const snapshot = buildCompliancePlannerSnapshot();
  return [
    { id: 'compliance-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-planner.api.document', method: 'GET', path: basePath + '/document', document: createCompliancePlannerApiDocument(snapshot) }
  ];
}

