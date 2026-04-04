import { createContentChecklistsWorkspace, summarizeContentChecklists, createContentChecklistsNarratives } from './domain-content-checklists.mjs';
import { createContentChecklistsPolicies, validateContentChecklistsPolicies, policySummaryContentChecklists } from './domain-content-checklists-policies.mjs';

export function buildContentChecklistsSnapshot(workspaceName='Late closeout workspace'){const workspace=createContentChecklistsWorkspace(workspaceName); const policies=createContentChecklistsPolicies(); return {workspace,summary:summarizeContentChecklists(workspace),narratives:createContentChecklistsNarratives(workspace),policies,policySummary:policySummaryContentChecklists(policies),validation:validateContentChecklistsPolicies(policies)};}

export function createContentChecklistsChecklist(snapshot=buildContentChecklistsSnapshot()){return [{id:'content-checklists-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'content-checklists-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'content-checklists-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createContentChecklistsApiDocument(snapshot=buildContentChecklistsSnapshot()){return {id:'content-checklists-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/content-checklists/overview'},{method:'POST',path:'/api/content-checklists/validate'},{method:'GET',path:'/api/content-checklists/policies'}],checklist:createContentChecklistsChecklist(snapshot)};}
