const DEFAULT_POLICIES=[{id:'audience-lab-notebooks-policy-1',title:'Audience Lab Notebooks guardrail',severity:'medium'},{id:'audience-lab-notebooks-policy-2',title:'Audience Lab Notebooks approval ring',severity:'high'},{id:'audience-lab-notebooks-policy-3',title:'Audience Lab Notebooks rollback lane',severity:'medium'}];

export function createAudienceLabNotebooksPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Audience Lab Notebooks policy pack for closeout.'}));}

export function validateAudienceLabNotebooksPolicies(policies=createAudienceLabNotebooksPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryAudienceLabNotebooks(policies=createAudienceLabNotebooksPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
