import { buildChannelHealthSnapshot } from '../service-channel-health.mjs';

export function createChannelHealthDashboardRoutes(basePath='/channel-health'){const snapshot=buildChannelHealthSnapshot(); return [{id:'channel-health.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'channel-health.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'channel-health.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
