const DEFAULT_POLICIES=[{id:'content-checklists-policy-1',title:'Content Checklists guardrail',severity:'medium'},{id:'content-checklists-policy-2',title:'Content Checklists approval ring',severity:'high'},{id:'content-checklists-policy-3',title:'Content Checklists rollback lane',severity:'medium'}];

export function createContentChecklistsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'late-closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Content Checklists policy pack for late closeout.'}));}

export function validateContentChecklistsPolicies(policies=createContentChecklistsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryContentChecklists(policies=createContentChecklistsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
