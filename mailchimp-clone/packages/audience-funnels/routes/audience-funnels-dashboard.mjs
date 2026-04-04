import { buildAudienceFunnelsSnapshot } from '../service-audience-funnels.mjs';

export function createAudienceFunnelsDashboardRoutes(basePath='/audience-funnels'){const snapshot=buildAudienceFunnelsSnapshot(); return [{id:'audience-funnels.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'audience-funnels.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'audience-funnels.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
