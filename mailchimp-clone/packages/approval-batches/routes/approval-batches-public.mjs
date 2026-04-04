import { buildApprovalBatchesSnapshot } from '../service-approval-batches.mjs';
import { createApprovalBatchesFixtures } from '../fixtures-approval-batches.mjs';

export function createApprovalBatchesPublicRoutes(basePath='/public/approval-batches'){const snapshot=buildApprovalBatchesSnapshot(); const fixtures=createApprovalBatchesFixtures(); return [{id:'approval-batches.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'approval-batches.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'approval-batches.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
