import { createAudienceFunnelsWorkspace, summarizeAudienceFunnels, createAudienceFunnelsNarratives } from './domain-audience-funnels.mjs';
import { createAudienceFunnelsPolicies, validateAudienceFunnelsPolicies, policySummaryAudienceFunnels } from './domain-audience-funnels-policies.mjs';

export function buildAudienceFunnelsSnapshot(workspaceName='Final continuation workspace'){const workspace=createAudienceFunnelsWorkspace(workspaceName); const policies=createAudienceFunnelsPolicies(); return {workspace,summary:summarizeAudienceFunnels(workspace),narratives:createAudienceFunnelsNarratives(workspace),policies,policySummary:policySummaryAudienceFunnels(policies),validation:validateAudienceFunnelsPolicies(policies)};}

export function createAudienceFunnelsChecklist(snapshot=buildAudienceFunnelsSnapshot()){return [{id:'audience-funnels-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'audience-funnels-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'audience-funnels-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createAudienceFunnelsApiDocument(snapshot=buildAudienceFunnelsSnapshot()){return {id:'audience-funnels-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/audience-funnels/overview'},{method:'POST',path:'/api/audience-funnels/validate'},{method:'GET',path:'/api/audience-funnels/policies'}],checklist:createAudienceFunnelsChecklist(snapshot)};}
