import { buildChannelPlaybooksSnapshot } from '../service-channel-playbooks.mjs';

export function createChannelPlaybooksDashboardRoutes(basePath = '/channel-playbooks') { const snapshot = buildChannelPlaybooksSnapshot(); return [{ id: 'channel-playbooks.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'channel-playbooks.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'channel-playbooks.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

