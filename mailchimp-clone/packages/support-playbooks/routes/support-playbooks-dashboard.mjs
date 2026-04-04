import { buildSupportPlaybooksSnapshot } from '../service-support-playbooks.mjs';

export function createSupportPlaybooksDashboardRoutes(basePath = '/support-playbooks') {
  const snapshot = buildSupportPlaybooksSnapshot();
  return [
    { id: 'support-playbooks.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'support-playbooks.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'support-playbooks.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
