import { buildChannelDossierSnapshot, createChannelDossierReadinessBoard } from '../service-channel-dossier.mjs';

export function createChannelDossierOpsRoutes(basePath = '/ops/channel-dossier') {
  const snapshot = buildChannelDossierSnapshot();
  return [
    { id: 'channel-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelDossierReadinessBoard(snapshot) },
    { id: 'channel-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

