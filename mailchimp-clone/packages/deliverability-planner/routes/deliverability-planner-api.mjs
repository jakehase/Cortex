import { buildDeliverabilityPlannerSnapshot, createDeliverabilityPlannerApiDocument } from '../service-deliverability-planner.mjs';

export function createDeliverabilityPlannerApiRoutes(basePath = '/api/deliverability-planner') {
  const snapshot = buildDeliverabilityPlannerSnapshot();
  return [
    { id: 'deliverability-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-planner.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityPlannerApiDocument(snapshot) }
  ];
}

