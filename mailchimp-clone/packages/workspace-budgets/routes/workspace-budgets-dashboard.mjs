import { buildWorkspaceBudgetsSnapshot } from '../service-workspace-budgets.mjs';

export function createWorkspaceBudgetsDashboardRoutes(basePath='/workspace-budgets'){const snapshot=buildWorkspaceBudgetsSnapshot(); return [{id:'workspace-budgets.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'workspace-budgets.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'workspace-budgets.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
