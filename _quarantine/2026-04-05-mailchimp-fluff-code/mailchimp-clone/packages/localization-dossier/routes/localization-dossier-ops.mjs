import { buildLocalizationDossierSnapshot, createLocalizationDossierReadinessBoard } from '../service-localization-dossier.mjs';

export function createLocalizationDossierOpsRoutes(basePath = '/ops/localization-dossier') {
  const snapshot = buildLocalizationDossierSnapshot();
  return [
    { id: 'localization-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationDossierReadinessBoard(snapshot) },
    { id: 'localization-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

