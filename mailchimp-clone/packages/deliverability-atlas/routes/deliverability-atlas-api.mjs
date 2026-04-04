import { buildDeliverabilityAtlasSnapshot, createDeliverabilityAtlasApiDocument } from '../service-deliverability-atlas.mjs';

export function createDeliverabilityAtlasApiRoutes(basePath = '/api/deliverability-atlas') {
  const snapshot = buildDeliverabilityAtlasSnapshot();
  return [
    { id: 'deliverability-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-atlas.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityAtlasApiDocument(snapshot) }
  ];
}

