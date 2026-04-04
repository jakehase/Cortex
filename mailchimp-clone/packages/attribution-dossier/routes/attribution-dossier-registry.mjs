import { buildAttributionDossierSnapshot, createAttributionDossierRouteSummary } from '../service-attribution-dossier.mjs';

export function createAttributionDossierRegistryRoutes(basePath = '/registry/attribution-dossier') {
  const snapshot = buildAttributionDossierSnapshot();
  return [
    { id: 'attribution-dossier.registry.summary', method: 'GET', path: basePath, summary: createAttributionDossierRouteSummary(snapshot) },
    { id: 'attribution-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

