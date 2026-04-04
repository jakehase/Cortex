import { buildEngagementForecastingSnapshot } from '../service-engagement-forecasting.mjs';
import { createEngagementForecastingFixtures } from '../fixtures-engagement-forecasting.mjs';

export function createEngagementForecastingPublicRoutes(basePath = '/public/engagement-forecasting') { const snapshot = buildEngagementForecastingSnapshot(); const fixtures = createEngagementForecastingFixtures(); return [{ id: 'engagement-forecasting.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'engagement-forecasting.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'engagement-forecasting.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

