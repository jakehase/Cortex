import { buildReleaseAuditsSnapshot, createReleaseAuditsChecklist } from '../service-release-audits.mjs';

export function createReleaseAuditsOpsRoutes(basePath='/ops/release-audits'){const snapshot=buildReleaseAuditsSnapshot(); return [{id:'release-audits.ops.health',method:'GET',path:basePath+'/health',checklist:createReleaseAuditsChecklist(snapshot)},{id:'release-audits.ops.policies',method:'GET',path:basePath+'/policies',policies:snapshot.policies},{id:'release-audits.ops.metrics',method:'GET',path:basePath+'/metrics',scorecards:snapshot.workspace.scorecards}];}
