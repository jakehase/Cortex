import { buildEngagementForecastingSnapshot, createEngagementForecastingApiDocument } from '../service-engagement-forecasting.mjs';

export function createEngagementForecastingApiRoutes(basePath = '/api/engagement-forecasting') { const snapshot = buildEngagementForecastingSnapshot(); return [{ id: 'engagement-forecasting.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'engagement-forecasting.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'engagement-forecasting.api.document', method: 'GET', path: basePath + '/document', document: createEngagementForecastingApiDocument(snapshot) }]; }

