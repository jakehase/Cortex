import { buildEcommerceDossierSnapshot, createEcommerceDossierRouteSummary } from '../service-ecommerce-dossier.mjs';

export function createEcommerceDossierRegistryRoutes(basePath = '/registry/ecommerce-dossier') {
  const snapshot = buildEcommerceDossierSnapshot();
  return [
    { id: 'ecommerce-dossier.registry.summary', method: 'GET', path: basePath, summary: createEcommerceDossierRouteSummary(snapshot) },
    { id: 'ecommerce-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

