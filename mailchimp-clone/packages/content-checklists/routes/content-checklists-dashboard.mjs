import { buildContentChecklistsSnapshot } from '../service-content-checklists.mjs';

export function createContentChecklistsDashboardRoutes(basePath='/content-checklists'){const snapshot=buildContentChecklistsSnapshot(); return [{id:'content-checklists.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'content-checklists.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'content-checklists.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
