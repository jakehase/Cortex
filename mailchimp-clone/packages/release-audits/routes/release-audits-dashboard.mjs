import { buildReleaseAuditsSnapshot } from '../service-release-audits.mjs';

export function createReleaseAuditsDashboardRoutes(basePath='/release-audits'){const snapshot=buildReleaseAuditsSnapshot(); return [{id:'release-audits.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'release-audits.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'release-audits.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
