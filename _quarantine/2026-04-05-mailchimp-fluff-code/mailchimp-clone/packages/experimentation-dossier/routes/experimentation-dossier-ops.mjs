import { buildExperimentationDossierSnapshot, createExperimentationDossierReadinessBoard } from '../service-experimentation-dossier.mjs';

export function createExperimentationDossierOpsRoutes(basePath = '/ops/experimentation-dossier') {
  const snapshot = buildExperimentationDossierSnapshot();
  return [
    { id: 'experimentation-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationDossierReadinessBoard(snapshot) },
    { id: 'experimentation-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

