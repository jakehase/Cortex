import { buildDeliverabilitySentinelSnapshot, createDeliverabilitySentinelApiDocument } from '../service-deliverability-sentinel.mjs';

export function createDeliverabilitySentinelApiRoutes(basePath = '/api/deliverability-sentinel') {
  const snapshot = buildDeliverabilitySentinelSnapshot();
  return [
    { id: 'deliverability-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilitySentinelApiDocument(snapshot) }
  ];
}

