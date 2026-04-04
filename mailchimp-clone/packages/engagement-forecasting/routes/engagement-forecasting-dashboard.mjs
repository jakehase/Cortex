import { buildEngagementForecastingSnapshot } from '../service-engagement-forecasting.mjs';

export function createEngagementForecastingDashboardRoutes(basePath = '/engagement-forecasting') { const snapshot = buildEngagementForecastingSnapshot(); return [{ id: 'engagement-forecasting.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'engagement-forecasting.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'engagement-forecasting.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

