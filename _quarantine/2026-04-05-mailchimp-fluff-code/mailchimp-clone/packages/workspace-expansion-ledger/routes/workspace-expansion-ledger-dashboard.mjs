import { buildWorkspaceExpansionLedgerSnapshot } from '../service-workspace-expansion-ledger.mjs';

export function createWorkspaceExpansionLedgerDashboardRoutes(basePath='/workspace-expansion-ledger'){const snapshot=buildWorkspaceExpansionLedgerSnapshot(); return [{id:'workspace-expansion-ledger.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'workspace-expansion-ledger.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'workspace-expansion-ledger.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
