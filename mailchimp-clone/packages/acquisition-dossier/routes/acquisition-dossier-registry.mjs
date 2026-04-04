import { buildAcquisitionDossierSnapshot, createAcquisitionDossierRouteSummary } from '../service-acquisition-dossier.mjs';

export function createAcquisitionDossierRegistryRoutes(basePath = '/registry/acquisition-dossier') {
  const snapshot = buildAcquisitionDossierSnapshot();
  return [
    { id: 'acquisition-dossier.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionDossierRouteSummary(snapshot) },
    { id: 'acquisition-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

