import { buildAudienceLabNotebooksSnapshot } from '../service-audience-lab-notebooks.mjs';

export function createAudienceLabNotebooksDashboardRoutes(basePath='/audience-lab-notebooks'){const snapshot=buildAudienceLabNotebooksSnapshot(); return [{id:'audience-lab-notebooks.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'audience-lab-notebooks.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'audience-lab-notebooks.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
