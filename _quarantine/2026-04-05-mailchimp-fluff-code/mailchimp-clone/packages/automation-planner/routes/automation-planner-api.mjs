import { buildAutomationPlannerSnapshot, createAutomationPlannerApiDocument } from '../service-automation-planner.mjs';

export function createAutomationPlannerApiRoutes(basePath = '/api/automation-planner') {
  const snapshot = buildAutomationPlannerSnapshot();
  return [
    { id: 'automation-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-planner.api.document', method: 'GET', path: basePath + '/document', document: createAutomationPlannerApiDocument(snapshot) }
  ];
}

