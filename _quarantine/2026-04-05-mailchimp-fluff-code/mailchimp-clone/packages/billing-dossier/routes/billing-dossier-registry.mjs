import { buildBillingDossierSnapshot, createBillingDossierRouteSummary } from '../service-billing-dossier.mjs';

export function createBillingDossierRegistryRoutes(basePath = '/registry/billing-dossier') {
  const snapshot = buildBillingDossierSnapshot();
  return [
    { id: 'billing-dossier.registry.summary', method: 'GET', path: basePath, summary: createBillingDossierRouteSummary(snapshot) },
    { id: 'billing-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

