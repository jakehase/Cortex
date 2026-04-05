import { buildInsightsDossierSnapshot, createInsightsDossierRouteSummary } from '../service-insights-dossier.mjs';

export function createInsightsDossierRegistryRoutes(basePath = '/registry/insights-dossier') {
  const snapshot = buildInsightsDossierSnapshot();
  return [
    { id: 'insights-dossier.registry.summary', method: 'GET', path: basePath, summary: createInsightsDossierRouteSummary(snapshot) },
    { id: 'insights-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

