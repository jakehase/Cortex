import { buildDataDossierSnapshot, createDataDossierRouteSummary } from '../service-data-dossier.mjs';

export function createDataDossierRegistryRoutes(basePath = '/registry/data-dossier') {
  const snapshot = buildDataDossierSnapshot();
  return [
    { id: 'data-dossier.registry.summary', method: 'GET', path: basePath, summary: createDataDossierRouteSummary(snapshot) },
    { id: 'data-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

