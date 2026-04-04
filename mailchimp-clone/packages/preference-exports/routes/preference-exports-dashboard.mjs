import { buildPreferenceExportsSnapshot } from '../service-preference-exports.mjs';

export function createPreferenceExportsDashboardRoutes(basePath='/preference-exports'){const snapshot=buildPreferenceExportsSnapshot(); return [{id:'preference-exports.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'preference-exports.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'preference-exports.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
