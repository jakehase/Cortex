import { buildAudienceDossierSnapshot, createAudienceDossierRouteSummary } from '../service-audience-dossier.mjs';

export function createAudienceDossierRegistryRoutes(basePath = '/registry/audience-dossier') {
  const snapshot = buildAudienceDossierSnapshot();
  return [
    { id: 'audience-dossier.registry.summary', method: 'GET', path: basePath, summary: createAudienceDossierRouteSummary(snapshot) },
    { id: 'audience-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

