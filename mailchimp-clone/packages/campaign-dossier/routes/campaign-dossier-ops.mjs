import { buildCampaignDossierSnapshot, createCampaignDossierReadinessBoard } from '../service-campaign-dossier.mjs';

export function createCampaignDossierOpsRoutes(basePath = '/ops/campaign-dossier') {
  const snapshot = buildCampaignDossierSnapshot();
  return [
    { id: 'campaign-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignDossierReadinessBoard(snapshot) },
    { id: 'campaign-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

