import { buildChannelDossierSnapshot, createChannelDossierRouteSummary } from '../service-channel-dossier.mjs';

export function createChannelDossierRegistryRoutes(basePath = '/registry/channel-dossier') {
  const snapshot = buildChannelDossierSnapshot();
  return [
    { id: 'channel-dossier.registry.summary', method: 'GET', path: basePath, summary: createChannelDossierRouteSummary(snapshot) },
    { id: 'channel-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

