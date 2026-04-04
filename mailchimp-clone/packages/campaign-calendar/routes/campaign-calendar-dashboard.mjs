import { buildCampaignCalendarSnapshot } from '../service-campaign-calendar.mjs';

export function createCampaignCalendarDashboardRoutes(basePath = '/campaign-calendar') {
  const snapshot = buildCampaignCalendarSnapshot();
  return [
    { id: 'campaign-calendar.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'campaign-calendar.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-calendar.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
