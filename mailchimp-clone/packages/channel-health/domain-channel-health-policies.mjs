const DEFAULT_POLICIES=[{id:'channel-health-policy-1',title:'Channel Health guardrail',severity:'medium'},{id:'channel-health-policy-2',title:'Channel Health approval ring',severity:'high'},{id:'channel-health-policy-3',title:'Channel Health rollback lane',severity:'medium'}];

export function createChannelHealthPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Channel Health policy pack for the continuation.'}));}

export function validateChannelHealthPolicies(policies=createChannelHealthPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryChannelHealth(policies=createChannelHealthPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
