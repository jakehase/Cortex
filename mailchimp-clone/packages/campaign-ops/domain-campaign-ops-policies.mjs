const DEFAULT_POLICIES=[{id:'campaign-ops-policy-1',title:'Campaign Ops guardrail',severity:'medium'},{id:'campaign-ops-policy-2',title:'Campaign Ops approval ring',severity:'high'},{id:'campaign-ops-policy-3',title:'Campaign Ops rollback lane',severity:'medium'}];

export function createCampaignOpsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Campaign Ops policy pack for the continuation.'}));}

export function validateCampaignOpsPolicies(policies=createCampaignOpsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryCampaignOps(policies=createCampaignOpsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
