import { buildContentDossierSnapshot, createContentDossierRouteSummary } from '../service-content-dossier.mjs';

export function createContentDossierRegistryRoutes(basePath = '/registry/content-dossier') {
  const snapshot = buildContentDossierSnapshot();
  return [
    { id: 'content-dossier.registry.summary', method: 'GET', path: basePath, summary: createContentDossierRouteSummary(snapshot) },
    { id: 'content-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

