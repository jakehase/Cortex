import { buildSupportPlaybooksSnapshot, createSupportPlaybooksChecklist } from '../service-support-playbooks.mjs';

export function createSupportPlaybooksOpsRoutes(basePath = '/ops/support-playbooks') {
  const snapshot = buildSupportPlaybooksSnapshot();
  return [
    { id: 'support-playbooks.ops.health', method: 'GET', path: basePath + '/health', checklist: createSupportPlaybooksChecklist(snapshot) },
    { id: 'support-playbooks.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'support-playbooks.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
