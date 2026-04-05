import { buildChannelDossierSnapshot, createChannelDossierApiDocument } from '../service-channel-dossier.mjs';

export function createChannelDossierApiRoutes(basePath = '/api/channel-dossier') {
  const snapshot = buildChannelDossierSnapshot();
  return [
    { id: 'channel-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-dossier.api.document', method: 'GET', path: basePath + '/document', document: createChannelDossierApiDocument(snapshot) }
  ];
}

