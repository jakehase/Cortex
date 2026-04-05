import { buildAutomationDossierSnapshot, createAutomationDossierRouteSummary } from '../service-automation-dossier.mjs';

export function createAutomationDossierRegistryRoutes(basePath = '/registry/automation-dossier') {
  const snapshot = buildAutomationDossierSnapshot();
  return [
    { id: 'automation-dossier.registry.summary', method: 'GET', path: basePath, summary: createAutomationDossierRouteSummary(snapshot) },
    { id: 'automation-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

