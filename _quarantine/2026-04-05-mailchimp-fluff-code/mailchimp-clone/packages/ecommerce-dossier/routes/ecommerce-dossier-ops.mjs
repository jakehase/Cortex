import { buildEcommerceDossierSnapshot, createEcommerceDossierReadinessBoard } from '../service-ecommerce-dossier.mjs';

export function createEcommerceDossierOpsRoutes(basePath = '/ops/ecommerce-dossier') {
  const snapshot = buildEcommerceDossierSnapshot();
  return [
    { id: 'ecommerce-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceDossierReadinessBoard(snapshot) },
    { id: 'ecommerce-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

