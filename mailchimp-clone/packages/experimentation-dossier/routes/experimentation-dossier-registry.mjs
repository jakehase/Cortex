import { buildExperimentationDossierSnapshot, createExperimentationDossierRouteSummary } from '../service-experimentation-dossier.mjs';

export function createExperimentationDossierRegistryRoutes(basePath = '/registry/experimentation-dossier') {
  const snapshot = buildExperimentationDossierSnapshot();
  return [
    { id: 'experimentation-dossier.registry.summary', method: 'GET', path: basePath, summary: createExperimentationDossierRouteSummary(snapshot) },
    { id: 'experimentation-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

