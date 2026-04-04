import { createCampaignOpsWorkspace, summarizeCampaignOps, createCampaignOpsNarratives } from './domain-campaign-ops.mjs';
import { createCampaignOpsPolicies, validateCampaignOpsPolicies, policySummaryCampaignOps } from './domain-campaign-ops-policies.mjs';

export function buildCampaignOpsSnapshot(workspaceName='Final continuation workspace'){const workspace=createCampaignOpsWorkspace(workspaceName); const policies=createCampaignOpsPolicies(); return {workspace,summary:summarizeCampaignOps(workspace),narratives:createCampaignOpsNarratives(workspace),policies,policySummary:policySummaryCampaignOps(policies),validation:validateCampaignOpsPolicies(policies)};}

export function createCampaignOpsChecklist(snapshot=buildCampaignOpsSnapshot()){return [{id:'campaign-ops-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'campaign-ops-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'campaign-ops-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createCampaignOpsApiDocument(snapshot=buildCampaignOpsSnapshot()){return {id:'campaign-ops-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/campaign-ops/overview'},{method:'POST',path:'/api/campaign-ops/validate'},{method:'GET',path:'/api/campaign-ops/policies'}],checklist:createCampaignOpsChecklist(snapshot)};}
