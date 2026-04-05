import { buildDeliverabilityDossierSnapshot, createDeliverabilityDossierRouteSummary } from '../service-deliverability-dossier.mjs';

export function createDeliverabilityDossierDashboardRoutes(basePath = '/deliverability-dossier') {
  const snapshot = buildDeliverabilityDossierSnapshot();
  return [
    { id: 'deliverability-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityDossierRouteSummary(snapshot) },
    { id: 'deliverability-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

