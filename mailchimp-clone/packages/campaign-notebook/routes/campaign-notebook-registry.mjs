import { buildCampaignNotebookSnapshot, createCampaignNotebookRouteSummary } from '../service-campaign-notebook.mjs';

export function createCampaignNotebookRegistryRoutes(basePath = '/registry/campaign-notebook') {
  const snapshot = buildCampaignNotebookSnapshot();
  return [
    { id: 'campaign-notebook.registry.summary', method: 'GET', path: basePath, summary: createCampaignNotebookRouteSummary(snapshot) },
    { id: 'campaign-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

