import { buildCommerceDossierSnapshot, createCommerceDossierRouteSummary } from '../service-commerce-dossier.mjs';

export function createCommerceDossierRegistryRoutes(basePath = '/registry/commerce-dossier') {
  const snapshot = buildCommerceDossierSnapshot();
  return [
    { id: 'commerce-dossier.registry.summary', method: 'GET', path: basePath, summary: createCommerceDossierRouteSummary(snapshot) },
    { id: 'commerce-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

