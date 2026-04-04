import { buildReleaseCommandCenterSnapshot, createReleaseCommandCenterChecklist } from '../service-release-command-center.mjs';

export function createReleaseCommandCenterOpsRoutes(basePath = '/ops/release-command-center') { const snapshot = buildReleaseCommandCenterSnapshot(); return [{ id: 'release-command-center.ops.health', method: 'GET', path: basePath + '/health', checklist: createReleaseCommandCenterChecklist(snapshot) }, { id: 'release-command-center.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'release-command-center.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

