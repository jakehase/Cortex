import { buildDeliverabilityWatchtowerSnapshot, createDeliverabilityWatchtowerApiDocument } from '../service-deliverability-watchtower.mjs';

export function createDeliverabilityWatchtowerApiRoutes(basePath = '/api/deliverability-watchtower') {
  const snapshot = buildDeliverabilityWatchtowerSnapshot();
  return [
    { id: 'deliverability-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityWatchtowerApiDocument(snapshot) }
  ];
}

