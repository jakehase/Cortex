import { buildIntegrationsDossierSnapshot, createIntegrationsDossierRouteSummary } from '../service-integrations-dossier.mjs';

export function createIntegrationsDossierRegistryRoutes(basePath = '/registry/integrations-dossier') {
  const snapshot = buildIntegrationsDossierSnapshot();
  return [
    { id: 'integrations-dossier.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsDossierRouteSummary(snapshot) },
    { id: 'integrations-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

