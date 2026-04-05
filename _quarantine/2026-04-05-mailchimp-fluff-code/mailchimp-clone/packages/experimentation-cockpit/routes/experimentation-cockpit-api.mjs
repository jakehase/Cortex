import { buildExperimentationCockpitSnapshot, createExperimentationCockpitApiDocument } from '../service-experimentation-cockpit.mjs';

export function createExperimentationCockpitApiRoutes(basePath = '/api/experimentation-cockpit') {
  const snapshot = buildExperimentationCockpitSnapshot();
  return [
    { id: 'experimentation-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationCockpitApiDocument(snapshot) }
  ];
}

