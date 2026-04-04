import { buildCampaignBudgetingSnapshot } from '../service-campaign-budgeting.mjs';

export function createCampaignBudgetingDashboardRoutes(basePath = '/campaign-budgeting') { const snapshot = buildCampaignBudgetingSnapshot(); return [{ id: 'campaign-budgeting.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'campaign-budgeting.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'campaign-budgeting.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
