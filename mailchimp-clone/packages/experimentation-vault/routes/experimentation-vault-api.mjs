import { buildExperimentationVaultSnapshot, createExperimentationVaultApiDocument } from '../service-experimentation-vault.mjs';

export function createExperimentationVaultApiRoutes(basePath = '/api/experimentation-vault') {
  const snapshot = buildExperimentationVaultSnapshot();
  return [
    { id: 'experimentation-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-vault.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationVaultApiDocument(snapshot) }
  ];
}

