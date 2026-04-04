import { buildLoyaltyDossierSnapshot, createLoyaltyDossierRouteSummary } from '../service-loyalty-dossier.mjs';

export function createLoyaltyDossierRegistryRoutes(basePath = '/registry/loyalty-dossier') {
  const snapshot = buildLoyaltyDossierSnapshot();
  return [
    { id: 'loyalty-dossier.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyDossierRouteSummary(snapshot) },
    { id: 'loyalty-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

