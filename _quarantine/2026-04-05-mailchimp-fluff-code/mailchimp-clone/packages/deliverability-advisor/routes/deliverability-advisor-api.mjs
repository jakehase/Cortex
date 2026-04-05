import { buildDeliverabilityAdvisorSnapshot, createDeliverabilityAdvisorApiDocument } from '../service-deliverability-advisor.mjs';

export function createDeliverabilityAdvisorApiRoutes(basePath = '/api/deliverability-advisor') {
  const snapshot = buildDeliverabilityAdvisorSnapshot();
  return [
    { id: 'deliverability-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-advisor.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityAdvisorApiDocument(snapshot) }
  ];
}

