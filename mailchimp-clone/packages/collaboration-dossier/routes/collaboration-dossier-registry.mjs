import { buildCollaborationDossierSnapshot, createCollaborationDossierRouteSummary } from '../service-collaboration-dossier.mjs';

export function createCollaborationDossierRegistryRoutes(basePath = '/registry/collaboration-dossier') {
  const snapshot = buildCollaborationDossierSnapshot();
  return [
    { id: 'collaboration-dossier.registry.summary', method: 'GET', path: basePath, summary: createCollaborationDossierRouteSummary(snapshot) },
    { id: 'collaboration-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

