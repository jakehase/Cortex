import { buildCreativeDossierSnapshot, createCreativeDossierRouteSummary } from '../service-creative-dossier.mjs';

export function createCreativeDossierRegistryRoutes(basePath = '/registry/creative-dossier') {
  const snapshot = buildCreativeDossierSnapshot();
  return [
    { id: 'creative-dossier.registry.summary', method: 'GET', path: basePath, summary: createCreativeDossierRouteSummary(snapshot) },
    { id: 'creative-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

