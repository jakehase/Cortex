import { buildCampaignSandboxesSnapshot, createCampaignSandboxesApiDocument } from '../service-campaign-sandboxes.mjs';

export function createCampaignSandboxesApiRoutes(basePath = '/api/campaign-sandboxes') { const snapshot = buildCampaignSandboxesSnapshot(); return [{ id: 'campaign-sandboxes.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'campaign-sandboxes.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'campaign-sandboxes.api.document', method: 'GET', path: basePath + '/document', document: createCampaignSandboxesApiDocument(snapshot) }]; }

