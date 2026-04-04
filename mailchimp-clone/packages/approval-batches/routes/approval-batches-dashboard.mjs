import { buildApprovalBatchesSnapshot } from '../service-approval-batches.mjs';

export function createApprovalBatchesDashboardRoutes(basePath='/approval-batches'){const snapshot=buildApprovalBatchesSnapshot(); return [{id:'approval-batches.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'approval-batches.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'approval-batches.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
