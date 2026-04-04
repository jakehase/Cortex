const DEFAULT_POLICIES=[{id:'approval-batches-policy-1',title:'Approval Batches guardrail',severity:'medium'},{id:'approval-batches-policy-2',title:'Approval Batches approval ring',severity:'high'},{id:'approval-batches-policy-3',title:'Approval Batches rollback lane',severity:'medium'}];

export function createApprovalBatchesPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-ladder-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Approval Batches policy pack for final laddering.'}));}

export function validateApprovalBatchesPolicies(policies=createApprovalBatchesPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryApprovalBatches(policies=createApprovalBatchesPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
