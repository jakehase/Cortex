import { createSenderReputationWorkspace, summarizeSenderReputation, createSenderReputationNarratives } from './domain-sender-reputation.mjs';
import { createSenderReputationPolicies, validateSenderReputationPolicies, policySummarySenderReputation } from './domain-sender-reputation-policies.mjs';

export function buildSenderReputationSnapshot(workspaceName='Final ladder workspace'){const workspace=createSenderReputationWorkspace(workspaceName); const policies=createSenderReputationPolicies(); return {workspace,summary:summarizeSenderReputation(workspace),narratives:createSenderReputationNarratives(workspace),policies,policySummary:policySummarySenderReputation(policies),validation:validateSenderReputationPolicies(policies)};}

export function createSenderReputationChecklist(snapshot=buildSenderReputationSnapshot()){return [{id:'sender-reputation-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'sender-reputation-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'sender-reputation-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createSenderReputationApiDocument(snapshot=buildSenderReputationSnapshot()){return {id:'sender-reputation-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/sender-reputation/overview'},{method:'POST',path:'/api/sender-reputation/validate'},{method:'GET',path:'/api/sender-reputation/policies'}],checklist:createSenderReputationChecklist(snapshot)};}
