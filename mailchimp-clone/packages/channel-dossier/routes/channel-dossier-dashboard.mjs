import { buildChannelDossierSnapshot, createChannelDossierRouteSummary } from '../service-channel-dossier.mjs';

export function createChannelDossierDashboardRoutes(basePath = '/channel-dossier') {
  const snapshot = buildChannelDossierSnapshot();
  return [
    { id: 'channel-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createChannelDossierRouteSummary(snapshot) },
    { id: 'channel-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

