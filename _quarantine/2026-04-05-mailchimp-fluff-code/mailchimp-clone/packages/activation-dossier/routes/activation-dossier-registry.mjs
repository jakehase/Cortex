import { buildActivationDossierSnapshot, createActivationDossierRouteSummary } from '../service-activation-dossier.mjs';

export function createActivationDossierRegistryRoutes(basePath = '/registry/activation-dossier') {
  const snapshot = buildActivationDossierSnapshot();
  return [
    { id: 'activation-dossier.registry.summary', method: 'GET', path: basePath, summary: createActivationDossierRouteSummary(snapshot) },
    { id: 'activation-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

