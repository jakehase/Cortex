import { buildAcquisitionAdvisorSnapshot, createAcquisitionAdvisorApiDocument } from '../service-acquisition-advisor.mjs';

export function createAcquisitionAdvisorApiRoutes(basePath = '/api/acquisition-advisor') {
  const snapshot = buildAcquisitionAdvisorSnapshot();
  return [
    { id: 'acquisition-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionAdvisorApiDocument(snapshot) }
  ];
}

