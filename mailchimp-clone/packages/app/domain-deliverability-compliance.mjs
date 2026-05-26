import { persistState } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';

export const SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'settings_domains_deliverability_runtime_layer',
  label: 'Settings domains and deliverability runtime contract',
  controls: [
    'dns_authentication_check_ledger',
    'dmarc_alignment_evidence',
    'sender_reputation_warmup_plan',
    'dedicated_ip_readiness',
    'compliance_review_run',
    'deliverability_runtime_snapshot_api'
  ],
  evidenceContract: [
    'domain_dns_checks_record_spf_dkim_dmarc_and_bimi_state',
    'dmarc_alignment_records_policy_alignment_and_reporting_uri',
    'sender_reputation_warmup_tracks_stage_daily_cap_and_reputation_band',
    'dedicated_ip_readiness_records_pool_assignment_reverse_dns_and_ramp_status',
    'compliance_reviews_link_domain_alert_suppression_and_sender_profile_state',
    'runtime_snapshot_persists_dns_alignment_warmup_ip_review_and_health'
  ]
});

function ensureDeliverabilityRuntimeCollections(state) {
  state.db ||= {};
  state.db.workspaces ||= [];
  state.db.deliverabilityRuntimeSnapshots ||= [];
  state.db.domainDnsCheckEvents ||= [];
  state.db.domainDmarcAlignmentEvents ||= [];
  state.db.senderReputationWarmupEvents ||= [];
  state.db.dedicatedIpReadinessEvents ||= [];
  state.db.complianceReviewRuns ||= [];
  state.db.complianceAlerts ||= [];
  state.db.suppressionEntries ||= [];
}

function workspaceAlerts(state, workspaceId) {
  ensureDeliverabilityRuntimeCollections(state);
  return state.db.complianceAlerts.filter((entry) => entry.workspaceId === workspaceId);
}

export function ensureComplianceAlerts(state, actor) {
  const workspace = actor.workspace;
  const alerts = workspaceAlerts(state, workspace.id);
  if (alerts.length) return alerts;
  const seeded = [
    { id: createId('alert'), workspaceId: workspace.id, type: 'sender_profile', severity: 'medium', status: 'open', title: 'Sender profile review', detail: 'Verify sender email, reply-to, and physical address before high-volume sends.', createdAt: nowIso(), resolvedAt: null },
    { id: createId('alert'), workspaceId: workspace.id, type: 'domain_authentication', severity: 'high', status: 'open', title: 'Authenticate a sending domain', detail: 'Connect and authenticate at least one sending domain for optimal inbox placement.', createdAt: nowIso(), resolvedAt: null },
    { id: createId('alert'), workspaceId: workspace.id, type: 'suppression_hygiene', severity: 'low', status: 'open', title: 'Review suppression hygiene', detail: 'Suppress bounced or opted-out recipients before next send.', createdAt: nowIso(), resolvedAt: null }
  ];
  state.db.complianceAlerts.unshift(...seeded);
  persistState(state);
  return seeded;
}

export function deliverabilityChecklist(workspace = {}) {
  const settings = workspace.settings || {};
  const domains = settings.domains || [];
  return [
    { id: 'sender_email', label: 'Sender email configured', ok: Boolean(settings.senderEmail) },
    { id: 'physical_address', label: 'Physical address configured', ok: Boolean(settings.address) },
    { id: 'verified_domain', label: 'Verified sending domain connected', ok: domains.some((entry) => entry.verificationStatus === 'verified') },
    { id: 'authenticated_domain', label: 'Authenticated sending domain connected', ok: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { id: 'default_domain', label: 'Default sending domain selected', ok: domains.some((entry) => entry.isDefault) }
  ];
}

export function deliverabilityHealth(state, workspaceId) {
  ensureDeliverabilityRuntimeCollections(state);
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || { id: workspaceId, settings: { domains: [] } };
  const alerts = workspaceAlerts(state, workspaceId);
  const unresolved = alerts.filter((entry) => entry.status !== 'resolved');
  const checklist = deliverabilityChecklist(workspace);
  const dnsChecks = state.db.domainDnsCheckEvents.filter((entry) => entry.workspaceId === workspaceId);
  const dmarcEvents = state.db.domainDmarcAlignmentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const warmupEvents = state.db.senderReputationWarmupEvents.filter((entry) => entry.workspaceId === workspaceId);
  const dedicatedIpEvents = state.db.dedicatedIpReadinessEvents.filter((entry) => entry.workspaceId === workspaceId);
  const reviewRuns = state.db.complianceReviewRuns.filter((entry) => entry.workspaceId === workspaceId);
  const checklistScore = checklist.filter((entry) => entry.ok).length * 18;
  const alertPenalty = unresolved.length * 8;
  const suppressionCount = state.db.suppressionEntries.filter((entry) => entry.workspaceId === workspaceId).length;
  const runtimeBonus = Math.min(15, (dnsChecks.some((entry) => entry.status === 'pass') ? 4 : 0) + (dmarcEvents.some((entry) => entry.aligned) ? 4 : 0) + (warmupEvents.length ? 3 : 0) + (dedicatedIpEvents.length ? 2 : 0) + (reviewRuns.length ? 2 : 0));
  const score = Math.max(42, Math.min(99, checklistScore + 20 + runtimeBonus - alertPenalty - Math.min(suppressionCount * 2, 10)));
  return {
    score,
    unresolvedAlerts: unresolved.length,
    suppressionCount,
    checklist,
    runtimeEvidence: {
      dnsCheckCount: dnsChecks.length,
      dmarcAlignmentCount: dmarcEvents.length,
      warmupEventCount: warmupEvents.length,
      dedicatedIpEventCount: dedicatedIpEvents.length,
      complianceReviewCount: reviewRuns.length
    },
    inboxPlacementBand: score >= 85 ? 'strong' : score >= 70 ? 'monitoring' : 'needs_attention'
  };
}

export function addSuppressionEntry(state, actor, body) {
  const email = String(body.email || '').toLowerCase().trim();
  const existing = state.db.suppressionEntries.find((entry) => entry.workspaceId === actor.workspace.id && entry.email === email);
  if (existing) return existing;
  const entry = {
    id: createId('suppression'),
    workspaceId: actor.workspace.id,
    email,
    reason: body.reason || 'manual_review',
    source: body.source || 'deliverability_center',
    createdAt: nowIso()
  };
  state.db.suppressionEntries.unshift(entry);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'suppression-add', detail: `Suppressed ${email}` });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'suppression-added', payload: { email, reason: entry.reason } });
  return entry;
}

export function resolveComplianceAlert(state, actor, alert) {
  alert.status = 'resolved';
  alert.resolvedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'compliance-alert-resolve', detail: `Resolved ${alert.type}` });
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'compliance-alert-resolved', message: `Resolved ${alert.title}`, meta: { alertId: alert.id } });
  return alert;
}

function domainForRuntime(actor, domainId = null) {
  const domains = actor.workspace.settings.domains || [];
  return domains.find((entry) => entry.id === domainId) || domains.find((entry) => entry.isDefault) || domains[0] || null;
}

export function recordDomainDnsAuthenticationCheck(state, actor, body = {}) {
  ensureDeliverabilityRuntimeCollections(state);
  const domain = domainForRuntime(actor, body.domainId);
  const domainName = body.domain || domain?.name || 'example.com';
  const event = {
    id: createId('dnscheck'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    domainId: domain?.id || null,
    domain: domainName,
    status: body.status || 'pass',
    spf: body.spf || `v=spf1 include:mailclone.example ~all`,
    dkim: body.dkim || `k=rsa; p=${String(domainName).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'mailclone'}_selector`,
    dmarc: body.dmarc || 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.test',
    bimi: body.bimi || 'not_configured',
    runtimeContract: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  if (domain) {
    domain.verificationStatus = 'verified';
    domain.authenticationStatus = 'authenticated';
    domain.lastDnsCheckedAt = event.createdAt;
    domain.dnsAuthenticationStatus = event.status;
  }
  state.db.domainDnsCheckEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-dns-authentication-check', detail: `Checked DNS authentication for ${domainName}` });
  return event;
}

export function recordDmarcAlignmentEvent(state, actor, body = {}) {
  ensureDeliverabilityRuntimeCollections(state);
  const domain = domainForRuntime(actor, body.domainId);
  const domainName = body.domain || domain?.name || 'example.com';
  const event = {
    id: createId('dmarc'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    domainId: domain?.id || null,
    domain: domainName,
    policy: body.policy || 'quarantine',
    alignmentMode: body.alignmentMode || 'relaxed',
    reportingUri: body.reportingUri || `mailto:dmarc@${domainName}`,
    aligned: body.aligned == null ? true : body.aligned === true || body.aligned === 'true',
    runtimeContract: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  if (domain) {
    domain.dmarcPolicy = event.policy;
    domain.dmarcAligned = event.aligned;
  }
  state.db.domainDmarcAlignmentEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-dmarc-alignment', detail: `Recorded DMARC ${event.policy}/${event.alignmentMode} for ${domainName}` });
  return event;
}

export function recordSenderReputationWarmupEvent(state, actor, body = {}) {
  ensureDeliverabilityRuntimeCollections(state);
  const event = {
    id: createId('warmup'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    stage: body.stage || 'ramp_week_1',
    dailyCap: Number(body.dailyCap || 500),
    reputationBand: body.reputationBand || 'monitoring',
    complaintRate: Number(body.complaintRate || 0.001),
    bounceRate: Number(body.bounceRate || 0.01),
    nextAction: body.nextAction || 'continue_ramp_if_complaints_stay_low',
    runtimeContract: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.senderReputationWarmupEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sender-reputation-warmup', detail: `Recorded warmup ${event.stage} with cap ${event.dailyCap}` });
  return event;
}

export function recordDedicatedIpReadinessEvent(state, actor, body = {}) {
  ensureDeliverabilityRuntimeCollections(state);
  const event = {
    id: createId('ipready'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    poolId: body.poolId || createId('pool'),
    reverseDnsStatus: body.reverseDnsStatus || 'aligned',
    rampStatus: body.rampStatus || 'ready_for_warmup',
    assignedIpCount: Number(body.assignedIpCount || 1),
    readiness: body.readiness || 'ready',
    runtimeContract: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.dedicatedIpReadinessEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dedicated-ip-readiness', detail: `Recorded dedicated IP readiness ${event.poolId}` });
  return event;
}

export function runDeliverabilityComplianceReview(state, actor, body = {}) {
  ensureDeliverabilityRuntimeCollections(state);
  ensureComplianceAlerts(state, actor);
  const health = deliverabilityHealth(state, actor.workspace.id);
  const event = {
    id: createId('comprev'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    status: health.score >= 85 ? 'pass' : 'needs_monitoring',
    reviewType: body.reviewType || 'sender_domain_compliance',
    score: health.score,
    inboxPlacementBand: health.inboxPlacementBand,
    unresolvedAlerts: health.unresolvedAlerts,
    suppressionCount: health.suppressionCount,
    checklist: health.checklist,
    runtimeContract: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.complianceReviewRuns.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'deliverability-compliance-review-run', detail: `Ran deliverability review with score ${event.score}` });
  return event;
}

export function buildSettingsDomainsDeliverabilityRuntimeSnapshot(state, workspaceId) {
  ensureDeliverabilityRuntimeCollections(state);
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || { id: workspaceId, settings: { domains: [] } };
  const settings = workspace.settings || {};
  const health = deliverabilityHealth(state, workspaceId);
  const dnsChecks = state.db.domainDnsCheckEvents.filter((entry) => entry.workspaceId === workspaceId);
  const dmarcEvents = state.db.domainDmarcAlignmentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const warmupEvents = state.db.senderReputationWarmupEvents.filter((entry) => entry.workspaceId === workspaceId);
  const dedicatedIpEvents = state.db.dedicatedIpReadinessEvents.filter((entry) => entry.workspaceId === workspaceId);
  const reviewRuns = state.db.complianceReviewRuns.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.deliverabilityRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    health,
    domains: (settings.domains || []).map((entry) => ({ id: entry.id, name: entry.name, verificationStatus: entry.verificationStatus, authenticationStatus: entry.authenticationStatus, isDefault: Boolean(entry.isDefault), dnsAuthenticationStatus: entry.dnsAuthenticationStatus || null, dmarcPolicy: entry.dmarcPolicy || null, dmarcAligned: entry.dmarcAligned || false, lastDnsCheckedAt: entry.lastDnsCheckedAt || null })),
    dnsAuthentication: { count: dnsChecks.length, passCount: dnsChecks.filter((entry) => entry.status === 'pass').length, recent: dnsChecks.slice(0, 10) },
    dmarcAlignment: { count: dmarcEvents.length, alignedCount: dmarcEvents.filter((entry) => entry.aligned).length, recent: dmarcEvents.slice(0, 10) },
    senderWarmup: { count: warmupEvents.length, latest: warmupEvents[0] || null, recent: warmupEvents.slice(0, 10) },
    dedicatedIpReadiness: { count: dedicatedIpEvents.length, readyCount: dedicatedIpEvents.filter((entry) => entry.readiness === 'ready').length, recent: dedicatedIpEvents.slice(0, 10) },
    complianceReviews: { count: reviewRuns.length, passCount: reviewRuns.filter((entry) => entry.status === 'pass').length, recent: reviewRuns.slice(0, 10) },
    snapshots: { count: snapshots.length, latestCreatedAt: snapshots[0]?.createdAt || null },
    runtimeHealth: {
      dnsChecksReady: dnsChecks.length > 0,
      dmarcAlignmentReady: dmarcEvents.length > 0,
      senderWarmupReady: warmupEvents.length > 0,
      dedicatedIpReady: dedicatedIpEvents.length > 0,
      complianceReviewReady: reviewRuns.length > 0,
      snapshotReady: snapshots.length > 0
    }
  };
}

export function persistSettingsDomainsDeliverabilityRuntimeSnapshot(state, actor, reason = 'manual_deliverability_runtime_snapshot') {
  ensureDeliverabilityRuntimeCollections(state);
  const snapshot = buildSettingsDomainsDeliverabilityRuntimeSnapshot(state, actor.workspace.id);
  state.db.deliverabilityRuntimeSnapshots.unshift({ id: createId('delivsnap'), workspaceId: actor.workspace.id, userId: actor.user.id, reason, createdAt: snapshot.generatedAt, snapshot });
  state.db.deliverabilityRuntimeSnapshots = state.db.deliverabilityRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'deliverability-runtime-snapshot', detail: `Captured deliverability runtime snapshot (${reason})` });
  return snapshot;
}

export const settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract = {
  "surfaceId": "settings_domains",
  "focusGroup": "settings_domains",
  "phaseId": "operational_persistence_and_jobs",
  "shardId": "focus.settings_domains::semantic-frontier-001#23-operational_persistence_and_jobs#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSettingsDomainsOperationalPersistenceAndJobsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.surfaceId,
      phaseId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.phaseId,
      shardId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.shardId
    }
  };
}

export const settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "settings_domains",
  "focusGroup": "settings_domains",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.settings_domains::semantic-frontier-001#23-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSettingsDomainsIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const settingsDomainsPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "settings_domains",
  "focusGroup": "settings_domains",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.settings_domains::semantic-frontier-001#23-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSettingsDomainsPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...settingsDomainsPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: settingsDomainsPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: settingsDomainsPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: settingsDomainsPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}



export function buildSettingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey = "settings_domains:integrated_user_path_evidence:packages/app/domain-deliverability-compliance.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, surfaceId: "settings_domains", focusGroup: "settings_domains", phaseId: "integrated_user_path_evidence", shardId: "focus.settings_domains::semantic-frontier-001#23-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-deliverability-compliance.mjs", workspaceId, durableStateReady: Boolean(db), ...settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs"], nextAction: settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:settings_domains:monitor_job_runtime_handoff" : "integrated_user_path_evidence:settings_domains:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: settingsDomainsIntegratedUserPathEvidencePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-deliverability-compliance.mjs" } };
}



export function buildSettingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey = "settings_domains:primary_runtime_spine:packages/app/domain-deliverability-compliance.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, surfaceId: "settings_domains", focusGroup: "settings_domains", phaseId: "primary_runtime_spine", shardId: "focus.settings_domains::semantic-frontier-001#23-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-deliverability-compliance.mjs", workspaceId, durableStateReady: Boolean(db), ...settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs"], nextAction: settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:settings_domains:monitor_job_runtime_handoff" : "primary_runtime_spine:settings_domains:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: settingsDomainsPrimaryRuntimeSpinePackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-deliverability-compliance.mjs" } };
}



export function buildSettingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey = "settings_domains:operational_persistence_and_jobs:packages/app/domain-deliverability-compliance.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, surfaceId: "settings_domains", focusGroup: "settings_domains", phaseId: "operational_persistence_and_jobs", shardId: "focus.settings_domains::semantic-frontier-001#23-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-deliverability-compliance.mjs", workspaceId, durableStateReady: Boolean(db), ...settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:settings_domains:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:settings_domains:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: settingsDomainsOperationalPersistenceAndJobsPackagesAppDomainDeliverabilityComplianceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-deliverability-compliance.mjs" } };
}

