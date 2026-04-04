import { createChannelHealthWorkspace, summarizeChannelHealth, createChannelHealthNarratives } from './domain-channel-health.mjs';
import { createChannelHealthPolicies, validateChannelHealthPolicies, policySummaryChannelHealth } from './domain-channel-health-policies.mjs';

export function buildChannelHealthSnapshot(workspaceName='Final continuation workspace'){const workspace=createChannelHealthWorkspace(workspaceName); const policies=createChannelHealthPolicies(); return {workspace,summary:summarizeChannelHealth(workspace),narratives:createChannelHealthNarratives(workspace),policies,policySummary:policySummaryChannelHealth(policies),validation:validateChannelHealthPolicies(policies)};}

export function createChannelHealthChecklist(snapshot=buildChannelHealthSnapshot()){return [{id:'channel-health-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'channel-health-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'channel-health-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createChannelHealthApiDocument(snapshot=buildChannelHealthSnapshot()){return {id:'channel-health-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/channel-health/overview'},{method:'POST',path:'/api/channel-health/validate'},{method:'GET',path:'/api/channel-health/policies'}],checklist:createChannelHealthChecklist(snapshot)};}
