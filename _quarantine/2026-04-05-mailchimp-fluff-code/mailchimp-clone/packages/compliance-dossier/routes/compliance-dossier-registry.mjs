import { buildComplianceDossierSnapshot, createComplianceDossierRouteSummary } from '../service-compliance-dossier.mjs';

export function createComplianceDossierRegistryRoutes(basePath = '/registry/compliance-dossier') {
  const snapshot = buildComplianceDossierSnapshot();
  return [
    { id: 'compliance-dossier.registry.summary', method: 'GET', path: basePath, summary: createComplianceDossierRouteSummary(snapshot) },
    { id: 'compliance-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

