import { buildLocalizationDossierSnapshot, createLocalizationDossierRouteSummary } from '../service-localization-dossier.mjs';

export function createLocalizationDossierDashboardRoutes(basePath = '/localization-dossier') {
  const snapshot = buildLocalizationDossierSnapshot();
  return [
    { id: 'localization-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationDossierRouteSummary(snapshot) },
    { id: 'localization-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

