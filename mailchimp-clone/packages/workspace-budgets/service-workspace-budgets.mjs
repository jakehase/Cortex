import { createWorkspaceBudgetsWorkspace, summarizeWorkspaceBudgets, createWorkspaceBudgetsNarratives } from './domain-workspace-budgets.mjs';
import { createWorkspaceBudgetsPolicies, validateWorkspaceBudgetsPolicies, policySummaryWorkspaceBudgets } from './domain-workspace-budgets-policies.mjs';

export function buildWorkspaceBudgetsSnapshot(workspaceName='Late closeout workspace'){const workspace=createWorkspaceBudgetsWorkspace(workspaceName); const policies=createWorkspaceBudgetsPolicies(); return {workspace,summary:summarizeWorkspaceBudgets(workspace),narratives:createWorkspaceBudgetsNarratives(workspace),policies,policySummary:policySummaryWorkspaceBudgets(policies),validation:validateWorkspaceBudgetsPolicies(policies)};}

export function createWorkspaceBudgetsChecklist(snapshot=buildWorkspaceBudgetsSnapshot()){return [{id:'workspace-budgets-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'workspace-budgets-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'workspace-budgets-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createWorkspaceBudgetsApiDocument(snapshot=buildWorkspaceBudgetsSnapshot()){return {id:'workspace-budgets-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/workspace-budgets/overview'},{method:'POST',path:'/api/workspace-budgets/validate'},{method:'GET',path:'/api/workspace-budgets/policies'}],checklist:createWorkspaceBudgetsChecklist(snapshot)};}
