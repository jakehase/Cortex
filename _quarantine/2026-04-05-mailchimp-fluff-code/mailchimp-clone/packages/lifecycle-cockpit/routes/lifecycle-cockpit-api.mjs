import { buildLifecycleCockpitSnapshot, createLifecycleCockpitApiDocument } from '../service-lifecycle-cockpit.mjs';

export function createLifecycleCockpitApiRoutes(basePath = '/api/lifecycle-cockpit') {
  const snapshot = buildLifecycleCockpitSnapshot();
  return [
    { id: 'lifecycle-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleCockpitApiDocument(snapshot) }
  ];
}

