import { buildLifecycleDossierSnapshot, createLifecycleDossierRouteSummary } from '../service-lifecycle-dossier.mjs';

export function createLifecycleDossierRegistryRoutes(basePath = '/registry/lifecycle-dossier') {
  const snapshot = buildLifecycleDossierSnapshot();
  return [
    { id: 'lifecycle-dossier.registry.summary', method: 'GET', path: basePath, summary: createLifecycleDossierRouteSummary(snapshot) },
    { id: 'lifecycle-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

