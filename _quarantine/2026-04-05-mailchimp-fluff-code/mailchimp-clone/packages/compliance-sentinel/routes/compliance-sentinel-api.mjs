import { buildComplianceSentinelSnapshot, createComplianceSentinelApiDocument } from '../service-compliance-sentinel.mjs';

export function createComplianceSentinelApiRoutes(basePath = '/api/compliance-sentinel') {
  const snapshot = buildComplianceSentinelSnapshot();
  return [
    { id: 'compliance-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createComplianceSentinelApiDocument(snapshot) }
  ];
}

