import { buildAdvocacyDossierSnapshot, createAdvocacyDossierRouteSummary } from '../service-advocacy-dossier.mjs';

export function createAdvocacyDossierRegistryRoutes(basePath = '/registry/advocacy-dossier') {
  const snapshot = buildAdvocacyDossierSnapshot();
  return [
    { id: 'advocacy-dossier.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyDossierRouteSummary(snapshot) },
    { id: 'advocacy-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

