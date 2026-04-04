import { buildCampaignSandboxesSnapshot } from '../service-campaign-sandboxes.mjs';

export function createCampaignSandboxesDashboardRoutes(basePath = '/campaign-sandboxes') { const snapshot = buildCampaignSandboxesSnapshot(); return [{ id: 'campaign-sandboxes.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'campaign-sandboxes.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'campaign-sandboxes.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

