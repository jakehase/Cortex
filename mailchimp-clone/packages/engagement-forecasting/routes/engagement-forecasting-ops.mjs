import { buildEngagementForecastingSnapshot, createEngagementForecastingChecklist } from '../service-engagement-forecasting.mjs';

export function createEngagementForecastingOpsRoutes(basePath = '/ops/engagement-forecasting') { const snapshot = buildEngagementForecastingSnapshot(); return [{ id: 'engagement-forecasting.ops.health', method: 'GET', path: basePath + '/health', checklist: createEngagementForecastingChecklist(snapshot) }, { id: 'engagement-forecasting.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'engagement-forecasting.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

