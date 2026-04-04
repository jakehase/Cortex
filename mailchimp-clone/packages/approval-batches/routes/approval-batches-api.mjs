import { buildApprovalBatchesSnapshot, createApprovalBatchesApiDocument } from '../service-approval-batches.mjs';

export function createApprovalBatchesApiRoutes(basePath='/api/approval-batches'){const snapshot=buildApprovalBatchesSnapshot(); return [{id:'approval-batches.api.overview',method:'GET',path:basePath+'/overview',summary:snapshot.summary},{id:'approval-batches.api.validate',method:'POST',path:basePath+'/validate',validation:snapshot.validation},{id:'approval-batches.api.document',method:'GET',path:basePath+'/document',document:createApprovalBatchesApiDocument(snapshot)}];}
