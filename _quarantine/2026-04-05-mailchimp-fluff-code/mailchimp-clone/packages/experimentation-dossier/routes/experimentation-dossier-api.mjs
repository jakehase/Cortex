import { buildExperimentationDossierSnapshot, createExperimentationDossierApiDocument } from '../service-experimentation-dossier.mjs';

export function createExperimentationDossierApiRoutes(basePath = '/api/experimentation-dossier') {
  const snapshot = buildExperimentationDossierSnapshot();
  return [
    { id: 'experimentation-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-dossier.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationDossierApiDocument(snapshot) }
  ];
}

