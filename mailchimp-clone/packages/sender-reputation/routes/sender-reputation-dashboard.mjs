import { buildSenderReputationSnapshot } from '../service-sender-reputation.mjs';

export function createSenderReputationDashboardRoutes(basePath='/sender-reputation'){const snapshot=buildSenderReputationSnapshot(); return [{id:'sender-reputation.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'sender-reputation.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'sender-reputation.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
