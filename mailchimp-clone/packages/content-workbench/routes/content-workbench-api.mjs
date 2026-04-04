import { buildContentWorkbenchSnapshot, createContentWorkbenchApiDocument } from '../service-content-workbench.mjs';

export function createContentWorkbenchApiRoutes(basePath = '/api/content-workbench') {
  const snapshot = buildContentWorkbenchSnapshot();
  return [
    { id: 'content-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-workbench.api.document', method: 'GET', path: basePath + '/document', document: createContentWorkbenchApiDocument(snapshot) }
  ];
}

