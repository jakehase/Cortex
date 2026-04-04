import { createApprovalBatchesWorkspace, summarizeApprovalBatches, createApprovalBatchesNarratives } from './domain-approval-batches.mjs';
import { createApprovalBatchesPolicies, validateApprovalBatchesPolicies, policySummaryApprovalBatches } from './domain-approval-batches-policies.mjs';

export function buildApprovalBatchesSnapshot(workspaceName='Final ladder workspace'){const workspace=createApprovalBatchesWorkspace(workspaceName); const policies=createApprovalBatchesPolicies(); return {workspace,summary:summarizeApprovalBatches(workspace),narratives:createApprovalBatchesNarratives(workspace),policies,policySummary:policySummaryApprovalBatches(policies),validation:validateApprovalBatchesPolicies(policies)};}

export function createApprovalBatchesChecklist(snapshot=buildApprovalBatchesSnapshot()){return [{id:'approval-batches-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'approval-batches-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'approval-batches-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createApprovalBatchesApiDocument(snapshot=buildApprovalBatchesSnapshot()){return {id:'approval-batches-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/approval-batches/overview'},{method:'POST',path:'/api/approval-batches/validate'},{method:'GET',path:'/api/approval-batches/policies'}],checklist:createApprovalBatchesChecklist(snapshot)};}
