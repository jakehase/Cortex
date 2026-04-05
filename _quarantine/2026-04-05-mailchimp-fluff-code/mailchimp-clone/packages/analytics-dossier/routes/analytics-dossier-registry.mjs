import { buildAnalyticsDossierSnapshot, createAnalyticsDossierRouteSummary } from '../service-analytics-dossier.mjs';

export function createAnalyticsDossierRegistryRoutes(basePath = '/registry/analytics-dossier') {
  const snapshot = buildAnalyticsDossierSnapshot();
  return [
    { id: 'analytics-dossier.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsDossierRouteSummary(snapshot) },
    { id: 'analytics-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

