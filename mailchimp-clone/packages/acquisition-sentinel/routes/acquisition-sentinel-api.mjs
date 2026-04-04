import { buildAcquisitionSentinelSnapshot, createAcquisitionSentinelApiDocument } from '../service-acquisition-sentinel.mjs';

export function createAcquisitionSentinelApiRoutes(basePath = '/api/acquisition-sentinel') {
  const snapshot = buildAcquisitionSentinelSnapshot();
  return [
    { id: 'acquisition-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionSentinelApiDocument(snapshot) }
  ];
}

