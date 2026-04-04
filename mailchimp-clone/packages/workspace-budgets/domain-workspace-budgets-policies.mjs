const DEFAULT_POLICIES=[{id:'workspace-budgets-policy-1',title:'Workspace Budgets guardrail',severity:'medium'},{id:'workspace-budgets-policy-2',title:'Workspace Budgets approval ring',severity:'high'},{id:'workspace-budgets-policy-3',title:'Workspace Budgets rollback lane',severity:'medium'}];

export function createWorkspaceBudgetsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'late-closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Workspace Budgets policy pack for late closeout.'}));}

export function validateWorkspaceBudgetsPolicies(policies=createWorkspaceBudgetsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryWorkspaceBudgets(policies=createWorkspaceBudgetsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
