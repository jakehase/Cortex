import { buildCampaignDossierSnapshot, createCampaignDossierRouteSummary } from '../service-campaign-dossier.mjs';

export function createCampaignDossierRegistryRoutes(basePath = '/registry/campaign-dossier') {
  const snapshot = buildCampaignDossierSnapshot();
  return [
    { id: 'campaign-dossier.registry.summary', method: 'GET', path: basePath, summary: createCampaignDossierRouteSummary(snapshot) },
    { id: 'campaign-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

