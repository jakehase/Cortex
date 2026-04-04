import { buildWorkspaceBudgetsSnapshot } from '../service-workspace-budgets.mjs';
import { createWorkspaceBudgetsFixtures } from '../fixtures-workspace-budgets.mjs';

export function createWorkspaceBudgetsPublicRoutes(basePath='/public/workspace-budgets'){const snapshot=buildWorkspaceBudgetsSnapshot(); const fixtures=createWorkspaceBudgetsFixtures(); return [{id:'workspace-budgets.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'workspace-budgets.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'workspace-budgets.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
