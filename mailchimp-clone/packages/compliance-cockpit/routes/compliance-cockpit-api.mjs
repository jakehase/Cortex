import { buildComplianceCockpitSnapshot, createComplianceCockpitApiDocument } from '../service-compliance-cockpit.mjs';

export function createComplianceCockpitApiRoutes(basePath = '/api/compliance-cockpit') {
  const snapshot = buildComplianceCockpitSnapshot();
  return [
    { id: 'compliance-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createComplianceCockpitApiDocument(snapshot) }
  ];
}

