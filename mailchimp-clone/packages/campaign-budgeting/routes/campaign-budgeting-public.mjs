import { buildCampaignBudgetingSnapshot } from '../service-campaign-budgeting.mjs';
import { createCampaignBudgetingFixtures } from '../fixtures-campaign-budgeting.mjs';

export function createCampaignBudgetingPublicRoutes(basePath = '/public/campaign-budgeting') { const snapshot = buildCampaignBudgetingSnapshot(); const fixtures = createCampaignBudgetingFixtures(); return [{ id: 'campaign-budgeting.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'campaign-budgeting.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'campaign-budgeting.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
