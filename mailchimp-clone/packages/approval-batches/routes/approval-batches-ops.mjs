import { buildApprovalBatchesSnapshot, createApprovalBatchesChecklist } from '../service-approval-batches.mjs';

export function createApprovalBatchesOpsRoutes(basePath='/ops/approval-batches'){const snapshot=buildApprovalBatchesSnapshot(); return [{id:'approval-batches.ops.health',method:'GET',path:basePath+'/health',checklist:createApprovalBatchesChecklist(snapshot)},{id:'approval-batches.ops.policies',method:'GET',path:basePath+'/policies',policies:snapshot.policies},{id:'approval-batches.ops.metrics',method:'GET',path:basePath+'/metrics',scorecards:snapshot.workspace.scorecards}];}
