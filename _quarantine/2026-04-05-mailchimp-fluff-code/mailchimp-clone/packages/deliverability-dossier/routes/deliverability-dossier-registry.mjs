import { buildDeliverabilityDossierSnapshot, createDeliverabilityDossierRouteSummary } from '../service-deliverability-dossier.mjs';

export function createDeliverabilityDossierRegistryRoutes(basePath = '/registry/deliverability-dossier') {
  const snapshot = buildDeliverabilityDossierSnapshot();
  return [
    { id: 'deliverability-dossier.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityDossierRouteSummary(snapshot) },
    { id: 'deliverability-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

