import { buildCampaignSandboxesSnapshot, createCampaignSandboxesChecklist } from '../service-campaign-sandboxes.mjs';

export function createCampaignSandboxesOpsRoutes(basePath = '/ops/campaign-sandboxes') { const snapshot = buildCampaignSandboxesSnapshot(); return [{ id: 'campaign-sandboxes.ops.health', method: 'GET', path: basePath + '/health', checklist: createCampaignSandboxesChecklist(snapshot) }, { id: 'campaign-sandboxes.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'campaign-sandboxes.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

