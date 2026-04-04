import { buildExperimentationVaultSnapshot, createExperimentationVaultRouteSummary } from '../service-experimentation-vault.mjs';

export function createExperimentationVaultRegistryRoutes(basePath = '/registry/experimentation-vault') {
  const snapshot = buildExperimentationVaultSnapshot();
  return [
    { id: 'experimentation-vault.registry.summary', method: 'GET', path: basePath, summary: createExperimentationVaultRouteSummary(snapshot) },
    { id: 'experimentation-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

