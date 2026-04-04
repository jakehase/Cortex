import { buildChannelPlaybooksSnapshot, createChannelPlaybooksChecklist } from '../service-channel-playbooks.mjs';

export function createChannelPlaybooksOpsRoutes(basePath = '/ops/channel-playbooks') { const snapshot = buildChannelPlaybooksSnapshot(); return [{ id: 'channel-playbooks.ops.health', method: 'GET', path: basePath + '/health', checklist: createChannelPlaybooksChecklist(snapshot) }, { id: 'channel-playbooks.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'channel-playbooks.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

