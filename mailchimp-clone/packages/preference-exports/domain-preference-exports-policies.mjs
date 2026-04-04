const DEFAULT_POLICIES=[{id:'preference-exports-policy-1',title:'Preference Exports guardrail',severity:'medium'},{id:'preference-exports-policy-2',title:'Preference Exports approval ring',severity:'high'},{id:'preference-exports-policy-3',title:'Preference Exports rollback lane',severity:'medium'}];

export function createPreferenceExportsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'late-closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Preference Exports policy pack for late closeout.'}));}

export function validatePreferenceExportsPolicies(policies=createPreferenceExportsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryPreferenceExports(policies=createPreferenceExportsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
