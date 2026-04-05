import { buildCustomerDossierSnapshot, createCustomerDossierRouteSummary } from '../service-customer-dossier.mjs';

export function createCustomerDossierRegistryRoutes(basePath = '/registry/customer-dossier') {
  const snapshot = buildCustomerDossierSnapshot();
  return [
    { id: 'customer-dossier.registry.summary', method: 'GET', path: basePath, summary: createCustomerDossierRouteSummary(snapshot) },
    { id: 'customer-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

