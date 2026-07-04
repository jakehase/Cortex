import { compileMailchimpAdapterHandoff } from './adapter-handoff.mjs';
import {
  buildMailchimpStatusDecisionPersistenceEnvelope,
  buildMailchimpStatusPersistedResumeTicket,
  buildMailchimpStatusSnapshot,
  summarizeMailchimpStatus,
} from './status-handoff.mjs';

const RECOVERABLE_CODES = new Map([
  ['mailchimp.rate_limited', 'retry_after_backoff'],
  ['mailchimp.timeout', 'retry_same_idempotency_key'],
  ['mailchimp.status.missing_verifier_evidence', 'collect_verifier_evidence'],
  ['mailchimp.status.provider_missing_capability', 'refresh_provider_contract'],
  ['mailchimp.status.provider_continuity_hold', 'hold_for_provider_recovery'],
  ['mailchimp.status.provider_continuity_retry', 'refresh_provider_contract'],
  ['mailchimp.status.provider_lease_not_ready', 'refresh_provider_lease'],
  ['mailchimp.status.provider_receipt_not_acknowledged', 'refresh_provider_receipt'],
  ['mailchimp.status.compile_cache_stale', 'refresh_compile_cache'],
  ['mailchimp.status.compile_cache_provider_sync_not_restart_safe', 'refresh_provider_sync_before_replay'],
  ['mailchimp.status.client_command_blocked', 'inspect_client_command'],
  ['mailchimp.permission.tenant_mismatch', 'repair_tenant_permissions'],
  ['mailchimp.permission.workspace_mismatch', 'repair_tenant_permissions'],
  ['mailchimp.permission.workspace_out_of_scope', 'repair_tenant_permissions'],
  ['mailchimp.permission.permission_scope_mismatch', 'repair_tenant_permissions'],
  ['mailchimp.permission.missing_grant', 'repair_tenant_permissions'],
  ['mailchimp.permission.denied_grant', 'repair_tenant_permissions'],
  ['mailchimp.permission.runtime_workspace_drift', 'switch_workspace_or_recompile'],
  ['mailchimp.status.tenant_boundary_audit_not_ready', 'append_tenant_boundary_audit'],
  ['mailchimp.status.tenant_boundary_audit.audit_append_not_persisted', 'append_tenant_boundary_audit'],
  ['mailchimp.status.tenant_boundary_audit.runtime_workspace_mismatch', 'switch_workspace_or_recompile'],
  ['mailchimp.status.tenant_boundary_audit.runtime_tenant_mismatch', 'repair_tenant_permissions'],
  ['mailchimp.handoff.truth_boundary_blocks_write', 'downgrade_to_dry_run'],
  ['mailchimp.handoff.missing_idempotency', 'attach_idempotency_key'],
]);

const RECOVERY_COMMANDS = new Set([
  'observe',
  'collect_verifier_evidence',
  'attach_idempotency_key',
  'downgrade_to_dry_run',
  'repair_descriptor_before_dispatch',
  'retry_after_backoff',
  'retry_same_idempotency_key',
  'refresh_provider_contract',
  'hold_for_provider_recovery',
  'refresh_provider_lease',
  'refresh_provider_receipt',
  'refresh_provider_sync_before_replay',
  'inspect_client_command',
  'refresh_compile_cache',
  'repair_tenant_permissions',
  'append_tenant_boundary_audit',
  'switch_workspace_or_recompile',
  'relink_external_handoff',
  'hold_for_operator',
  'resume_after_descriptor_repair',
]);

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map((diagnostic, index) => ({
    index,
    code: compactString(diagnostic.code || 'mailchimp.recovery.unknown'),
    severity: compactString(diagnostic.severity || 'warning'),
    field: compactString(diagnostic.field),
    message: compactString(diagnostic.message),
  }));
}

function normalizeRecoverySettings(settings = {}) {
  const maxAttempts = Number.isFinite(Number(settings.maxAttempts))
    ? Math.max(1, Math.floor(Number(settings.maxAttempts)))
    : 3;
  const backoffSeconds = Number.isFinite(Number(settings.backoffSeconds))
    ? Math.max(0, Math.floor(Number(settings.backoffSeconds)))
    : 60;
  const enabled = settings.enabled !== false;
  const scheduleAt = compactString(settings.scheduleAt || settings.nextRunAt);
  const command = compactString(settings.command || settings.nextCommand);

  return {
    enabled,
    command,
    maxAttempts,
    backoffSeconds,
    scheduleAt,
    requireVerifierBeforeResume: settings.requireVerifierBeforeResume !== false,
    operatorApprovalRequired: settings.operatorApprovalRequired === true,
  };
}

function validateRecoverySettings(settings, recovery) {
  const diagnostics = [];
  if (settings.command && !RECOVERY_COMMANDS.has(settings.command)) {
    diagnostics.push({
      code: 'mailchimp.recovery.unsupported_command',
      severity: 'error',
      field: 'settings.command',
      message: `Unsupported Mailchimp recovery command "${settings.command}".`,
    });
  }
  if (!settings.enabled && recovery.recoverable) {
    diagnostics.push({
      code: 'mailchimp.recovery.disabled',
      severity: 'warning',
      field: 'settings.enabled',
      message: 'Recovery controls are disabled for a recoverable Mailchimp handoff.',
    });
  }
  if (recovery.status.state === 'waiting_for_verifier' && !settings.requireVerifierBeforeResume) {
    diagnostics.push({
      code: 'mailchimp.recovery.verifier_resume_guard_disabled',
      severity: 'warning',
      field: 'settings.requireVerifierBeforeResume',
      message: 'Verifier-gated Mailchimp recovery should require evidence before resume.',
    });
  }
  return diagnostics;
}

function buildLifecycleState(recovery, settings, steps) {
  const nextStep = steps.find((step) => !step.requiresOperator) || steps[0];
  const readiness = recovery.status.readiness || {};
  const descriptorLifecycle = recovery.status.lifecycle || {};
  const blocked = settings.enabled === false
    || recovery.requiresRollback
    || steps.some((step) => step.requiresOperator)
    || readiness.ready === false
    || descriptorLifecycle.controls?.operatorHold === true;
  const nextAction = blocked
    ? recovery.requiresRollback
      ? 'prepare_rollback_then_hold'
      : descriptorLifecycle.controls?.operatorHold === true
        ? 'await_lifecycle_release'
        : readiness.nextStep || 'await_operator'
    : settings.command || readiness.nextStep || descriptorLifecycle.nextAction || nextStep?.action || 'observe';

  return {
    enabled: settings.enabled,
    command: settings.command || nextAction,
    nextAction,
    blocked,
    readiness: {
      ready: readiness.ready !== false,
      nextStep: readiness.nextStep || nextAction,
      validationSummary: readiness.validationSummary || null,
    },
    schedule: {
      mode: blocked ? 'manual' : 'automatic',
      nextRunAt: settings.scheduleAt || null,
      backoffSeconds: settings.backoffSeconds,
      maxAttempts: settings.maxAttempts,
    },
    controls: {
      canEnable: true,
      canDisable: recovery.status.terminal !== true,
      canResume: !blocked && recovery.status.state !== 'failed',
      canRetry: !blocked && recovery.recoverable,
      canRollback: recovery.requiresRollback,
      canReleaseLifecycleHold: descriptorLifecycle.controls?.operatorHold === true,
      canRefreshProvider: recovery.status.provider?.capabilitySatisfied === false
        || recovery.status.provider?.syncStale === true,
    },
  };
}

function buildProviderRecoveryContract(status) {
  const provider = status.provider || {};
  const providerServiceContract = status.providerServiceContract || {};
  const serviceContinuity = providerServiceContract.serviceContinuity
    || provider.providerContinuity
    || status.providerContinuity
    || {};
  const readiness = status.readiness || {};
  const externalHandoffState = providerServiceContract.externalHandoff?.state
    || provider.externalHandoffState
    || 'local_only';
  const externalRequestId = providerServiceContract.externalHandoff?.requestId || provider.externalRequestId || '';
  const capabilitySatisfied = providerServiceContract.capabilityNegotiation?.satisfied
    ?? (provider.capabilitySatisfied !== false);
  const syncStale = providerServiceContract.sync?.stale === true || provider.syncStale === true;
  const syncReady = providerServiceContract.sync?.ready ?? (provider.syncReady !== false);
  const leaseState = providerServiceContract.lease?.state || provider.leaseState || 'unknown';
  const receipt = providerServiceContract.externalHandoff?.receipt || provider.receipt || {};
  const receiptRequired = providerServiceContract.externalHandoff?.receiptRequired === true
    || provider.receiptRequired === true
    || receipt.required === true;
  const receiptAcknowledged = providerServiceContract.externalHandoff?.receiptAcknowledged === true
    || provider.receiptAcknowledged === true
    || receipt.acknowledged === true;
  const receiptBlockedReasons = stableList([
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_ack_missing'] : []),
  ]);
  const restartSafe = providerServiceContract.restartSafe ?? provider.restartSafe !== false;
  const providerBlocked = providerServiceContract.state === 'blocked';
  const serviceState = providerServiceContract.serviceState || provider.state || 'unknown';
  const leaseRefreshRequired = ['expired', 'missing_token'].includes(leaseState) || restartSafe === false;
  const relinkRequired = providerServiceContract.externalHandoff?.relinkRequired === true
    || (externalHandoffState !== 'local_only' && !externalRequestId);
  const refreshRequired = providerBlocked
    || capabilitySatisfied === false
    || serviceContinuity.holdExternalWrite === true
    || syncStale
    || syncReady === false
    || leaseRefreshRequired
    || receiptBlockedReasons.length > 0
    || relinkRequired;
  const contractNextAction = compactString(providerServiceContract.nextAction);

  return {
    providerState: serviceState,
    providerContractState: compactString(providerServiceContract.state || (refreshRequired ? 'degraded' : 'ready')),
    providerContinuity: {
      protocol: serviceContinuity.protocol || 'aios.recovery-provider-continuity.mailchimp.v1',
      continuityKey: compactString(serviceContinuity.continuityKey),
      mode: compactString(serviceContinuity.mode || 'unknown'),
      healthy: serviceContinuity.healthy === true,
      degraded: serviceContinuity.degraded === true,
      holdExternalWrite: serviceContinuity.holdExternalWrite === true,
      queueOnly: serviceContinuity.queueOnly === true,
      retryable: serviceContinuity.retry?.retryable === true,
      retryAfterMs: Number(serviceContinuity.retry?.retryAfterMs || 0),
      nextAction: compactString(serviceContinuity.nextAction),
      degradedReasons: stableList(serviceContinuity.degradedReasons),
      restartSemantics: serviceContinuity.restartSemantics || null,
    },
    externalHandoffState,
    externalRequestId,
    capabilitySatisfied,
    syncStale,
    syncReady,
    leaseState,
    receipt: {
      protocol: receipt.protocol || 'aios.status-provider-receipt.mailchimp.v1',
      state: compactString(receipt.state || (receiptAcknowledged ? 'acknowledged' : 'missing')),
      receiptId: compactString(receipt.receiptId),
      externalRequestId: compactString(receipt.externalRequestId || externalRequestId),
      acknowledged: receiptAcknowledged,
      acknowledgedAt: compactString(receipt.acknowledgedAt),
      required: receiptRequired,
      restartSafe: receipt.restartSafe !== false && receiptBlockedReasons.length === 0,
      blockedReasons: receiptBlockedReasons,
      audit: receipt.audit || null,
    },
    restartSafe,
    leaseRefreshRequired,
    relinkRequired,
    refreshRequired,
    blockedReasons: stableList([
      ...(Array.isArray(providerServiceContract.blockedReasons) ? providerServiceContract.blockedReasons : []),
      ...stableList(serviceContinuity.degradedReasons),
      ...(serviceContinuity.holdExternalWrite === true ? ['provider_continuity_hold_external_write'] : []),
      ...receiptBlockedReasons,
    ]),
    exportReady: providerServiceContract.exportSummary?.exportReady !== false,
    nextAction: refreshRequired
      ? contractNextAction
        || (serviceContinuity.holdExternalWrite === true
          ? serviceContinuity.nextAction || 'hold_for_provider_recovery'
          : serviceContinuity.retry?.retryable === true
            ? serviceContinuity.nextAction || 'refresh_provider_contract'
            : '')
        || (leaseRefreshRequired
        ? 'refresh_provider_lease'
        : relinkRequired
          ? 'relink_external_handoff'
          : receiptBlockedReasons.length > 0
            ? 'refresh_provider_receipt'
          : 'refresh_provider_contract')
      : readiness.ready === false
        ? readiness.nextStep || 'repair_status_readiness'
        : externalHandoffState === 'linked'
          ? 'resume_linked_handoff'
          : 'prepare_local_resume',
  };
}

function buildProviderReceiptReplayGuard(providerRecovery = {}, adapterDispatchReadiness = {}, status = {}) {
  const evidence = adapterDispatchReadiness.providerReceiptEvidence
    || status.providerReceiptEvidence
    || status.providerReceiptEvidenceHandoff
    || providerRecovery.receiptEvidence
    || {};
  const receipt = providerRecovery.receipt || evidence.receipt || {};
  const external = evidence.externalHandoff || {};
  const linked = providerRecovery.externalHandoffState !== 'local_only'
    || compactString(providerRecovery.externalRequestId).length > 0
    || external.linked === true
    || compactString(external.requestId).length > 0;
  const requestId = compactString(
    providerRecovery.externalRequestId
      || receipt.externalRequestId
      || external.requestId
      || evidence.externalRequestId,
  );
  const receiptRequired = receipt.required === true
    || external.receiptRequired === true
    || evidence.receipt?.required === true
    || (linked && providerRecovery.restartSafe === false);
  const receiptAcknowledged = receipt.acknowledged === true
    || evidence.receipt?.acknowledged === true
    || external.receiptAcknowledged === true;
  const evidenceMissing = stableList(evidence.missingEvidence);
  const blockedReasons = stableList([
    ...(linked && !requestId ? ['external_request_id_missing'] : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_ack_missing'] : []),
    ...(receipt.restartSafe === false ? ['provider_receipt_not_restart_safe'] : []),
    ...(providerRecovery.restartSafe === false ? ['provider_contract_not_restart_safe'] : []),
    ...(providerRecovery.syncReady === false ? ['provider_sync_not_ready'] : []),
    ...(providerRecovery.capabilitySatisfied === false ? ['provider_capability_missing'] : []),
    ...(providerRecovery.providerContinuity?.holdExternalWrite === true ? ['provider_continuity_hold_external_write'] : []),
    ...(evidence.ready === false ? ['provider_receipt_evidence_not_ready'] : []),
    ...evidenceMissing.map((item) => `provider_evidence:${item}`),
    ...stableList(receipt.blockedReasons).map((reason) => `provider_receipt:${reason}`),
  ]);
  const state = blockedReasons.length === 0
    ? linked ? 'ready_for_linked_replay' : 'local_only'
    : blockedReasons.includes('external_request_id_missing')
      ? 'waiting_for_external_handoff_link'
      : blockedReasons.includes('provider_receipt_ack_missing')
        ? 'waiting_for_provider_receipt'
        : blockedReasons.includes('provider_sync_not_ready')
          ? 'waiting_for_provider_sync'
          : blockedReasons.includes('provider_continuity_hold_external_write')
            ? 'provider_continuity_hold'
            : 'blocked';
  const nextAction = state === 'ready_for_linked_replay' || state === 'local_only'
    ? 'resume_after_provider_receipt'
    : state === 'waiting_for_external_handoff_link'
      ? 'relink_external_handoff'
      : state === 'waiting_for_provider_receipt'
        ? 'refresh_provider_receipt'
        : state === 'waiting_for_provider_sync'
          ? 'refresh_provider_contract'
          : state === 'provider_continuity_hold'
            ? providerRecovery.providerContinuity?.nextAction || 'hold_for_provider_recovery'
            : providerRecovery.nextAction || 'refresh_provider_contract';
  const guardKey = compactString(evidence.evidenceKey)
    || `mailchimp-recovery-provider-receipt:${[
      status.requestId || providerRecovery.externalRequestId || 'handoff',
      requestId || 'local',
      state,
    ].map(compactString).filter(Boolean).join(':')}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const replaySafe = blockedReasons.length === 0
    && receipt.restartSafe !== false
    && evidence.restartSafe !== false
    && providerRecovery.providerContinuity?.holdExternalWrite !== true;

  return {
    protocol: 'aios.recovery-provider-receipt-replay-guard.mailchimp.v1',
    guardKey,
    state,
    ready: blockedReasons.length === 0,
    linked,
    requestId,
    receiptRequired,
    receiptAcknowledged,
    replaySafe,
    restartSafe: replaySafe || state === 'local_only',
    nextAction,
    blockedReasons,
    receipt: {
      state: compactString(receipt.state || evidence.receipt?.state || 'missing'),
      receiptId: compactString(receipt.receiptId || evidence.receipt?.receiptId),
      acknowledged: receiptAcknowledged,
      acknowledgedAt: compactString(receipt.acknowledgedAt || evidence.receipt?.acknowledgedAt),
      restartSafe: receipt.restartSafe !== false,
      blockedReasons: stableList(receipt.blockedReasons),
    },
    evidence: {
      evidenceKey: compactString(evidence.evidenceKey),
      state: compactString(evidence.state || 'unknown'),
      ready: evidence.ready !== false && evidenceMissing.length === 0,
      missingEvidence: evidenceMissing,
      route: evidence.route || null,
    },
    route: {
      target: 'recovery-provider-receipt-replay-guard',
      idempotencyKey: guardKey,
      primaryAction: nextAction,
      requiredBodyKeys: receiptRequired ? ['requestId', 'receiptId'] : ['requestId'],
    },
    clientPatch: {
      recoveryProviderReceiptGuardState: state,
      recoveryProviderReceiptGuardReady: blockedReasons.length === 0,
      recoveryProviderReceiptGuardKey: guardKey,
      recoveryProviderReceiptGuardNextAction: nextAction,
      recoveryProviderReceiptGuardBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe,
      duplicateCommandPolicy: 'dedupe-by-recovery-provider-receipt-guard-key',
      resumeFromProviderReceiptGuardKey: guardKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpRecoveryPersistedResumeGuard(status = {}, runtime = {}) {
  const ticket = status.persistedResumeTicket?.protocol === 'aios.status-persisted-resume-ticket.mailchimp.v1'
    ? status.persistedResumeTicket
    : buildMailchimpStatusPersistedResumeTicket(status, runtime, status.persistedRecovery);
  const persistedRecovery = status.persistedRecovery || {};
  const blockedReasons = stableList([
    ...stableList(ticket.blockedReasons),
    ...(ticket.ready === false ? ['persisted_resume_ticket_not_ready'] : []),
    ...(ticket.restartSafe === false ? ['persisted_resume_ticket_not_restart_safe'] : []),
    ...(persistedRecovery.persisted === false && ticket.ready === true ? ['persisted_snapshot_missing_for_ticket'] : []),
  ]);
  const stale = ticket.state === 'stale_persisted_ticket'
    || blockedReasons.includes('persisted_resume_ticket_mismatch');
  const missingSnapshot = blockedReasons.includes('persisted_snapshot_missing_for_ticket')
    || blockedReasons.includes('persisted_recovery:persisted_status_missing');
  const ready = blockedReasons.length === 0 || (ticket.ready === true && !stale && !missingSnapshot);
  const nextAction = ready
    ? 'resume_status_handoff'
    : stale
      ? 'refresh_runtime_resume_ticket'
      : missingSnapshot
        ? 'persist_runtime_resume_ticket'
        : ticket.nextAction || persistedRecovery.nextAction || 'repair_runtime_resume_ticket';
  const guardKey = compactString(ticket.ticketKey)
    || `mailchimp-recovery-resume:${compactString(status.requestId || 'handoff')}:${compactString(ticket.statusRevision || 'revision')}`
      .replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.recovery-persisted-resume-guard.mailchimp.v1',
    guardKey,
    ticketKey: compactString(ticket.ticketKey),
    state: ready ? 'ready' : stale ? 'stale_ticket' : missingSnapshot ? 'needs_persistence' : 'blocked',
    ready,
    restartSafe: ready && ticket.restartSafe !== false,
    replaySafe: ready && ticket.replaySafe === true,
    nextAction,
    blockedReasons,
    ticket: {
      protocol: ticket.protocol || 'aios.status-persisted-resume-ticket.mailchimp.v1',
      state: compactString(ticket.state || 'unknown'),
      statusRevision: compactString(ticket.statusRevision),
      persistedTicketKey: compactString(ticket.persistedTicketKey),
      request: ticket.request || null,
      continuity: ticket.continuity || null,
    },
    route: {
      target: 'recovery-persisted-resume-guard',
      idempotencyKey: guardKey,
      primaryAction: nextAction,
      requiredBodyKeys: ready
        ? ['guardKey', 'ticketKey']
        : ['guardKey', 'ticketKey', 'blockedReasons'],
    },
    clientPatch: {
      recoveryPersistedResumeGuardKey: guardKey,
      recoveryPersistedResumeGuardState: ready ? 'ready' : 'blocked',
      recoveryPersistedResumeGuardReady: ready,
      recoveryPersistedResumeGuardNextAction: nextAction,
      recoveryPersistedResumeGuardBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-recovery-persisted-resume-guard-key',
      resumeFromPersistedResumeGuardKey: guardKey,
      externalWritesPerformed: false,
    },
  };
}

function buildCompileCacheRecoveryContract(status) {
  const compileCache = status.compileCache || {};
  const lifecycle = compileCache.lifecycle || status.compileCacheLifecycle || {};
  const report = compileCache.report || status.compileCacheReport || {};
  const exportPackage = compileCache.exportPackage
    || status.compileCacheExportPackage
    || {};
  const recoveryExportLane = compileCache.recoveryExportLane
    || report.recoveryExportLane
    || exportPackage.recoveryExportLane
    || status.compileCacheRecoveryExportLane
    || {};
  const counters = report.counters || {};
  const validation = compileCache.validationSummary || {};
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint || {};
  const boundaryCheckpoint = compileCache.boundaryCheckpoint || {};
  const boundaryAuditHandoff = normalizeCompileCacheBoundaryAuditHandoff(boundaryCheckpoint, {
    tenant: status.tenant,
    workspace: status.workspace,
  });
  const replayBarrier = compileCache.replayBarrier || {};
  const persistedReplay = compileCache.persistedReplaySummary
    || compileCache.persistedReplayState
    || {};
  const operationalHealth = compileCache.operationalHealth || {};
  const resumeGate = compileCache.resumeGate || status.compileCacheResumeGate || {};
  const resumeEvidenceHandoff = compileCache.resumeEvidenceHandoff
    || status.compileCacheResumeEvidenceHandoff
    || status.resumeEvidenceHandoff
    || {};
  const acceptanceChecklist = status.compileCacheAcceptanceChecklist
    || compileCache.acceptanceChecklist
    || compileCache.uiHandoff?.acceptanceChecklist
    || {};
  const lifecycleCommandCheckpoint = compileCache.lifecycleCommandCheckpoint
    || status.lifecycleCommandCheckpoint
    || status.clientCommandLifecycleCheckpoint
    || status.clientCommand?.lifecycleCommandCheckpoint
    || {};
  const lifecycleControlPlane = lifecycle.controlPlane
    || lifecycle.controlContract?.controlPlane
    || compileCache.lifecycleControlPlane
    || lifecycleCommandCheckpoint.controlPlane
    || {};
  const replayCommandBundle = compileCache.replayCommandBundle
    || compileCache.statusHandoff?.replayCommandBundle
    || status.compileCacheReplayCommandBundle
    || status.replayCommandBundle
    || {};
  const clientExportTimeline = compileCache.clientExportTimeline
    || compileCache.statusHandoff?.clientExportTimeline
    || status.compileCacheClientExportTimeline
    || status.clientExportTimeline
    || {};
  const clientResumePacket = compileCache.clientResumePacket
    || compileCache.statusHandoff?.clientResumePacket
    || status.compileCacheClientResumePacket
    || status.clientResumePacket
    || {};
  const stale = compileCache.stale === true;
  const replayed = compileCache.replayed === true;
  const cacheKey = compactString(compileCache.cacheKey);
  const statusValue = compactString(compileCache.status || (cacheKey ? 'compiled' : 'uncached'));
  const exportReady = compileCache.exportReady !== false && report.exportReady !== false;
  const lifecycleNextAction = compactString(lifecycle.nextAction);
  const lifecycleBlocked = lifecycle.blocked === true;
  const lifecycleRefreshRecommended = lifecycle.refreshRecommended === true;
  const providerSyncRestartSafe = providerSyncCheckpoint.restartSafe !== false;
  const providerSyncReplayPolicy = compactString(providerSyncCheckpoint.replayPolicy);
  const providerSyncRefreshRequired = providerSyncRestartSafe === false;
  const boundaryRestartSafe = boundaryCheckpoint.restartSafe !== false;
  const boundaryReplayAllowed = boundaryCheckpoint.replayAllowed !== false;
  const boundaryRepairRequired = boundaryCheckpoint.ready === false
    || boundaryRestartSafe === false
    || boundaryReplayAllowed === false
    || boundaryAuditHandoff.ready === false;
  const refreshRequired = stale
    || statusValue === 'uncached'
    || lifecycleNextAction === 'refresh_compile_cache';
  const barrierClosed = replayBarrier.open === false;
  const barrierBlockedReasons = stableList([
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(persistedReplay.blockedReasons) ? persistedReplay.blockedReasons : []),
  ]);
  const retryExhausted = replayBarrier.retry?.exhausted === true
    || persistedReplay.retry?.exhausted === true
    || operationalHealth.retry?.attempts >= operationalHealth.retry?.maxAttempts;
  const resumeGateBlocked = resumeGate.ready === false;
  const resumeGateRetryExhausted = resumeGate.retry?.exhausted === true;
  const resumeEvidenceBlocked = resumeEvidenceHandoff.ready === false;
  const resumeEvidenceMissing = stableList(resumeEvidenceHandoff.missingEvidence);
  const checklistBlocked = acceptanceChecklist.ready === false;
  const checklistAcceptanceRequired = acceptanceChecklist.acceptance?.required === true
    && acceptanceChecklist.acceptance?.accepted !== true;
  const lifecycleCommandState = compactString(lifecycleCommandCheckpoint.state || 'unobserved');
  const lifecycleCommandBlockedReasons = stableList(lifecycleCommandCheckpoint.blockedReasons);
  const lifecycleCommandRestartSafe = lifecycleCommandCheckpoint.restartSafe !== false;
  const lifecycleCommandHeld = lifecycleCommandState === 'held'
    || lifecycleCommandBlockedReasons.includes('lifecycle_operator_hold');
  const lifecycleCommandBlocked = lifecycleCommandState === 'blocked'
    || lifecycleCommandRestartSafe === false
    || lifecycleCommandHeld;
  const lifecycleControlPlaneBlockedReasons = stableList(lifecycleControlPlane.blockedReasons);
  const lifecycleControlPlaneDeferredReasons = stableList(lifecycleControlPlane.deferredReasons);
  const lifecycleControlPlaneState = compactString(lifecycleControlPlane.state || 'unknown');
  const lifecycleControlPlaneBlocked = lifecycleControlPlaneState === 'blocked'
    || lifecycleControlPlane.restartSemantics?.replaySafe === false
    || lifecycleControlPlaneBlockedReasons.length > 0;
  const lifecycleControlPlaneDeferred = lifecycleControlPlaneState === 'scheduled'
    || lifecycleControlPlane.routeState === 'deferred'
    || lifecycleControlPlaneDeferredReasons.length > 0;
  const clientResumeBlockedReasons = stableList(clientResumePacket.blockedReasons);
  const clientResumeReady = clientResumePacket.readyForClientRuntime === true;
  const clientResumeReplayReady = clientResumePacket.readyForRuntimeReplay === true;
  const clientResumeRetryExhausted = clientResumePacket.retry?.exhausted === true;
  const clientResumeRetryable = clientResumePacket.retry?.retryable === true;
  const replayBundleBlockedReasons = stableList(replayCommandBundle.blockedReasons);
  const replayBundleBlocked = replayCommandBundle.ready === false
    || replayCommandBundle.status === 'blocked'
    || (replayCommandBundle.counters?.blocked || 0) > 0;
  const replayBundleRestartSafe = replayCommandBundle.restartSemantics?.replaySafe !== false;
  const replayBundleNextAction = compactString(
    replayCommandBundle.nextAction
      || replayCommandBundle.recoveryCommand
      || replayCommandBundle.timeline?.latestCommand,
  );
  const clientExportTimelineRows = Array.isArray(clientExportTimeline.rows) ? clientExportTimeline.rows : [];
  const clientExportTimelineBlockedRows = clientExportTimelineRows.filter((row) => (
    row.ready === false || row.status === 'blocked' || row.routeState === 'needs_attention'
  ));
  const clientExportTimelineBlocked = clientExportTimeline.ready === false
    || clientExportTimeline.status === 'blocked'
    || (clientExportTimeline.counters?.blockedRows || 0) > 0
    || clientExportTimelineBlockedRows.length > 0;
  const clientExportTimelineReady = clientExportTimeline.ready === true
    && clientExportTimelineBlockedRows.length === 0;
  const clientExportTimelineNextAction = compactString(
    clientExportTimeline.nextAction
      || clientExportTimeline.route?.primaryAction
      || clientExportTimelineBlockedRows[0]?.nextAction,
  );
  const persistedRestartSafe = persistedReplay.restartSafe !== false;
  const persistedReplaySafe = persistedReplay.replaySafe === true;
  const persistedNextAction = compactString(
    persistedReplay.nextAction
      || persistedReplay.command?.nextAction
      || persistedReplay.recovery?.command,
  );
  const reportReviewRequired = !refreshRequired && (!exportReady || lifecycleNextAction === 'review_compile_cache_export');
  const exportPackageReviewRequired = !refreshRequired
    && exportPackage.exportReady === false
    && compactString(exportPackage.nextAction) !== 'refresh_compile_cache';
  const recoveryLaneBlocked = recoveryExportLane.exportReady === false
    || (recoveryExportLane.counters?.blockedRows || 0) > 0;
  const recoveryLaneNextAction = compactString(recoveryExportLane.nextAction);
  const controlsRequired = lifecycleBlocked && [
    'enable_compile_cache_lifecycle',
    'await_compile_cache_operator_release',
    'repair_compile_cache_lifecycle_settings',
  ].includes(lifecycleNextAction);

  return {
    cacheKey,
    status: statusValue,
    replayed,
    stale,
    exportReady,
    sourceHash: compactString(compileCache.sourceHash),
    optionsHash: compactString(compileCache.optionsHash),
    contractHash: compactString(compileCache.contractHash),
    refreshRequired,
    reportReviewRequired,
    exportPackageReviewRequired,
    recoveryLaneBlocked,
    controlsRequired,
    lifecycleBlocked,
    lifecycleRefreshRecommended,
    providerSyncRefreshRequired,
    boundaryRepairRequired,
    boundaryRestartSafe,
    boundaryReplayAllowed,
    persistedRestartSafe,
    persistedReplaySafe,
    barrierClosed,
    barrierBlockedReasons,
    retryExhausted,
    resumeGateBlocked,
    resumeGateRetryExhausted,
    resumeEvidenceBlocked,
    resumeEvidenceMissing,
    checklistBlocked,
    checklistAcceptanceRequired,
    lifecycleCommandBlocked,
    lifecycleCommandHeld,
    lifecycleCommandRestartSafe,
    lifecycleControlPlaneBlocked,
    lifecycleControlPlaneDeferred,
    clientResumeReady,
    clientResumeReplayReady,
    clientResumeRetryExhausted,
    clientResumeRetryable,
    replayBundleBlocked,
    replayBundleRestartSafe,
    clientExportTimelineBlocked,
    clientExportTimelineReady,
    replayBarrier: {
      protocol: replayBarrier.protocol || 'aios.compile-cache-replay-barrier.mailchimp.v1',
      open: replayBarrier.open === true,
      restartSafe: replayBarrier.restartSafe === true,
      canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor === true,
      nextAction: compactString(persistedNextAction || replayBarrier.nextAction || 'refresh_compile_cache'),
      recoveryCommand: compactString(
        persistedReplay.recovery?.command
          || persistedReplay.command?.nextAction
          || replayBarrier.recoveryCommand
          || replayBarrier.nextAction
          || 'refresh_compile_cache',
      ),
      blockedReasons: barrierBlockedReasons,
      retry: {
        attempts: Number(persistedReplay.retry?.attempts || replayBarrier.retry?.attempts || operationalHealth.retry?.attempts || 0),
        maxAttempts: Number(persistedReplay.retry?.maxAttempts || replayBarrier.retry?.maxAttempts || operationalHealth.retry?.maxAttempts || 1),
        retryAfterMs: Number(persistedReplay.retry?.retryAfterMs || replayBarrier.retry?.retryAfterMs || operationalHealth.retry?.retryAfterMs || 0),
        exhausted: retryExhausted,
      },
      acceptance: replayBarrier.acceptance || null,
    },
    persistedReplay: {
      protocol: persistedReplay.protocol || 'aios.compile-cache-persisted-replay-summary.mailchimp.v1',
      state: compactString(persistedReplay.state || 'unknown'),
      replaySafe: persistedReplaySafe,
      restartSafe: persistedRestartSafe,
      nextAction: compactString(persistedNextAction || replayBarrier.nextAction),
      idempotencyKey: compactString(persistedReplay.idempotencyKey || persistedReplay.command?.idempotencyKey),
      retryKey: compactString(persistedReplay.retryKey || persistedReplay.command?.retryKey),
      replayKey: compactString(persistedReplay.replayKey || persistedReplay.command?.replayKey),
      blockedReasons: barrierBlockedReasons,
      recovery: persistedReplay.recovery || null,
    },
    operationalHealth: {
      state: compactString(operationalHealth.state || (barrierClosed ? 'degraded' : 'healthy')),
      degraded: operationalHealth.degraded === true || barrierClosed || persistedRestartSafe === false,
      failureState: compactString(operationalHealth.failureState),
      retryable: operationalHealth.retryable !== false && !retryExhausted,
      nextAction: compactString(operationalHealth.nextAction || persistedNextAction || replayBarrier.nextAction),
      actionableErrors: Array.isArray(operationalHealth.actionableErrors) ? operationalHealth.actionableErrors : [],
    },
    resumeGate: {
      protocol: resumeGate.protocol || 'aios.compile-cache-resume-gate.mailchimp.v1',
      ready: resumeGate.ready === true,
      replaySafe: resumeGate.replaySafe === true,
      restartSafe: resumeGate.restartSafe === true,
      routeState: compactString(resumeGate.routeState || (resumeGate.ready === true ? 'ready' : 'needs_attention')),
      nextAction: compactString(resumeGate.nextAction || 'inspect_compile_cache_resume_gate'),
      recoveryCommand: compactString(resumeGate.recoveryCommand || resumeGate.nextAction || 'inspect_compile_cache_resume_gate'),
      failureState: compactString(resumeGate.failureState),
      blockedReasons: stableList(resumeGate.blockedReasons),
      acceptance: resumeGate.acceptance || null,
      retry: resumeGate.retry || null,
      preview: resumeGate.preview || null,
    },
    resumeEvidenceHandoff: {
      protocol: resumeEvidenceHandoff.protocol || 'aios.compile-cache-resume-evidence-handoff.mailchimp.v1',
      state: compactString(resumeEvidenceHandoff.state || (resumeEvidenceBlocked ? 'evidence_incomplete' : 'unknown')),
      ready: resumeEvidenceHandoff.ready === true,
      restartSafe: resumeEvidenceHandoff.restartSafe !== false,
      replaySafe: resumeEvidenceHandoff.replaySafe === true,
      nextAction: compactString(resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'),
      recoveryCommand: compactString(resumeEvidenceHandoff.recoveryCommand || resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'),
      missingEvidence: resumeEvidenceMissing,
      evidence: resumeEvidenceHandoff.evidence || null,
      route: resumeEvidenceHandoff.route || null,
      clientPatch: resumeEvidenceHandoff.clientPatch || null,
    },
    acceptanceChecklist: {
      protocol: acceptanceChecklist.protocol || 'aios.status-compile-cache-acceptance-checklist.mailchimp.v1',
      state: compactString(acceptanceChecklist.state || 'review'),
      ready: acceptanceChecklist.ready === true,
      nextAction: compactString(acceptanceChecklist.nextAction || acceptanceChecklist.route?.primaryAction || 'review_compile_cache_status'),
      counts: acceptanceChecklist.counts || {},
      acceptance: acceptanceChecklist.acceptance || null,
      blockingItems: Array.isArray(acceptanceChecklist.blockingItems)
        ? acceptanceChecklist.blockingItems
        : [],
      route: acceptanceChecklist.route || null,
    },
    lifecycleCommandCheckpoint: {
      protocol: lifecycleCommandCheckpoint.protocol || 'aios.compile-cache-lifecycle-command-checkpoint.mailchimp.v1',
      checkpointKey: compactString(lifecycleCommandCheckpoint.checkpointKey),
      observed: lifecycleCommandCheckpoint.observed === true,
      state: lifecycleCommandState,
      requestedCommand: compactString(lifecycleCommandCheckpoint.requestedCommand),
      submitAction: compactString(lifecycleCommandCheckpoint.submitAction),
      idempotencyKey: compactString(lifecycleCommandCheckpoint.idempotencyKey),
      commandId: compactString(lifecycleCommandCheckpoint.commandId),
      acknowledged: lifecycleCommandCheckpoint.acknowledged === true,
      restartSafe: lifecycleCommandRestartSafe,
      replaySafe: lifecycleCommandCheckpoint.replaySafe !== false && lifecycleCommandRestartSafe,
      externalWrite: lifecycleCommandCheckpoint.externalWrite === true,
      nextAction: compactString(
        lifecycleCommandCheckpoint.nextAction
          || (lifecycleCommandHeld ? 'await_lifecycle_release' : 'repair_compile_cache_lifecycle_settings'),
      ),
      blockedReasons: lifecycleCommandBlockedReasons,
      controls: lifecycleCommandCheckpoint.controls || null,
      schedule: lifecycleCommandCheckpoint.schedule || null,
      clientPatch: lifecycleCommandCheckpoint.clientPatch || null,
      restartSemantics: lifecycleCommandCheckpoint.restartSemantics || null,
    },
    lifecycleControlPlane: {
      protocol: lifecycleControlPlane.protocol || 'aios.compile-cache-lifecycle-control-plane.mailchimp.v1',
      controlKey: compactString(lifecycleControlPlane.controlKey),
      state: lifecycleControlPlaneState,
      routeState: compactString(lifecycleControlPlane.routeState || 'unknown'),
      readyForRuntimeReuse: lifecycleControlPlane.readyForRuntimeReuse !== false && lifecycleControlPlaneBlocked !== true,
      readyForMutation: lifecycleControlPlane.readyForMutation === true,
      commandAccepted: lifecycleControlPlane.commandAccepted !== false && lifecycleControlPlaneBlocked !== true,
      requestedCommand: compactString(lifecycleControlPlane.requestedCommand || lifecycle.command),
      candidateCommand: compactString(lifecycleControlPlane.candidateCommand || lifecycle.command),
      primaryAction: compactString(lifecycleControlPlane.primaryAction || lifecycleControlPlane.nextAction || lifecycleNextAction),
      nextAction: compactString(lifecycleControlPlane.nextAction || lifecycleNextAction || 'observe'),
      schedule: lifecycleControlPlane.schedule || null,
      controls: lifecycleControlPlane.controls || null,
      mutations: lifecycleControlPlane.mutations || null,
      diagnostics: lifecycleControlPlane.diagnostics || null,
      blockedReasons: lifecycleControlPlaneBlockedReasons,
      deferredReasons: lifecycleControlPlaneDeferredReasons,
      clientPatch: lifecycleControlPlane.clientPatch || null,
      restartSemantics: lifecycleControlPlane.restartSemantics || {
        replaySafe: lifecycleControlPlaneBlocked !== true,
        duplicateCommandPolicy: 'dedupe-by-compile-cache-lifecycle-control-key',
        resumeFromLifecycleControlKey: compactString(lifecycleControlPlane.controlKey),
        externalWritesPerformed: false,
      },
    },
    clientResumePacket: {
      protocol: clientResumePacket.protocol || 'aios.compile-cache-client-resume-packet.mailchimp.v1',
      packetId: compactString(clientResumePacket.packetId),
      state: compactString(clientResumePacket.state || (clientResumeReady ? 'ready_to_resume' : 'unknown')),
      readyForClientRuntime: clientResumeReady,
      readyForRuntimeReplay: clientResumeReplayReady,
      nextAction: compactString(clientResumePacket.nextAction || 'review_compile_cache_status'),
      resumeToken: compactString(clientResumePacket.resumeToken),
      statusRevision: compactString(clientResumePacket.statusRevision),
      retry: {
        retryable: clientResumeRetryable,
        retryAfterMs: Number(clientResumePacket.retry?.retryAfterMs || 0),
        maxAttempts: Number(clientResumePacket.retry?.maxAttempts || 0),
        nextAction: compactString(clientResumePacket.retry?.nextAction || clientResumePacket.nextAction),
        exhausted: clientResumeRetryExhausted,
      },
      acceptance: clientResumePacket.acceptance || null,
      evidence: clientResumePacket.evidence || null,
      counters: {
        blockedReasons: Number(clientResumePacket.counters?.blockedReasons || clientResumeBlockedReasons.length),
        missingEvidence: Number(clientResumePacket.counters?.missingEvidence || 0),
        decisionActions: Number(clientResumePacket.counters?.decisionActions || 0),
        decisionBlockingRows: Number(clientResumePacket.counters?.decisionBlockingRows || 0),
        recoveryLaneRows: Number(clientResumePacket.counters?.recoveryLaneRows || 0),
        recoveryLaneBlockedRows: Number(clientResumePacket.counters?.recoveryLaneBlockedRows || 0),
      },
      blockedReasons: clientResumeBlockedReasons,
      route: clientResumePacket.route || null,
      exportRow: clientResumePacket.exportRow || null,
      clientPatch: clientResumePacket.clientPatch || null,
      restartSemantics: clientResumePacket.restartSemantics || null,
    },
    replayCommandBundle: {
      protocol: replayCommandBundle.protocol || 'aios.compile-cache-replay-command-bundle.mailchimp.v1',
      bundleKey: compactString(replayCommandBundle.bundleKey),
      status: compactString(replayCommandBundle.status || (replayBundleBlocked ? 'blocked' : 'unknown')),
      ready: replayCommandBundle.ready === true,
      nextAction: replayBundleNextAction || 'review_compile_cache_status',
      recoveryCommand: compactString(replayCommandBundle.recoveryCommand || replayBundleNextAction || 'observe'),
      nextCommandId: compactString(replayCommandBundle.nextCommandId),
      idempotencyKey: compactString(replayCommandBundle.idempotencyKey || replayCommandBundle.bundleKey),
      counters: {
        commands: Number(replayCommandBundle.counters?.commands || replayCommandBundle.rows?.length || 0),
        ready: Number(replayCommandBundle.counters?.ready || 0),
        waiting: Number(replayCommandBundle.counters?.waiting || 0),
        blocked: Number(replayCommandBundle.counters?.blocked || 0),
        retryable: Number(replayCommandBundle.counters?.retryable || 0),
      },
      blockedReasons: replayBundleBlockedReasons,
      timeline: replayCommandBundle.timeline || null,
      exportSummary: replayCommandBundle.exportSummary || null,
      clientPatch: replayCommandBundle.clientPatch || null,
      restartSemantics: replayCommandBundle.restartSemantics || null,
      rows: Array.isArray(replayCommandBundle.rows)
        ? replayCommandBundle.rows.map((row) => ({
          rowId: compactString(row.rowId),
          commandId: compactString(row.commandId),
          command: compactString(row.command || row.action || row.nextAction),
          owner: compactString(row.owner || 'runtime'),
          phase: compactString(row.phase || 'recovery'),
          status: compactString(row.status || 'waiting'),
          reason: compactString(row.reason),
          restartSafe: row.restartSafe !== false,
          replaySafe: row.replaySafe === true,
          idempotencyKey: compactString(row.idempotencyKey),
          resumeToken: compactString(row.resumeToken),
          blockedReasons: stableList(row.blockedReasons),
        }))
        : [],
    },
    clientExportTimeline: {
      protocol: clientExportTimeline.protocol || 'aios.compile-cache-client-export-timeline.mailchimp.v1',
      timelineKey: compactString(clientExportTimeline.timelineKey),
      status: compactString(clientExportTimeline.status || (clientExportTimelineBlocked ? 'blocked' : 'unknown')),
      ready: clientExportTimelineReady,
      readyForClient: clientExportTimeline.readyForClient === true,
      readyForRuntimeReplay: clientExportTimeline.readyForRuntimeReplay === true,
      nextAction: clientExportTimelineNextAction || 'review_compile_cache_client_export_timeline',
      nextRowId: compactString(clientExportTimeline.nextRowId || clientExportTimelineBlockedRows[0]?.rowId),
      counters: {
        rows: Number(clientExportTimeline.counters?.rows || clientExportTimelineRows.length),
        readyRows: Number(clientExportTimeline.counters?.readyRows || clientExportTimelineRows.filter((row) => row.ready === true).length),
        blockedRows: Number(clientExportTimeline.counters?.blockedRows || clientExportTimelineBlockedRows.length),
        waitingRows: Number(clientExportTimeline.counters?.waitingRows || clientExportTimelineRows.filter((row) => row.status === 'waiting').length),
        exportPackageRows: Number(clientExportTimeline.counters?.exportPackageRows || 0),
        recoveryRows: Number(clientExportTimeline.counters?.recoveryRows || 0),
        replayCommandRows: Number(clientExportTimeline.counters?.replayCommandRows || 0),
      },
      route: clientExportTimeline.route || null,
      exportSummary: clientExportTimeline.exportSummary || null,
      clientPatch: clientExportTimeline.clientPatch || null,
      restartSemantics: clientExportTimeline.restartSemantics || null,
      blockedReasons: stableList([
        ...stableList(clientExportTimeline.blockedReasons),
        ...clientExportTimelineBlockedRows.flatMap((row) => stableList(row.blockedReasons)),
      ]),
      rows: clientExportTimelineRows.map((row) => ({
        rowId: compactString(row.rowId || row.id),
        phase: compactString(row.phase),
        source: compactString(row.source),
        status: compactString(row.status || (row.ready === false ? 'blocked' : 'ready')),
        ready: row.ready === true,
        required: row.required !== false,
        routeState: compactString(row.routeState || (row.ready === true ? 'ready' : 'needs_attention')),
        owner: compactString(row.owner || 'runtime'),
        nextAction: compactString(row.nextAction),
        idempotencyKey: compactString(row.idempotencyKey),
        resumeToken: compactString(row.resumeToken),
        blockedReasons: stableList(row.blockedReasons),
      })),
    },
    providerSyncCheckpoint: {
      protocol: providerSyncCheckpoint.protocol || 'aios.compile-cache-provider-sync.mailchimp.v1',
      provider: compactString(providerSyncCheckpoint.provider || 'mailchimp'),
      service: compactString(providerSyncCheckpoint.service || 'mailchimp-marketing'),
      state: compactString(providerSyncCheckpoint.state || 'stale'),
      restartSafe: providerSyncRestartSafe,
      replayPolicy: providerSyncReplayPolicy || 'refresh_provider_sync_before_replay',
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorPresent: Boolean(providerSyncCheckpoint.cursor),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      blockedReasons: Array.isArray(providerSyncCheckpoint.blockedReasons)
        ? providerSyncCheckpoint.blockedReasons.map(compactString).filter(Boolean).sort()
        : [],
    },
    boundaryCheckpoint: {
      protocol: boundaryCheckpoint.protocol || 'aios.compile-cache-boundary-checkpoint.mailchimp.v1',
      state: compactString(boundaryCheckpoint.state || 'unknown'),
      ready: boundaryCheckpoint.ready === true,
      restartSafe: boundaryRestartSafe,
      replayAllowed: boundaryReplayAllowed,
      nextAction: compactString(boundaryCheckpoint.nextAction || 'repair_tenant_permissions'),
      tenant: compactString(boundaryCheckpoint.tenant),
      workspace: compactString(boundaryCheckpoint.workspace),
      runtimeTenant: compactString(boundaryCheckpoint.runtimeTenant),
      runtimeWorkspace: compactString(boundaryCheckpoint.runtimeWorkspace),
      blockedReasons: Array.isArray(boundaryCheckpoint.blockedReasons)
        ? boundaryCheckpoint.blockedReasons.map(compactString).filter(Boolean).sort()
        : [],
      audit: boundaryCheckpoint.audit || null,
      auditHandoff: boundaryAuditHandoff,
      clientPatch: {
        ...(boundaryCheckpoint.clientPatch || {}),
        ...boundaryAuditHandoff.clientPatch,
      },
    },
    replaySafe: (persistedReplaySafe || Boolean(cacheKey))
      && !stale
      && providerSyncRestartSafe
      && boundaryRestartSafe
      && boundaryReplayAllowed
      && persistedRestartSafe
      && replayBundleRestartSafe
      && !replayBundleBlocked
      && !lifecycleControlPlaneBlocked
      && replayBarrier.open !== false
      && !retryExhausted,
    lifecycle: {
      protocol: lifecycle.protocol || 'aios.compile-cache-lifecycle.mailchimp.v1',
      enabled: lifecycle.enabled !== false,
      command: compactString(lifecycle.command || 'observe'),
      nextAction: lifecycleNextAction || null,
      blocked: lifecycleBlocked,
      refreshRecommended: lifecycleRefreshRecommended,
      exportReady: lifecycle.exportReady !== false,
      schedule: lifecycle.schedule || null,
      controls: lifecycle.controls || null,
      validationSummary: lifecycle.validationSummary || null,
      diagnostics: Array.isArray(lifecycle.diagnostics) ? lifecycle.diagnostics : [],
    },
    exportPackage: {
      protocol: exportPackage.protocol || 'aios.compile-cache-export-package.mailchimp.v1',
      packageId: compactString(exportPackage.packageId),
      exportReady: exportPackage.exportReady !== false,
      nextAction: compactString(exportPackage.nextAction || 'review_compile_cache_export'),
      blockedReasons: Array.isArray(exportPackage.blockedReasons)
        ? exportPackage.blockedReasons.map(compactString).filter(Boolean).sort()
        : [],
      counters: exportPackage.counters || {},
      timeline: exportPackage.timeline || null,
      acceptance: exportPackage.acceptance || null,
    },
    recoveryExportLane: {
      protocol: recoveryExportLane.protocol || 'aios.compile-cache-recovery-export-lane.mailchimp.v1',
      status: compactString(recoveryExportLane.status || (recoveryLaneBlocked ? 'needs_recovery' : 'export_ready')),
      exportReady: recoveryExportLane.exportReady !== false,
      nextAction: recoveryLaneNextAction || 'deliver_compile_cache_export',
      nextRowId: compactString(recoveryExportLane.nextRowId),
      blockedReasons: stableList(recoveryExportLane.blockedReasons),
      counters: {
        entries: Number(recoveryExportLane.counters?.entries || 0),
        rows: Number(recoveryExportLane.counters?.rows || 0),
        readyRows: Number(recoveryExportLane.counters?.readyRows || 0),
        waitingRows: Number(recoveryExportLane.counters?.waitingRows || 0),
        blockedRows: Number(recoveryExportLane.counters?.blockedRows || 0),
      },
      timeline: recoveryExportLane.timeline || null,
      rows: Array.isArray(recoveryExportLane.rows)
        ? recoveryExportLane.rows.map((row) => ({
          rowId: compactString(row.rowId),
          entryKey: compactString(row.entryKey),
          command: compactString(row.command || row.nextAction || 'observe'),
          owner: compactString(row.owner || 'runtime'),
          reason: compactString(row.reason),
          severity: compactString(row.severity || 'warning'),
          restartSafe: row.restartSafe === true,
          replaySafe: row.replaySafe === true,
          idempotencyKey: compactString(row.idempotencyKey),
          resumeToken: compactString(row.resumeToken),
        }))
        : [],
    },
    report: {
      protocol: report.protocol || 'aios.compile-cache-report.mailchimp.v1',
      blockedReasons: Array.isArray(report.blockedReasons)
        ? report.blockedReasons.map(compactString).filter(Boolean).sort()
        : Array.isArray(validation.blockedReasons)
          ? validation.blockedReasons.map(compactString).filter(Boolean).sort()
          : [],
      counters: {
        entries: Number(counters.entries || 0),
        staleEntries: Number(counters.staleEntries || 0),
        errorEntries: Number(counters.errorEntries || 0),
        lookupEvents: Number(counters.lookupEvents || 0),
        hitEvents: Number(counters.hitEvents || 0),
        missEvents: Number(counters.missEvents || 0),
        storeEvents: Number(counters.storeEvents || 0),
      },
      hitRate: report.ratios?.hitRate ?? null,
      latestAt: report.timeline?.latestAt ?? null,
      latestKind: compactString(report.timeline?.latestKind),
      latestStatus: compactString(report.timeline?.latestStatus),
    },
    nextAction: retryExhausted
      ? 'hold_for_operator'
      : checklistBlocked
      ? acceptanceChecklist.nextAction || acceptanceChecklist.route?.primaryAction || 'review_compile_cache_status'
      : resumeEvidenceBlocked
        ? resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'
      : clientResumePacket.readyForClientRuntime === false
        ? clientResumePacket.nextAction || 'review_compile_cache_status'
      : replayBundleBlocked
        ? replayBundleNextAction || 'review_compile_cache_replay_commands'
      : clientExportTimelineBlocked
        ? clientExportTimelineNextAction || 'review_compile_cache_client_export_timeline'
      : lifecycleCommandBlocked
        ? lifecycleCommandCheckpoint.nextAction
          || (lifecycleCommandHeld ? 'await_lifecycle_release' : 'repair_compile_cache_lifecycle_settings')
      : resumeGateBlocked
        ? resumeGate.nextAction || 'inspect_compile_cache_resume_gate'
      : persistedNextAction && persistedReplaySafe !== true
        ? persistedNextAction
      : barrierClosed && replayBarrier.nextAction
        ? replayBarrier.nextAction
        : controlsRequired
      ? lifecycleNextAction
      : refreshRequired
      ? 'refresh_compile_cache'
      : providerSyncRefreshRequired
        ? 'refresh_provider_sync_before_replay'
      : boundaryRepairRequired
        ? boundaryCheckpoint.nextAction || 'repair_tenant_permissions'
      : reportReviewRequired
        ? 'review_compile_cache_export'
        : exportPackageReviewRequired
          ? exportPackage.nextAction || 'review_compile_cache_export'
        : recoveryLaneBlocked
          ? recoveryLaneNextAction || 'review_compile_cache_export'
        : lifecycleNextAction && lifecycleNextAction !== 'reuse_compile_cache'
          ? lifecycleNextAction
      : replayed
        ? 'verify_cached_descriptor'
        : 'reuse_compiled_descriptor',
  };
}

function normalizeClientWorkflowHandoffReport(source = {}, fallback = {}) {
  const workflow = source.clientWorkflowHandoff && typeof source.clientWorkflowHandoff === 'object'
    ? source.clientWorkflowHandoff
    : source.workflowRepair && typeof source.workflowRepair === 'object'
      ? source.workflowRepair
      : source.adapterClientWorkflowHandoff && typeof source.adapterClientWorkflowHandoff === 'object'
        ? source.adapterClientWorkflowHandoff
        : {};
  const retry = workflow.retry && typeof workflow.retry === 'object' ? workflow.retry : {};
  const exportRow = workflow.exportRow && typeof workflow.exportRow === 'object' ? workflow.exportRow : {};
  const clientPatch = workflow.clientPatch && typeof workflow.clientPatch === 'object' ? workflow.clientPatch : {};
  const blockedReasons = stableList([
    ...(Array.isArray(workflow.blockedReasons) ? workflow.blockedReasons : []),
    ...(Array.isArray(workflow.provider?.blockedReasons) ? workflow.provider.blockedReasons.map((reason) => `provider:${reason}`) : []),
    ...(Array.isArray(workflow.boundary?.blockedReasons) ? workflow.boundary.blockedReasons.map((reason) => `boundary:${reason}`) : []),
  ]);
  const state = compactString(workflow.state || fallback.state || 'unknown');
  const nextAction = compactString(
    workflow.nextAction
      || workflow.primaryAction
      || workflow.recoveryCommand
      || fallback.nextAction
      || 'observe',
  );
  const resumeToken = compactString(
    workflow.resumeToken
      || workflow.restartSemantics?.resumeFromWorkflowToken
      || workflow.restartSemantics?.resumeFromRepairToken
      || fallback.resumeToken,
  );

  return {
    protocol: workflow.protocol || 'aios.recovery-client-workflow-handoff.mailchimp.v1',
    state,
    ready: workflow.ready === true,
    routeState: compactString(workflow.routeState || fallback.routeState || (workflow.ready ? 'ready' : 'needs_attention')),
    nextAction,
    resumeToken,
    statusRevision: compactString(workflow.statusRevision || fallback.statusRevision),
    operatorVisible: workflow.operatorVisible === true || clientPatch.adapterClientWorkflowOperatorVisible === true,
    retry: {
      retryable: retry.retryable === true,
      retryAfterMs: Number(retry.retryAfterMs || clientPatch.adapterClientWorkflowRetryAfterMs || 0),
      maxAttempts: Number(retry.maxAttempts || 0),
      nextAction: compactString(retry.nextAction || nextAction),
      exhausted: retry.exhausted === true,
    },
    command: workflow.command || null,
    acceptance: workflow.acceptance || null,
    provider: workflow.provider || null,
    boundary: workflow.boundary || null,
    blockedReasons,
    clientPatch,
    exportRow: {
      artifactName: exportRow.artifactName || 'client-workflow-handoff.json',
      rowId: compactString(exportRow.rowId || `${resumeToken || 'workflow'}:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, '_')),
      status: compactString(exportRow.status || state),
      nextAction: compactString(exportRow.nextAction || nextAction),
      readyForExport: exportRow.readyForExport !== false,
      blockedReasons: stableList(exportRow.blockedReasons || blockedReasons),
    },
    restartSemantics: workflow.restartSemantics || {
      replaySafe: workflow.ready === true || state === 'waiting_for_operator_acceptance',
      duplicateCommandPolicy: 'dedupe-by-client-workflow-handoff-token',
      resumeFromWorkflowToken: resumeToken,
      externalWritesPerformed: false,
    },
  };
}

function normalizeClientReadinessDecisionContract(source = {}, fallback = {}) {
  const decision = source.clientReadinessDecision && typeof source.clientReadinessDecision === 'object'
    ? source.clientReadinessDecision
    : source.metadata?.clientReadinessDecision && typeof source.metadata.clientReadinessDecision === 'object'
      ? source.metadata.clientReadinessDecision
      : source.compileCache?.clientReadinessDecision && typeof source.compileCache.clientReadinessDecision === 'object'
        ? source.compileCache.clientReadinessDecision
        : source.ui?.clientReadinessDecision && typeof source.ui.clientReadinessDecision === 'object'
          ? source.ui.clientReadinessDecision
          : {};
  const route = decision.route && typeof decision.route === 'object' ? decision.route : {};
  const restartSemantics = decision.restartSemantics && typeof decision.restartSemantics === 'object'
    ? decision.restartSemantics
    : {};
  const acceptance = decision.acceptance && typeof decision.acceptance === 'object' ? decision.acceptance : {};
  const validations = Array.isArray(decision.validations)
    ? decision.validations.map((row, index) => ({
      id: compactString(row.id || `client-readiness:${index + 1}`),
      label: compactString(row.label || row.id || `Client readiness ${index + 1}`),
      ready: row.ready === true,
      owner: compactString(row.owner || 'client'),
      nextAction: compactString(row.nextAction || decision.nextAction || fallback.nextAction || 'repair_client_readiness'),
      evidence: compactString(row.evidence),
    }))
    : [];
  const blockedRows = validations.filter((row) => row.ready !== true);
  const blockedReasons = stableList([
    ...(Array.isArray(decision.blockedReasons) ? decision.blockedReasons : []),
    ...blockedRows.map((row) => `validation:${row.id}`),
  ]);
  const accepted = acceptance.accepted === true || decision.accepted === true;
  const required = acceptance.required === true || decision.acceptanceRequired === true;
  const status = compactString(
    decision.status
      || (required && !accepted ? 'waiting-for-acceptance' : blockedReasons.length > 0 ? 'client-action-required' : 'ready'),
  );
  const decisionId = compactString(
    decision.decisionId
      || decision.id
      || route.idempotencyKey
      || [
        fallback.requestId || source.requestId || 'mailchimp:recovery',
        status,
        source.statusRevision || fallback.statusRevision || 'revision',
      ].map(compactString).filter(Boolean).join(':'),
  ).replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const nextRow = validations.find((row) => row.id === decision.nextValidationId)
    || blockedRows[0]
    || validations[0]
    || null;
  const nextAction = compactString(
    decision.nextAction
      || route.primaryAction
      || nextRow?.nextAction
      || fallback.nextAction
      || (required && !accepted ? 'request-preview-acceptance' : 'repair_client_readiness'),
  );

  return {
    protocol: decision.protocol || 'aios.recovery-client-readiness-decision.mailchimp.v1',
    decisionId,
    status,
    readyForPreview: decision.readyForPreview === true,
    readyForClient: decision.readyForClient === true && blockedReasons.length === 0,
    readyForRuntimeStart: decision.readyForRuntimeStart === true && blockedReasons.length === 0,
    nextAction,
    nextValidationId: compactString(decision.nextValidationId || nextRow?.id),
    blockedReasons,
    acceptance: {
      required,
      accepted,
      token: compactString(acceptance.token || acceptance.acceptanceToken || decision.acceptanceToken),
      reason: compactString(acceptance.reason || decision.acceptanceReason),
    },
    validationSummary: {
      total: Number(decision.validationSummary?.total || validations.length),
      ready: Number(decision.validationSummary?.ready || validations.filter((row) => row.ready).length),
      blocked: Number(decision.validationSummary?.blocked || blockedRows.length),
      runtimeBlocked: decision.validationSummary?.runtimeBlocked === true,
      clientBlocked: decision.validationSummary?.clientBlocked === true || blockedReasons.length > 0,
      errorCount: Number(decision.validationSummary?.errorCount || 0),
      warningCount: Number(decision.validationSummary?.warningCount || 0),
    },
    validations,
    route: {
      target: compactString(route.target || 'client-runtime-readiness'),
      method: compactString(route.method || 'POST'),
      path: compactString(route.path),
      idempotencyKey: compactString(route.idempotencyKey || `${decisionId}:route`),
      requiredBodyKeys: Array.isArray(route.requiredBodyKeys)
        ? route.requiredBodyKeys.map(compactString).filter(Boolean)
        : required && !accepted ? ['decisionId', 'acceptanceToken', 'accepted'] : ['decisionId', 'statusRevision'],
    },
    clientPatch: {
      ...(decision.clientPatch || {}),
      recoveryClientReadinessDecisionId: decisionId,
      recoveryClientReadinessStatus: status,
      recoveryClientReadinessReady: decision.readyForRuntimeStart === true && blockedReasons.length === 0,
      recoveryClientReadinessNextAction: nextAction,
      recoveryClientReadinessBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: restartSemantics.replaySafe === true || status === 'ready' || status === 'waiting-for-acceptance',
      duplicateCommandPolicy: compactString(
        restartSemantics.duplicateCommandPolicy || 'dedupe-by-recovery-client-readiness-decision-id',
      ),
      resumeFromDecisionId: compactString(
        restartSemantics.resumeFromDecisionId
          || restartSemantics.resumeFromReadinessDecisionId
          || decisionId,
      ),
      externalWritesPerformed: restartSemantics.externalWritesPerformed === true,
    },
  };
}

function normalizeCompileCacheBoundaryAuditHandoff(boundaryCheckpoint = {}, fallback = {}) {
  const source = boundaryCheckpoint.auditHandoff && typeof boundaryCheckpoint.auditHandoff === 'object'
    ? boundaryCheckpoint.auditHandoff
    : boundaryCheckpoint.boundaryAuditHandoff && typeof boundaryCheckpoint.boundaryAuditHandoff === 'object'
      ? boundaryCheckpoint.boundaryAuditHandoff
      : fallback.auditHandoff && typeof fallback.auditHandoff === 'object'
        ? fallback.auditHandoff
        : {};
  const route = source.route && typeof source.route === 'object' ? source.route : {};
  const restartSemantics = source.restartSemantics && typeof source.restartSemantics === 'object'
    ? source.restartSemantics
    : {};
  const rows = Array.isArray(source.rows)
    ? source.rows.map((row, index) => ({
      rowId: compactString(row.rowId || `boundary-audit:${index + 1}`),
      reason: compactString(row.reason || row.code || 'boundary_review'),
      category: compactString(row.category || 'boundary'),
      owner: compactString(row.owner || 'operator'),
      action: compactString(row.action || row.nextAction || source.nextAction || 'repair_tenant_permissions'),
      severity: compactString(row.severity || 'warning'),
      blocksReplay: row.blocksReplay === true,
      restartSafe: row.restartSafe !== false,
    }))
    : [];
  const blockedReasons = stableList([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(Array.isArray(boundaryCheckpoint.blockedReasons) ? boundaryCheckpoint.blockedReasons : []),
  ]);
  const blockedRows = rows.filter((row) => row.blocksReplay === true || row.severity === 'error');
  const nextRow = blockedRows[0] || rows.find((row) => row.severity === 'warning') || rows[0] || null;
  const state = compactString(source.state || (blockedReasons.length > 0 ? 'audit_blocked' : 'audit_ready'));
  const ready = source.ready === true
    || (state === 'audit_ready' && blockedReasons.length === 0 && blockedRows.length === 0);
  const auditRequired = source.auditRequired === true
    || source.requiresAuditAppend === true
    || boundaryCheckpoint.audit?.externalWriteSuppressed === true
    || blockedReasons.length > 0;
  const handoffKey = compactString(
    source.handoffKey
      || boundaryCheckpoint.audit?.handoffKey
      || fallback.handoffKey
      || [
        boundaryCheckpoint.tenant || fallback.tenant || 'unknown',
        boundaryCheckpoint.workspace || fallback.workspace || 'all',
        boundaryCheckpoint.state || state || 'boundary',
      ].map(compactString).filter(Boolean).join(':'),
  );
  const nextAction = ready
    ? auditRequired ? 'append_compile_cache_boundary_audit' : 'observe'
    : compactString(source.nextAction || source.primaryAction || nextRow?.action || boundaryCheckpoint.nextAction || 'repair_tenant_permissions');

  return {
    protocol: source.protocol || 'aios.recovery-compile-cache-boundary-audit.mailchimp.v1',
    handoffKey,
    state,
    ready,
    auditRequired,
    auditAppendReady: source.auditAppendReady === true || (ready && Boolean(handoffKey)),
    replayAllowed: source.replayAllowed === true || ready,
    restartSafe: source.restartSafe === true || (ready && restartSemantics.replaySafe !== false),
    decision: compactString(source.decision || (ready ? 'allow' : 'block')),
    owner: compactString(source.owner || nextRow?.owner || (ready ? 'runtime' : 'operator')),
    nextAction,
    blockedReasons,
    rows,
    counters: {
      rows: Number(source.counters?.rows || rows.length),
      blocked: Number(source.counters?.blocked || blockedRows.length),
      warnings: Number(source.counters?.warnings || rows.filter((row) => row.severity === 'warning').length),
      permissionRows: Number(source.counters?.permissionRows || rows.filter((row) => row.category === 'permission').length),
      isolationRows: Number(source.counters?.isolationRows || rows.filter((row) => row.category === 'isolation').length),
      restartUnsafe: Number(source.counters?.restartUnsafe || rows.filter((row) => row.restartSafe === false).length),
    },
    route: {
      target: compactString(route.target || 'compile-cache-boundary-audit'),
      idempotencyKey: compactString(route.idempotencyKey || handoffKey),
      primaryAction: compactString(route.primaryAction || nextAction),
      requiredBodyKeys: Array.isArray(route.requiredBodyKeys)
        ? route.requiredBodyKeys.map(compactString).filter(Boolean)
        : auditRequired ? ['handoffKey', 'decision', 'rows'] : ['handoffKey'],
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      recoveryBoundaryAuditState: state,
      recoveryBoundaryAuditReady: ready,
      recoveryBoundaryAuditNextAction: nextAction,
      recoveryBoundaryAuditHandoffKey: handoffKey,
    },
    restartSemantics: {
      replaySafe: restartSemantics.replaySafe === true || ready,
      duplicateCommandPolicy: compactString(
        restartSemantics.duplicateCommandPolicy || 'dedupe-by-recovery-boundary-audit-handoff',
      ),
      resumeFromBoundaryAuditKey: compactString(
        restartSemantics.resumeFromBoundaryAuditKey
          || restartSemantics.resumeFromBoundaryKey
          || handoffKey,
      ),
      externalWritesPerformed: restartSemantics.externalWritesPerformed === true,
    },
  };
}

function buildClientWorkflowRecoveryAnalytics(persistedState, steps) {
  const workflow = persistedState.clientWorkflowHandoff || {};
  const clientResume = persistedState.clientResumePacket || {};
  const clientExportTimeline = persistedState.clientExportTimeline || {};
  const stepActions = stableList(steps.map((step) => step.action));
  const clientResumeBlockedReasons = stableList(clientResume.blockedReasons);
  const clientExportTimelineRows = Array.isArray(clientExportTimeline.rows) ? clientExportTimeline.rows : [];
  const clientExportTimelineBlockedRows = clientExportTimelineRows.filter((row) => (
    row.ready === false || row.status === 'blocked'
  ));
  const blockedReasons = stableList([
    ...stableList(workflow.blockedReasons),
    ...clientResumeBlockedReasons.map((reason) => `client_resume:${reason}`),
    ...clientExportTimelineBlockedRows.flatMap((row) => (
      stableList(row.blockedReasons).map((reason) => `client_export_timeline:${row.rowId}:${reason}`)
    )),
  ]);
  const retryable = workflow.retry?.retryable === true;
  const clientResumeRetryable = clientResume.retry?.retryable === true;
  const row = workflow.exportRow || {};
  const clientResumeRow = clientResume.exportRow || {};
  const timelineRow = {
    id: row.rowId || `${persistedState.requestId || 'mailchimp:recovery'}:client-workflow`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
    phase: 'client-workflow-handoff',
    status: workflow.state || 'unknown',
    nextAction: workflow.nextAction || persistedState.resume?.command || 'observe',
    resumeToken: workflow.resumeToken || persistedState.idempotency?.nextCommandKey || null,
    retryAfterMs: workflow.retry?.retryAfterMs || 0,
    blockedReasons,
  };
  const resumeTimelineRow = {
    id: clientResumeRow.rowId
      || clientResume.packetId
      || `${persistedState.requestId || 'mailchimp:recovery'}:client-resume`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
    phase: 'client-runtime-resume',
    status: clientResume.state || 'unknown',
    nextAction: clientResume.nextAction || persistedState.resume?.command || 'observe',
    resumeToken: clientResume.resumeToken || persistedState.idempotency?.nextCommandKey || null,
    retryAfterMs: clientResume.retry?.retryAfterMs || 0,
    blockedReasons: clientResumeBlockedReasons,
  };
  const exportTimelineRow = {
    id: clientExportTimeline.nextRowId
      || clientExportTimeline.timelineKey
      || `${persistedState.requestId || 'mailchimp:recovery'}:client-export-timeline`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
    phase: 'client-export-timeline',
    status: clientExportTimeline.status || 'unknown',
    nextAction: clientExportTimeline.nextAction || persistedState.resume?.command || 'observe',
    resumeToken: clientExportTimeline.timelineKey || persistedState.idempotency?.nextCommandKey || null,
    retryAfterMs: 0,
    blockedReasons: clientExportTimelineBlockedRows.flatMap((timeline) => stableList(timeline.blockedReasons)),
  };
  const timelineRows = [timelineRow, resumeTimelineRow, exportTimelineRow];
  const exportReady = row.readyForExport !== false
    && clientResumeRow.readyForExport !== false
    && clientExportTimeline.ready !== false
    && clientExportTimelineBlockedRows.length === 0;
  const latestRow = timelineRows.find((item) => item.status !== 'ready' && item.status !== 'resume_ready')
    || timelineRows[timelineRows.length - 1];

  return {
    protocol: 'aios.recovery-client-workflow-analytics.mailchimp.v1',
    state: clientResume.state || workflow.state || 'unknown',
    ready: workflow.ready === true && clientResume.readyForClientRuntime !== false,
    exportReady,
    nextAction: clientResume.nextAction || workflow.nextAction || 'observe',
    counters: {
      blockedReasons: blockedReasons.length,
      clientResumeBlockedReasons: clientResumeBlockedReasons.length,
      retryable: [retryable, clientResumeRetryable].filter(Boolean).length,
      operatorVisible: workflow.operatorVisible === true ? 1 : 0,
      plannedStepMatches: stepActions.includes(workflow.nextAction) || stepActions.includes(clientResume.nextAction) ? 1 : 0,
      exportRows: timelineRows.length,
      clientResumeReady: clientResume.readyForClientRuntime === true ? 1 : 0,
      clientResumeReplayReady: clientResume.readyForRuntimeReplay === true ? 1 : 0,
      clientExportTimelineRows: clientExportTimelineRows.length,
      clientExportTimelineBlockedRows: clientExportTimelineBlockedRows.length,
      clientExportTimelineReady: clientExportTimeline.ready === true ? 1 : 0,
    },
    timeline: {
      latestRowId: latestRow.id,
      rowCount: timelineRows.length,
      rows: timelineRows,
    },
    exportSummary: {
      artifactName: clientResumeRow.artifactName || row.artifactName || 'client-runtime-recovery.json',
      ready: exportReady,
      rowId: latestRow.id,
      status: latestRow.status,
      nextAction: latestRow.nextAction,
      blockedReasons,
      artifacts: {
        workflow: row.artifactName || 'client-workflow-handoff.json',
        clientResume: clientResumeRow.artifactName || 'compile-cache-client-resume-packet.json',
        clientExportTimeline: clientExportTimeline.exportSummary?.artifactName || 'compile-cache-client-export-timeline.json',
      },
    },
  };
}

export function buildMailchimpRecoveryClientWorkflowReport(persistedState = {}, steps = []) {
  const analytics = persistedState.protocol === 'aios.recovery-client-workflow-analytics.mailchimp.v1'
    ? persistedState
    : buildClientWorkflowRecoveryAnalytics(persistedState, Array.isArray(steps) ? steps : []);
  const workflow = persistedState.clientWorkflowHandoff || {};
  const readiness = persistedState.clientReadinessDecision || {};
  const resume = persistedState.clientResumePacket || {};
  const dispatch = persistedState.adapterDispatchReadiness || {};
  const commandManifest = persistedState.commandManifest || {};
  const timelineRows = Array.isArray(analytics.timeline?.rows) ? analytics.timeline.rows : [];
  const commandRows = Array.isArray(commandManifest.rows) ? commandManifest.rows : [];
  const recoverySteps = Array.isArray(steps) ? steps : [];
  const blockedReasons = stableList([
    ...stableList(analytics.exportSummary?.blockedReasons),
    ...stableList(workflow.blockedReasons).map((reason) => `workflow:${reason}`),
    ...stableList(readiness.blockedReasons).map((reason) => `readiness:${reason}`),
    ...stableList(resume.blockedReasons).map((reason) => `resume:${reason}`),
    ...stableList(dispatch.blockedReasons).map((reason) => `dispatch:${reason}`),
  ]);
  const retryableRows = [
    ...(workflow.retry?.retryable === true ? ['workflow'] : []),
    ...(resume.retry?.retryable === true ? ['client-resume'] : []),
    ...commandRows
      .filter((row) => row.retry?.retryable === true || row.status === 'retryable')
      .map((row) => compactString(row.commandId || row.rowId || row.command)),
  ].filter(Boolean);
  const nextTimelineRow = timelineRows.find((row) => stableList(row.blockedReasons).length > 0)
    || timelineRows.find((row) => row.status && !['ready', 'resume_ready', 'export_ready'].includes(row.status))
    || timelineRows.at(-1)
    || {};
  const status = blockedReasons.length > 0
    ? readiness.acceptance?.required === true && readiness.acceptance?.accepted !== true
      ? 'waiting_for_client_acceptance'
      : 'client_action_required'
    : analytics.ready === true && resume.readyForRuntimeReplay === true
      ? 'ready_for_runtime_replay'
      : analytics.ready === true
        ? 'ready_for_client_resume'
        : 'observing';
  const nextAction = compactString(
    readiness.nextAction
      || resume.nextAction
      || workflow.nextAction
      || nextTimelineRow.nextAction
      || analytics.nextAction
      || 'observe',
  );
  const reportKey = [
    persistedState.requestId || workflow.resumeToken || resume.resumeToken || 'mailchimp:recovery',
    status,
    analytics.timeline?.latestRowId || nextTimelineRow.id || 'timeline',
  ].map(compactString).filter(Boolean).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const historyRows = timelineRows.map((row, index) => ({
    rowId: compactString(row.id || `client-workflow-history:${index + 1}`),
    order: index + 1,
    phase: compactString(row.phase || 'client-workflow'),
    status: compactString(row.status || 'unknown'),
    nextAction: compactString(row.nextAction || nextAction),
    resumeToken: compactString(row.resumeToken),
    retryAfterMs: Number(row.retryAfterMs || 0),
    blockedReasons: stableList(row.blockedReasons),
    exportable: row.exportable !== false,
  }));
  const stepRows = recoverySteps.slice(0, 20).map((step, index) => ({
    rowId: compactString(step.commandId || step.id || `recovery-step:${index + 1}`),
    order: index + 1,
    action: compactString(step.action || step.nextAction || 'observe'),
    code: compactString(step.code || `mailchimp.recovery.step.${index + 1}`),
    owner: compactString(step.owner || (step.requiresOperator ? 'operator' : 'runtime')),
    requiresOperator: step.requiresOperator === true,
    retryable: step.retry?.retryable === true || step.requiresOperator !== true,
  }));

  return {
    protocol: 'aios.recovery-client-workflow-report.mailchimp.v1',
    reportKey,
    status,
    readyForExport: analytics.exportReady === true,
    readyForClientResume: analytics.ready === true && blockedReasons.length === 0,
    readyForRuntimeReplay: resume.readyForRuntimeReplay === true && blockedReasons.length === 0,
    nextAction,
    nextRowId: compactString(nextTimelineRow.id || historyRows[0]?.rowId),
    blockedReasons,
    counters: {
      timelineRows: historyRows.length,
      blockedTimelineRows: historyRows.filter((row) => row.blockedReasons.length > 0).length,
      recoverySteps: stepRows.length,
      operatorSteps: stepRows.filter((row) => row.requiresOperator).length,
      retryableRows: retryableRows.length,
      readinessBlockedReasons: stableList(readiness.blockedReasons).length,
      dispatchBlockedReasons: stableList(dispatch.blockedReasons).length,
      exportBlockedReasons: blockedReasons.length,
    },
    timeline: {
      latestRowId: compactString(analytics.timeline?.latestRowId || nextTimelineRow.id),
      rowCount: historyRows.length,
      rows: historyRows,
    },
    recoverySteps: stepRows,
    exportSummary: {
      artifactName: 'recovery-client-workflow-report.json',
      reportKey,
      ready: analytics.exportReady === true,
      status,
      nextAction,
      rowIds: historyRows.map((row) => row.rowId),
      blockedReasons,
    },
    clientPatch: {
      recoveryClientWorkflowReportKey: reportKey,
      recoveryClientWorkflowReportStatus: status,
      recoveryClientWorkflowReportReady: analytics.ready === true && blockedReasons.length === 0,
      recoveryClientWorkflowReportNextAction: nextAction,
      recoveryClientWorkflowReportBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: resume.readyForRuntimeReplay === true && blockedReasons.length === 0,
      duplicateCommandPolicy: 'dedupe-by-recovery-client-workflow-report-key',
      resumeFromClientWorkflowReportKey: reportKey,
      externalWritesPerformed: false,
    },
  };
}

function normalizeRecoveryStepCommand(step = {}, persistedState = {}, settings = {}) {
  const action = compactString(step.action || 'observe');
  const sourceKey = stableList([
    persistedState.requestId || 'mailchimp:recovery',
    action,
    step.code,
    persistedState.compileCache?.cacheKey,
    persistedState.providerSync?.externalRequestId,
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    commandId: `${sourceKey}:step:${step.index || 0}`,
    source: 'recovery-plan',
    action,
    code: compactString(step.code || `mailchimp.recovery.${action}`),
    owner: step.requiresOperator ? 'operator' : action.startsWith('refresh_provider') || action === 'relink_external_handoff' ? 'provider' : 'runtime',
    phase: step.requiresOperator ? 'operator-gate' : step.writesExternalSystem ? 'external-write-gate' : 'local-repair',
    localOnly: step.localOnly !== false,
    requiresOperator: step.requiresOperator === true,
    writesExternalSystem: step.writesExternalSystem === true,
    idempotencyKey: sourceKey,
    resumeToken: `${sourceKey}:resume`,
    retry: {
      maxAttempts: settings.maxAttempts,
      backoffSeconds: settings.backoffSeconds,
      retryable: step.requiresOperator !== true,
    },
    schedule: {
      scheduledAt: settings.scheduleAt || null,
      mode: settings.scheduleAt ? 'scheduled' : 'manual',
    },
  };
}

function normalizeRecoveryLaneCommand(row = {}, persistedState = {}, settings = {}) {
  const action = compactString(row.command || row.nextAction || 'observe');
  const rowId = compactString(row.rowId || [
    persistedState.requestId || 'mailchimp:recovery',
    row.entryKey || persistedState.compileCache?.cacheKey || 'entry',
    action,
    row.reason || 'lane',
  ].join(':')).replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    commandId: `${rowId}:lane`,
    source: 'compile-cache-recovery-lane',
    action,
    code: `mailchimp.recovery.${action}`,
    owner: compactString(row.owner || 'runtime'),
    phase: row.restartSafe === false ? 'restart-repair' : row.replaySafe === true ? 'replay-ready' : 'recovery-review',
    localOnly: true,
    requiresOperator: row.owner === 'operator' || row.severity === 'error',
    writesExternalSystem: false,
    reason: compactString(row.reason),
    entryKey: compactString(row.entryKey),
    idempotencyKey: compactString(row.idempotencyKey || rowId),
    resumeToken: compactString(row.resumeToken || `${rowId}:resume`),
    restartSafe: row.restartSafe === true,
    replaySafe: row.replaySafe === true,
    retry: {
      maxAttempts: settings.maxAttempts,
      backoffSeconds: settings.backoffSeconds,
      retryable: row.restartSafe !== false && row.owner !== 'operator',
    },
    schedule: {
      scheduledAt: settings.scheduleAt || null,
      mode: settings.scheduleAt ? 'scheduled' : 'manual',
    },
  };
}

function normalizeReplayBundleCommand(row = {}, persistedState = {}, settings = {}) {
  const action = compactString(row.command || row.action || row.nextAction || 'observe');
  const rowId = compactString(row.rowId || row.commandId || [
    persistedState.requestId || 'mailchimp:recovery',
    persistedState.compileCache?.cacheKey || 'cache',
    action,
    row.reason || 'replay-bundle',
  ].join(':')).replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const blockedReasons = stableList(row.blockedReasons);
  const restartSafe = row.restartSafe !== false && blockedReasons.length === 0;

  return {
    commandId: compactString(row.commandId || `${rowId}:bundle`),
    source: 'compile-cache-replay-command-bundle',
    action,
    code: `mailchimp.recovery.${action}`,
    owner: compactString(row.owner || 'runtime'),
    phase: compactString(row.phase || (restartSafe ? 'replay-command' : 'restart-repair')),
    localOnly: row.localOnly !== false,
    requiresOperator: row.owner === 'operator' || row.status === 'blocked' || blockedReasons.length > 0,
    writesExternalSystem: false,
    reason: compactString(row.reason || 'replay_command_bundle'),
    idempotencyKey: compactString(row.idempotencyKey || rowId),
    resumeToken: compactString(row.resumeToken || persistedState.replayCommandBundle?.bundleKey || `${rowId}:resume`),
    restartSafe,
    replaySafe: row.replaySafe === true,
    retry: {
      maxAttempts: Number(row.retry?.maxAttempts || settings.maxAttempts),
      backoffSeconds: settings.backoffSeconds,
      retryable: row.retry?.retryable === true || (restartSafe && row.owner !== 'operator'),
      retryAfterMs: Number(row.retry?.retryAfterMs || 0),
      exhausted: row.retry?.exhausted === true,
    },
    schedule: row.schedule || {
      scheduledAt: settings.scheduleAt || null,
      mode: settings.scheduleAt ? 'scheduled' : 'manual',
    },
    blockedReasons,
  };
}

function buildRecoveryCommandManifest(recovery, settings, persistedState, steps) {
  const laneRows = Array.isArray(recovery.compileCacheRecovery.recoveryExportLane?.rows)
    ? recovery.compileCacheRecovery.recoveryExportLane.rows
    : [];
  const replayBundleRows = Array.isArray(recovery.compileCacheRecovery.replayCommandBundle?.rows)
    ? recovery.compileCacheRecovery.replayCommandBundle.rows
    : Array.isArray(persistedState.replayCommandBundle?.rows)
      ? persistedState.replayCommandBundle.rows
      : [];
  const rawCommands = [
    ...steps.map((step) => normalizeRecoveryStepCommand(step, persistedState, settings)),
    ...laneRows.map((row) => normalizeRecoveryLaneCommand(row, persistedState, settings)),
    ...replayBundleRows.map((row) => normalizeReplayBundleCommand(row, persistedState, settings)),
  ];
  const commands = rawCommands.reduce((unique, command) => {
    const key = command.idempotencyKey || command.commandId;
    if (unique.keys.has(key)) return unique;
    unique.keys.add(key);
    unique.items.push({
      ...command,
      sequence: unique.items.length + 1,
    });
    return unique;
  }, { keys: new Set(), items: [] }).items;
  const blocked = commands.filter((command) => command.requiresOperator || command.restartSafe === false);
  const retryable = commands.filter((command) => command.retry?.retryable === true);
  const nextCommand = blocked[0]
    || commands.find((command) => command.action === persistedState.resume.command)
    || commands[0]
    || null;
  const exportReady = persistedState.restartSafe === true && blocked.length === 0;

  return {
    protocol: 'aios.recovery-command-manifest.mailchimp.v1',
    requestId: recovery.requestId,
    tenant: recovery.tenant,
    action: recovery.action,
    exportReady,
    status: exportReady ? 'ready' : 'blocked',
    nextAction: exportReady ? persistedState.resume.command : nextCommand?.action || 'hold_for_operator',
    nextCommandId: nextCommand?.commandId || null,
    idempotencyKey: stableList([
      recovery.requestId || 'mailchimp:recovery',
      persistedState.state,
      persistedState.idempotency.nextCommandKey,
      commands.map((command) => command.idempotencyKey).join('|'),
    ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_'),
    counters: {
      commands: commands.length,
      blocked: blocked.length,
      retryable: retryable.length,
      operatorCommands: commands.filter((command) => command.owner === 'operator').length,
      providerCommands: commands.filter((command) => command.owner === 'provider').length,
      runtimeCommands: commands.filter((command) => command.owner === 'runtime').length,
      laneCommands: commands.filter((command) => command.source === 'compile-cache-recovery-lane').length,
      replayBundleCommands: commands.filter((command) => command.source === 'compile-cache-replay-command-bundle').length,
    },
    schedule: {
      mode: settings.scheduleAt ? 'scheduled' : 'manual',
      nextRunAt: settings.scheduleAt || null,
      backoffSeconds: settings.backoffSeconds,
      maxAttempts: settings.maxAttempts,
    },
    blockedReasons: stableList([
      ...persistedState.resume.blockedReasons,
      ...blocked.map((command) => command.reason || command.code || command.action),
    ]),
    timeline: {
      rowCount: commands.length,
      latestCommandId: nextCommand?.commandId || null,
      rows: commands.map((command) => ({
        sequence: command.sequence,
        commandId: command.commandId,
        source: command.source,
        action: command.action,
        owner: command.owner,
        phase: command.phase,
        status: command.requiresOperator || command.restartSafe === false
          ? 'blocked'
          : command.replaySafe === true
            ? 'ready'
            : 'waiting',
      })),
    },
    commands,
  };
}

function buildPersistedRecoveryState(recovery, settings, steps) {
  const status = recovery.status || {};
  const adapterDispatchReadiness = recovery.adapterDispatchReadiness || {};
  const clientWorkflowHandoff = normalizeClientWorkflowHandoffReport(
    adapterDispatchReadiness,
    {
      state: adapterDispatchReadiness.state,
      routeState: adapterDispatchReadiness.route?.primaryAction,
      nextAction: adapterDispatchReadiness.nextAction,
      resumeToken: adapterDispatchReadiness.readinessKey,
      statusRevision: recovery.status?.statusRevision,
    },
  );
  const compileCache = recovery.compileCacheRecovery || {};
  const provider = recovery.providerRecovery || {};
  const permissionBoundary = recovery.status?.permissionBoundary || {};
  const boundaryHandoff = recovery.boundaryHandoff || recovery.status?.tenantBoundaryHandoff || {};
  const boundaryContinuity = recovery.boundaryContinuity
    || recovery.status?.tenantBoundaryContinuity
    || recovery.status?.ui?.tenantBoundaryContinuity
    || {};
  const compileCacheUiHandoff = status.compileCacheUiHandoff
    || status.compileCache?.uiHandoff
    || {};
  const clientReadinessDecision = normalizeClientReadinessDecisionContract(status, {
    requestId: recovery.requestId,
    statusRevision: status.statusRevision || status.readiness?.statusRevision,
    nextAction: status.readiness?.nextStep || recovery.status?.readiness?.nextStep || 'repair_client_readiness',
  });
  const clientCommand = status.clientCommand || status.ui?.clientCommand || {};
  const persistedCommandEvidence = clientCommand.persistedCommandEvidence
    || status.adapterPersistedCommandEvidence
    || status.persistedCommandEvidence
    || adapterDispatchReadiness.persistedCommandEvidence
    || {};
  const acceptance = compileCacheUiHandoff.acceptance || status.readiness?.acceptance || {};
  const validationSummary = compileCacheUiHandoff.validationSummary || status.readiness?.validationSummary || {};
  const routeHints = compileCacheUiHandoff.routeHints || {};
  const nextSteps = Array.isArray(compileCacheUiHandoff.nextSteps) ? compileCacheUiHandoff.nextSteps : [];
  const commandKeys = steps.map((step) => [
    recovery.requestId || 'mailchimp:recovery',
    step.action,
    step.code,
    compileCache.cacheKey || 'no-cache',
    provider.externalRequestId || provider.externalHandoffState || 'local',
  ].map(compactString).filter(Boolean).join(':'));
  const uniqueCommandKeys = stableList(commandKeys);
  const providerCheckpoint = compileCache.providerSyncCheckpoint || {};
  const boundaryCheckpoint = compileCache.boundaryCheckpoint || {};
  const boundaryAuditHandoff = normalizeCompileCacheBoundaryAuditHandoff(boundaryCheckpoint, {
    tenant: recovery.tenant,
    workspace: status.workspace || recovery.workspace,
  });
  const replayBarrier = compileCache.replayBarrier || {};
  const persistedReplay = compileCache.persistedReplay || {};
  const operationalHealth = compileCache.operationalHealth || {};
  const exportPackage = compileCache.exportPackage || {};
  const recoveryExportLane = compileCache.recoveryExportLane || {};
  const resumeGate = compileCache.resumeGate || {};
  const resumeEvidenceHandoff = compileCache.resumeEvidenceHandoff || {};
  const acceptanceChecklist = compileCache.acceptanceChecklist || {};
  const lifecycleCommandCheckpoint = compileCache.lifecycleCommandCheckpoint || {};
  const lifecycleControlPlane = compileCache.lifecycleControlPlane
    || compileCache.lifecycle?.controlPlane
    || compileCache.lifecycle?.controlContract?.controlPlane
    || {};
  const clientResumePacket = compileCache.clientResumePacket || {};
  const replayCommandBundle = compileCache.replayCommandBundle || {};
  const clientExportTimeline = compileCache.clientExportTimeline || {};
  const providerReceiptEvidence = adapterDispatchReadiness.providerReceiptEvidence
    || status.providerReceiptEvidence
    || status.providerReceiptEvidenceHandoff
    || provider.receiptEvidence
    || {};
  const providerReceiptReplayGuard = recovery.providerReceiptReplayGuard
    || buildProviderReceiptReplayGuard(provider, adapterDispatchReadiness, status);
  const providerEvidenceMissing = stableList(providerReceiptEvidence.missingEvidence);
  const providerEvidenceReady = providerReceiptEvidence.ready !== false && providerEvidenceMissing.length === 0;
  const lifecycleControlPlaneBlockedReasons = stableList(lifecycleControlPlane.blockedReasons);
  const lifecycleControlPlaneDeferredReasons = stableList(lifecycleControlPlane.deferredReasons);
  const lifecycleControlPlaneState = compactString(lifecycleControlPlane.state || 'unknown');
  const lifecycleControlPlaneBlocked = lifecycleControlPlaneState === 'blocked'
    || lifecycleControlPlane.restartSemantics?.replaySafe === false
    || lifecycleControlPlaneBlockedReasons.length > 0;
  const lifecycleControlPlaneDeferred = lifecycleControlPlaneState === 'scheduled'
    || lifecycleControlPlane.routeState === 'deferred'
    || lifecycleControlPlaneDeferredReasons.length > 0;
  const replayBundleBlockedReasons = stableList(replayCommandBundle.blockedReasons);
  const replayBundleRows = Array.isArray(replayCommandBundle.rows) ? replayCommandBundle.rows : [];
  const replayBundleBlocked = replayCommandBundle.ready === false
    || replayCommandBundle.status === 'blocked'
    || (replayCommandBundle.counters?.blocked || 0) > 0;
  const replayBundleRestartSafe = replayCommandBundle.restartSemantics?.replaySafe !== false;
  const replayBundleNextAction = compactString(
    replayCommandBundle.nextAction
      || replayCommandBundle.recoveryCommand
      || replayCommandBundle.timeline?.latestCommand,
  );
  const clientExportTimelineRows = Array.isArray(clientExportTimeline.rows) ? clientExportTimeline.rows : [];
  const clientExportTimelineBlockedRows = clientExportTimelineRows.filter((row) => (
    row.ready === false || row.status === 'blocked' || row.routeState === 'needs_attention'
  ));
  const clientExportTimelineBlocked = clientExportTimeline.ready === false
    || clientExportTimeline.status === 'blocked'
    || (clientExportTimeline.counters?.blockedRows || 0) > 0
    || clientExportTimelineBlockedRows.length > 0;
  const clientExportTimelineNextAction = compactString(
    clientExportTimeline.nextAction
      || clientExportTimeline.route?.primaryAction
      || clientExportTimelineBlockedRows[0]?.nextAction,
  );
  const persistedCommandBlockedReasons = stableList([
    ...stableList(persistedCommandEvidence.blockedReasons),
    ...(persistedCommandEvidence.ready === false ? ['persisted_command_evidence_not_ready'] : []),
    ...(persistedCommandEvidence.restartSafe === false ? ['persisted_command_not_restart_safe'] : []),
    ...(persistedCommandEvidence.replaySafe === false ? ['persisted_command_not_replay_safe'] : []),
    ...(persistedCommandEvidence.externalWrite === true
      && !persistedCommandEvidence.externalHandoff?.requestId
      && persistedCommandEvidence.state !== 'acknowledged'
      ? ['persisted_command_external_request_missing']
      : []),
    ...(persistedCommandEvidence.externalWrite === true
      && persistedCommandEvidence.externalHandoff?.acknowledged === false
      && persistedCommandEvidence.state === 'ready_to_dispatch'
      ? ['persisted_command_receipt_not_acknowledged']
      : []),
  ]);
  const persistedCommandReady = persistedCommandEvidence.protocol === 'aios.adapter-persisted-command-evidence.mailchimp.v1'
    ? persistedCommandBlockedReasons.length === 0
    : clientCommand.commandId
      ? clientCommand.restartSafe !== false
      : true;
  const persistedCommandResumeKey = compactString(
    persistedCommandEvidence.evidenceKey
      || persistedCommandEvidence.commandKey
      || clientCommand.idempotencyKey
      || clientCommand.commandId,
  );
  const persistedCommandNextAction = compactString(
    persistedCommandEvidence.nextAction
      || clientCommand.submitAction
      || clientCommand.requestedAction,
  );
  const restartBlockedReasons = stableList([
    ...(validationSummary.blockedReasons || []),
    ...(clientCommand.validationSummary?.blockedReasons || []).map((reason) => `client_command:${reason}`),
    ...(clientCommand.restartSafe === false ? ['client_command_not_restart_safe'] : []),
    ...persistedCommandBlockedReasons.map((reason) => `persisted_command:${reason}`),
    ...(clientCommand.acceptance?.required === true && clientCommand.acceptance?.accepted !== true
      ? ['client_command_acceptance_missing']
      : []),
    ...(compileCache.providerSyncRefreshRequired ? ['provider_sync_refresh_required'] : []),
    ...(compileCache.boundaryRepairRequired ? ['compile_cache_boundary_repair_required'] : []),
    ...(boundaryCheckpoint.restartSafe === false ? ['compile_cache_boundary_not_restart_safe'] : []),
    ...(boundaryCheckpoint.replayAllowed === false ? ['compile_cache_boundary_replay_blocked'] : []),
    ...(boundaryAuditHandoff.ready === false ? ['compile_cache_boundary_audit_not_ready'] : []),
    ...(boundaryAuditHandoff.auditRequired === true && boundaryAuditHandoff.auditAppendReady !== true
      ? ['compile_cache_boundary_audit_append_required']
      : []),
    ...(boundaryCheckpoint.blockedReasons || []).map((reason) => `boundary:${reason}`),
    ...(boundaryAuditHandoff.blockedReasons || []).map((reason) => `boundary_audit:${reason}`),
    ...(compileCache.controlsRequired ? ['compile_cache_controls_required'] : []),
    ...(compileCache.reportReviewRequired ? ['compile_cache_report_review_required'] : []),
    ...(compileCache.exportPackageReviewRequired ? ['compile_cache_export_package_review_required'] : []),
    ...(exportPackage.exportReady === false ? ['compile_cache_export_package_not_ready'] : []),
    ...(Array.isArray(exportPackage.blockedReasons)
      ? exportPackage.blockedReasons.map((reason) => `export_package:${reason}`)
      : []),
    ...(compileCache.recoveryLaneBlocked ? ['compile_cache_recovery_lane_blocked'] : []),
    ...(Array.isArray(recoveryExportLane.blockedReasons)
      ? recoveryExportLane.blockedReasons.map((reason) => `recovery_lane:${reason}`)
      : []),
    ...(compileCache.barrierClosed ? ['compile_cache_replay_barrier_closed'] : []),
    ...(compileCache.persistedRestartSafe === false ? ['compile_cache_persisted_replay_not_restart_safe'] : []),
    ...(persistedReplay.blockedReasons || []),
    ...(compileCache.retryExhausted ? ['compile_cache_replay_attempt_budget_exhausted'] : []),
    ...(compileCache.resumeGateBlocked ? ['compile_cache_resume_gate_blocked'] : []),
    ...(resumeGate.blockedReasons || []).map((reason) => `resume_gate:${reason}`),
    ...(compileCache.resumeEvidenceBlocked ? ['compile_cache_resume_evidence_missing'] : []),
    ...(compileCache.resumeEvidenceMissing || []).map((reason) => `resume_evidence:${reason}`),
    ...(compileCache.checklistBlocked ? ['compile_cache_acceptance_checklist_blocked'] : []),
    ...(compileCache.checklistAcceptanceRequired ? ['compile_cache_acceptance_checklist_acceptance_missing'] : []),
    ...(compileCache.lifecycleCommandBlocked ? ['compile_cache_lifecycle_command_blocked'] : []),
    ...(compileCache.lifecycleCommandHeld ? ['compile_cache_lifecycle_command_held'] : []),
    ...(compileCache.lifecycleCommandRestartSafe === false ? ['compile_cache_lifecycle_command_not_restart_safe'] : []),
    ...(lifecycleControlPlaneBlocked ? ['compile_cache_lifecycle_control_plane_blocked'] : []),
    ...(lifecycleControlPlaneDeferred ? ['compile_cache_lifecycle_control_plane_deferred'] : []),
    ...lifecycleControlPlaneBlockedReasons.map((reason) => `lifecycle_control:${reason}`),
    ...(clientResumePacket.readyForClientRuntime === false ? ['compile_cache_client_resume_not_ready'] : []),
    ...(clientResumePacket.readyForRuntimeReplay === false ? ['compile_cache_client_resume_replay_not_ready'] : []),
    ...(clientResumePacket.retry?.exhausted === true ? ['compile_cache_client_resume_retry_exhausted'] : []),
    ...(Array.isArray(clientResumePacket.blockedReasons)
      ? clientResumePacket.blockedReasons.map((reason) => `client_resume:${reason}`)
      : []),
    ...(replayBundleBlocked ? ['compile_cache_replay_command_bundle_blocked'] : []),
    ...(replayBundleRestartSafe ? [] : ['compile_cache_replay_command_bundle_not_restart_safe']),
    ...replayBundleBlockedReasons.map((reason) => `replay_command_bundle:${reason}`),
    ...(clientExportTimelineBlocked ? ['compile_cache_client_export_timeline_blocked'] : []),
    ...stableList(clientExportTimeline.blockedReasons).map((reason) => `client_export_timeline:${reason}`),
    ...clientExportTimelineBlockedRows.flatMap((row) => (
      stableList(row.blockedReasons).map((reason) => `client_export_timeline:${row.rowId || row.id}:${reason}`)
    )),
    ...(Array.isArray(lifecycleCommandCheckpoint.blockedReasons)
      ? lifecycleCommandCheckpoint.blockedReasons.map((reason) => `lifecycle_command:${reason}`)
      : []),
    ...(Array.isArray(acceptanceChecklist.blockingItems)
      ? acceptanceChecklist.blockingItems.flatMap((item) => (
        stableList(item.blockedReasons).map((reason) => `acceptance_checklist:${item.key || item.itemId}:${reason}`)
      ))
      : []),
    ...(replayBarrier.blockedReasons || []),
    ...(permissionBoundary.allowed === false ? ['tenant_permission_boundary_blocked'] : []),
    ...(permissionBoundary.boundary?.missingOrDenied || []),
    ...(boundaryContinuity.ready === false ? ['tenant_boundary_continuity_blocked'] : []),
    ...stableList(boundaryContinuity.blockedReasons).map((reason) => `boundary_continuity:${reason}`),
    ...(boundaryHandoff.readyForRuntime === false ? ['tenant_boundary_handoff_blocked'] : []),
    ...(boundaryHandoff.requiresAuditAppend === true && boundaryHandoff.auditAppendReady !== true
      ? ['tenant_boundary_audit_append_required']
      : []),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `boundary_handoff:${reason}`),
    ...(provider.refreshRequired ? ['provider_refresh_required'] : []),
    ...(provider.receipt?.required === true && provider.receipt?.acknowledged !== true
      ? ['provider_receipt_ack_missing']
      : []),
    ...(provider.receipt?.restartSafe === false ? ['provider_receipt_not_restart_safe'] : []),
    ...(provider.receipt?.blockedReasons || []).map((reason) => `provider_receipt:${reason}`),
    ...(providerEvidenceReady ? [] : ['provider_receipt_evidence_not_ready']),
    ...providerEvidenceMissing.map((item) => `provider_evidence:${item}`),
    ...(providerReceiptReplayGuard.ready === false ? ['provider_receipt_replay_guard_blocked'] : []),
    ...stableList(providerReceiptReplayGuard.blockedReasons).map((reason) => `provider_receipt_guard:${reason}`),
    ...(provider.exportReady === false ? ['provider_service_contract_not_export_ready'] : []),
    ...(provider.blockedReasons || []).map((reason) => `provider:${reason}`),
    ...(adapterDispatchReadiness.ready === false ? ['adapter_dispatch_readiness_blocked'] : []),
    ...(adapterDispatchReadiness.dispatchReady === false && adapterDispatchReadiness.externalWrite === true
      ? ['adapter_dispatch_not_runtime_ready']
      : []),
    ...(adapterDispatchReadiness.blockedReasons || []).map((reason) => `adapter_dispatch:${reason}`),
    ...(clientWorkflowHandoff.blockedReasons || []).map((reason) => `client_workflow:${reason}`),
    ...(clientWorkflowHandoff.retry?.exhausted === true ? ['client_workflow_retry_exhausted'] : []),
    ...(clientReadinessDecision.readyForRuntimeStart === false ? ['client_readiness_decision_blocked'] : []),
    ...(clientReadinessDecision.acceptance.required === true && clientReadinessDecision.acceptance.accepted !== true
      ? ['client_readiness_acceptance_required']
      : []),
    ...(clientReadinessDecision.blockedReasons || []).map((reason) => `client_readiness:${reason}`),
    ...(settings.enabled === false ? ['recovery_disabled'] : []),
    ...(acceptance.required && !acceptance.accepted ? ['acceptance_missing'] : []),
  ]);
  const replaySafe = compileCache.replaySafe === true
    && provider.restartSafe === true
    && providerCheckpoint.restartSafe !== false
    && boundaryCheckpoint.restartSafe !== false
    && boundaryCheckpoint.replayAllowed !== false
    && compileCache.persistedRestartSafe !== false
    && resumeGate.ready !== false
    && resumeEvidenceHandoff.ready !== false
    && acceptanceChecklist.ready !== false
    && compileCache.lifecycleCommandBlocked !== true
    && compileCache.lifecycleCommandRestartSafe !== false
    && lifecycleControlPlaneBlocked !== true
    && clientResumePacket.readyForClientRuntime !== false
    && clientResumePacket.readyForRuntimeReplay !== false
    && persistedCommandReady
    && persistedCommandEvidence.replaySafe !== false
    && replayBundleBlocked !== true
    && replayBundleRestartSafe
    && clientExportTimelineBlocked !== true
    && boundaryContinuity.ready !== false
    && boundaryContinuity.restartSemantics?.replaySafe !== false
    && providerEvidenceReady
    && providerReceiptReplayGuard.ready !== false
    && providerReceiptReplayGuard.replaySafe !== false
    && replayBarrier.open !== false
    && restartBlockedReasons.length === 0;
  const barrierResumeCommand = compactString(
    persistedReplay.recovery?.command
      || persistedReplay.nextAction
      || replayBarrier.recoveryCommand
      || replayBarrier.nextAction,
  );
  const state = [
    [replaySafe, 'resume_ready'],
    [recovery.requiresRollback, 'rollback_hold'],
    [acceptance.required && !acceptance.accepted, 'waiting_for_acceptance'],
    [compileCache.checklistAcceptanceRequired, 'waiting_for_acceptance'],
    [compileCache.checklistBlocked, 'waiting_for_acceptance_checklist'],
    [resumeGate.ready === false && resumeGate.routeState === 'acceptance_required', 'waiting_for_acceptance'],
    [compileCache.retryExhausted || clientResumePacket.retry?.exhausted === true || resumeGate.retry?.exhausted === true, 'retry_budget_hold'],
    [
      clientResumePacket.readyForClientRuntime === false && clientResumePacket.state === 'waiting_for_acceptance',
      'waiting_for_acceptance',
    ],
    [persistedCommandBlockedReasons.includes('persisted_command_external_request_missing'), 'waiting_for_external_handoff_link'],
    [persistedCommandBlockedReasons.includes('persisted_command_receipt_not_acknowledged'), 'waiting_for_provider_receipt'],
    [persistedCommandReady === false, 'waiting_for_persisted_command_evidence'],
    [
      clientResumePacket.readyForClientRuntime === false && clientResumePacket.state === 'waiting_for_provider_receipt',
      'waiting_for_provider_receipt',
    ],
    [
      clientResumePacket.readyForClientRuntime === false && clientResumePacket.state === 'waiting_for_provider_sync',
      'waiting_for_provider_sync',
    ],
    [
      clientResumePacket.readyForClientRuntime === false && clientResumePacket.state === 'waiting_for_boundary_audit',
      'waiting_for_boundary_audit',
    ],
    [
      boundaryAuditHandoff.ready === false
        || (boundaryAuditHandoff.auditRequired === true && boundaryAuditHandoff.auditAppendReady !== true),
      'waiting_for_boundary_audit',
    ],
    [
      clientResumePacket.readyForClientRuntime === false && clientResumePacket.state === 'waiting_for_lifecycle_command',
      'waiting_for_lifecycle_command_repair',
    ],
    [replayBundleBlocked, 'waiting_for_replay_command_bundle'],
    [clientExportTimelineBlocked, 'waiting_for_client_export_timeline'],
    [
      clientReadinessDecision.acceptance.required === true && clientReadinessDecision.acceptance.accepted !== true,
      'waiting_for_client_acceptance',
    ],
    [clientReadinessDecision.readyForRuntimeStart === false, 'waiting_for_client_readiness'],
    [
      resumeEvidenceHandoff.ready === false && resumeEvidenceHandoff.state === 'waiting_for_acceptance',
      'waiting_for_acceptance',
    ],
    [
      resumeEvidenceHandoff.ready === false && resumeEvidenceHandoff.state === 'waiting_for_provider_receipt',
      'waiting_for_provider_receipt',
    ],
    [
      providerReceiptEvidence.ready === false && providerReceiptEvidence.state === 'waiting_for_provider_receipt',
      'waiting_for_provider_receipt',
    ],
    [
      providerReceiptEvidence.ready === false && providerReceiptEvidence.state === 'waiting_for_external_handoff_link',
      'waiting_for_external_handoff_link',
    ],
    [
      providerReceiptEvidence.ready === false && providerReceiptEvidence.state === 'waiting_for_provider_sync',
      'waiting_for_provider_sync',
    ],
    [
      providerReceiptReplayGuard.ready === false
        && providerReceiptReplayGuard.state === 'waiting_for_external_handoff_link',
      'waiting_for_external_handoff_link',
    ],
    [
      providerReceiptReplayGuard.ready === false
        && providerReceiptReplayGuard.state === 'waiting_for_provider_receipt',
      'waiting_for_provider_receipt',
    ],
    [
      providerReceiptReplayGuard.ready === false
        && providerReceiptReplayGuard.state === 'waiting_for_provider_sync',
      'waiting_for_provider_sync',
    ],
    [
      providerReceiptReplayGuard.ready === false
        && providerReceiptReplayGuard.state === 'provider_continuity_hold',
      'waiting_for_provider_continuity',
    ],
    [
      resumeEvidenceHandoff.ready === false && resumeEvidenceHandoff.state === 'waiting_for_boundary_audit',
      'waiting_for_boundary_audit',
    ],
    [
      resumeEvidenceHandoff.ready === false && resumeEvidenceHandoff.state === 'waiting_for_provider_sync',
      'waiting_for_provider_sync',
    ],
    [compileCache.lifecycleCommandHeld, 'waiting_for_lifecycle_release'],
    [compileCache.lifecycleCommandBlocked, 'waiting_for_lifecycle_command_repair'],
    [lifecycleControlPlaneBlocked, 'waiting_for_lifecycle_control_repair'],
    [lifecycleControlPlaneDeferred, 'waiting_for_lifecycle_schedule'],
    [compileCache.barrierClosed, 'waiting_for_replay_barrier'],
    [resumeGate.ready === false, 'waiting_for_resume_gate'],
    [permissionBoundary.allowed === false, 'waiting_for_permission_repair'],
    [boundaryContinuity.state === 'waiting_for_audit', 'waiting_for_boundary_audit'],
    [boundaryContinuity.state === 'workspace_drift', 'waiting_for_boundary_repair'],
    [boundaryContinuity.ready === false, 'waiting_for_boundary_continuity'],
    [boundaryHandoff.readyForRuntime === false, 'waiting_for_boundary_handoff'],
    [
      boundaryHandoff.requiresAuditAppend === true && boundaryHandoff.auditAppendReady !== true,
      'waiting_for_boundary_audit',
    ],
    [compileCache.boundaryRepairRequired, 'waiting_for_boundary_repair'],
    [compileCache.providerSyncRefreshRequired, 'waiting_for_provider_sync'],
    [compileCache.persistedRestartSafe === false, 'waiting_for_persisted_replay'],
    [compileCache.refreshRequired, 'waiting_for_compile_cache_refresh'],
    [exportPackage.exportReady === false, 'waiting_for_compile_cache_export_package'],
    [compileCache.recoveryLaneBlocked, 'waiting_for_compile_cache_recovery_lane'],
    [provider.receipt?.required === true && provider.receipt?.acknowledged !== true, 'waiting_for_provider_receipt'],
    [provider.refreshRequired, 'waiting_for_provider_refresh'],
    [settings.enabled === false, 'disabled'],
  ].find(([condition]) => condition)?.[1] || 'waiting_for_operator';

  return {
    protocol: 'aios.recovery-persisted-state.mailchimp.v1',
    requestId: recovery.requestId,
    tenant: recovery.tenant,
    action: recovery.action,
    state,
    replaySafe,
    restartSafe: replaySafe || [
      'waiting_for_acceptance',
      'waiting_for_client_acceptance',
      'waiting_for_operator',
      'disabled',
    ].includes(state),
    idempotency: {
      descriptorKey: compactString(status.requestId || recovery.requestId),
      cacheKey: compactString(compileCache.cacheKey),
      providerRequestId: compactString(provider.externalRequestId),
      providerEvidenceKey: compactString(providerReceiptEvidence.evidenceKey),
      providerReceiptGuardKey: compactString(providerReceiptReplayGuard.guardKey),
      commandKeys: stableList([
        ...uniqueCommandKeys,
        clientCommand.commandId,
        clientCommand.idempotencyKey,
        persistedCommandEvidence.evidenceKey,
        persistedCommandEvidence.commandKey,
        persistedCommandEvidence.route?.idempotencyKey,
        providerReceiptEvidence.evidenceKey,
        providerReceiptEvidence.route?.idempotencyKey,
        providerReceiptReplayGuard.guardKey,
        providerReceiptReplayGuard.route?.idempotencyKey,
        boundaryAuditHandoff.handoffKey,
        boundaryAuditHandoff.route?.idempotencyKey,
        boundaryContinuity.continuityKey,
        boundaryContinuity.route?.idempotencyKey,
        boundaryContinuity.restartSemantics?.resumeFromBoundaryContinuityKey,
        clientResumePacket.packetId,
        clientResumePacket.route?.idempotencyKey,
        clientResumePacket.resumeToken,
        replayCommandBundle.bundleKey,
        replayCommandBundle.idempotencyKey,
        replayCommandBundle.nextCommandId,
        ...replayBundleRows.map((row) => row.idempotencyKey || row.commandId || row.rowId),
        clientExportTimeline.timelineKey,
        clientExportTimeline.route?.idempotencyKey,
        clientExportTimeline.nextRowId,
        clientReadinessDecision.decisionId,
        clientReadinessDecision.route?.idempotencyKey,
        clientReadinessDecision.restartSemantics?.resumeFromDecisionId,
        ...clientExportTimelineRows.map((row) => row.idempotencyKey || row.resumeToken || row.rowId || row.id),
        lifecycleCommandCheckpoint.idempotencyKey,
        lifecycleCommandCheckpoint.checkpointKey,
        lifecycleControlPlane.controlKey,
        lifecycleControlPlane.clientPatch?.compileCacheLifecycleControlKey,
        persistedReplay.idempotencyKey,
        persistedReplay.retryKey,
        persistedReplay.replayKey,
      ]),
      nextCommandKey: compactString(
        replayCommandBundle.idempotencyKey
          || persistedReplay.idempotencyKey
          || persistedCommandResumeKey
          || clientCommand.idempotencyKey
          || uniqueCommandKeys[0],
      ),
      retryKey: compactString(persistedReplay.retryKey),
      replayKey: compactString(persistedReplay.replayKey),
    },
    acceptance: {
      required: acceptance.required === true || acceptanceChecklist.acceptance?.required === true,
      accepted: acceptance.accepted === true || acceptanceChecklist.acceptance?.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy || acceptanceChecklist.acceptance?.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt || acceptanceChecklist.acceptance?.acceptedAt),
      reason: compactString(acceptance.reason || acceptanceChecklist.acceptance?.requiredBecause?.[0]),
      token: compactString(acceptanceChecklist.acceptance?.token || acceptanceChecklist.route?.acceptanceToken),
    },
    permissionBoundary: {
      state: compactString(permissionBoundary.state || 'unknown'),
      allowed: permissionBoundary.allowed !== false,
      externalWritesAllowed: permissionBoundary.externalWritesAllowed === true,
      nextAction: compactString(permissionBoundary.nextAction || 'observe'),
      blockedReasons: stableList(permissionBoundary.boundary?.missingOrDenied),
      audit: permissionBoundary.audit || null,
    },
    boundaryHandoff: {
      protocol: boundaryHandoff.protocol || 'aios.recovery-tenant-boundary-handoff.mailchimp.v1',
      boundaryKey: compactString(boundaryHandoff.boundaryKey),
      tenant: compactString(boundaryHandoff.tenant || boundaryHandoff.tenantId || recovery.tenant),
      workspace: compactString(boundaryHandoff.workspace || boundaryHandoff.workspaceId),
      action: compactString(boundaryHandoff.action || recovery.action),
      readyForRuntime: boundaryHandoff.readyForRuntime === true,
      allowed: boundaryHandoff.allowed !== false,
      requiresAuditAppend: boundaryHandoff.requiresAuditAppend === true,
      auditAppendReady: boundaryHandoff.auditAppendReady === true,
      externalWriteSuppressed: boundaryHandoff.externalWriteSuppressed === true
        || boundaryHandoff.audit?.externalWriteSuppressed === true,
      nextAction: compactString(boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'repair_tenant_permissions'),
      blockedReasons: stableList(boundaryHandoff.blockedReasons),
      audit: boundaryHandoff.audit || null,
      route: boundaryHandoff.route || null,
      restartSemantics: boundaryHandoff.restartSemantics || null,
    },
    boundaryContinuity: {
      protocol: boundaryContinuity.protocol || 'aios.recovery-tenant-boundary-continuity.mailchimp.v1',
      continuityKey: compactString(boundaryContinuity.continuityKey),
      state: compactString(boundaryContinuity.state || 'unknown'),
      ready: boundaryContinuity.ready !== false,
      restartSafe: boundaryContinuity.restartSafe !== false,
      replaySafe: boundaryContinuity.replaySafe === true || boundaryContinuity.restartSemantics?.replaySafe === true,
      nextAction: compactString(boundaryContinuity.nextAction || 'repair_tenant_permissions'),
      blockedReasons: stableList(boundaryContinuity.blockedReasons),
      audit: boundaryContinuity.audit || null,
      counters: boundaryContinuity.counters || {},
      route: boundaryContinuity.route || null,
      restartSemantics: boundaryContinuity.restartSemantics || null,
    },
    providerSync: {
      state: compactString(providerCheckpoint.state || 'unknown'),
      restartSafe: providerCheckpoint.restartSafe === true,
      replayPolicy: compactString(providerCheckpoint.replayPolicy),
      externalHandoffState: compactString(providerCheckpoint.externalHandoffState || provider.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerCheckpoint.externalRequestId || provider.externalRequestId),
      cursorRequired: providerCheckpoint.cursorRequired === true,
      cursorPresent: providerCheckpoint.cursorPresent === true || providerCheckpoint.cursorRequired !== true,
      blockedReasons: stableList(providerCheckpoint.blockedReasons),
    },
    externalHandoffReceipt: {
      protocol: 'aios.recovery-provider-receipt-evidence.mailchimp.v1',
      state: compactString(provider.receipt?.state || 'missing'),
      evidenceState: compactString(providerReceiptEvidence.state || 'unknown'),
      evidenceKey: compactString(providerReceiptEvidence.evidenceKey),
      guardKey: compactString(providerReceiptReplayGuard.guardKey),
      guardState: compactString(providerReceiptReplayGuard.state),
      receiptId: compactString(provider.receipt?.receiptId),
      externalRequestId: compactString(provider.receipt?.externalRequestId || provider.externalRequestId),
      acknowledged: provider.receipt?.acknowledged === true,
      acknowledgedAt: compactString(provider.receipt?.acknowledgedAt),
      required: provider.receipt?.required === true,
      ready: providerEvidenceReady && providerReceiptReplayGuard.ready !== false,
      restartSafe: provider.receipt?.restartSafe !== false
        && providerReceiptEvidence.restartSafe !== false
        && providerReceiptReplayGuard.restartSafe !== false,
      replaySafe: providerReceiptReplayGuard.replaySafe === true
        || (providerReceiptEvidence.replaySafe === true && providerReceiptReplayGuard.ready !== false),
      blockedReasons: stableList([
        ...(provider.receipt?.blockedReasons || []),
        ...providerEvidenceMissing,
        ...stableList(providerReceiptReplayGuard.blockedReasons).map((reason) => `guard:${reason}`),
      ]),
      route: providerReceiptReplayGuard.route || providerReceiptEvidence.route || null,
      clientPatch: {
        ...(providerReceiptEvidence.clientPatch || {}),
        ...(providerReceiptReplayGuard.clientPatch || {}),
      },
      nextAction: compactString(
        providerReceiptReplayGuard.nextAction
          || providerReceiptEvidence.nextAction
          || provider.nextAction
          || 'refresh_provider_receipt',
      ),
      audit: provider.receipt?.audit || null,
    },
    adapterDispatchReadiness: {
      protocol: adapterDispatchReadiness.protocol || 'aios.adapter-dispatch-readiness.mailchimp.v1',
      readinessKey: compactString(adapterDispatchReadiness.readinessKey),
      state: compactString(adapterDispatchReadiness.state || 'unknown'),
      ready: adapterDispatchReadiness.ready === true,
      dispatchReady: adapterDispatchReadiness.dispatchReady === true,
      queueReady: adapterDispatchReadiness.queueReady === true,
      externalWrite: adapterDispatchReadiness.externalWrite === true,
      nextAction: compactString(adapterDispatchReadiness.nextAction || 'repair_mailchimp_dispatch_readiness'),
      blockedReasons: stableList(adapterDispatchReadiness.blockedReasons),
      route: adapterDispatchReadiness.route || null,
      acceptance: adapterDispatchReadiness.acceptance || null,
      restartSemantics: adapterDispatchReadiness.restartSemantics || null,
    },
    persistedCommandEvidence: {
      protocol: persistedCommandEvidence.protocol || 'aios.recovery-persisted-command-evidence.mailchimp.v1',
      evidenceKey: persistedCommandResumeKey,
      state: compactString(persistedCommandEvidence.state || (persistedCommandReady ? 'ready' : 'blocked')),
      ready: persistedCommandReady,
      replaySafe: persistedCommandEvidence.replaySafe !== false,
      restartSafe: persistedCommandEvidence.restartSafe !== false,
      nextAction: persistedCommandNextAction || (persistedCommandReady ? 'observe' : 'repair_persisted_command_evidence'),
      blockedReasons: persistedCommandBlockedReasons,
      commandId: compactString(persistedCommandEvidence.commandId || clientCommand.commandId),
      commandKey: compactString(persistedCommandEvidence.commandKey || clientCommand.idempotencyKey),
      externalWrite: persistedCommandEvidence.externalWrite === true || clientCommand.externalWrite === true,
      externalHandoff: {
        requestId: compactString(
          persistedCommandEvidence.externalHandoff?.requestId
            || clientCommand.provider?.externalRequestId
            || provider.externalRequestId,
        ),
        receiptId: compactString(persistedCommandEvidence.externalHandoff?.receiptId || provider.receipt?.receiptId),
        acknowledged: persistedCommandEvidence.externalHandoff?.acknowledged === true
          || provider.receipt?.acknowledged === true,
      },
      route: persistedCommandEvidence.route || {
        target: 'recovery-persisted-command-evidence',
        idempotencyKey: persistedCommandResumeKey,
        primaryAction: persistedCommandNextAction || 'repair_persisted_command_evidence',
      },
      restartSemantics: persistedCommandEvidence.restartSemantics || {
        replaySafe: persistedCommandEvidence.replaySafe !== false && persistedCommandReady,
        duplicateCommandPolicy: 'dedupe-by-recovery-persisted-command-evidence-key',
        resumeFromPersistedCommandEvidenceKey: persistedCommandResumeKey,
        externalWritesPerformed: false,
      },
    },
    clientWorkflowHandoff,
    clientReadinessDecision,
    lifecycleCommandCheckpoint: {
      protocol: lifecycleCommandCheckpoint.protocol || 'aios.compile-cache-lifecycle-command-checkpoint.mailchimp.v1',
      checkpointKey: compactString(lifecycleCommandCheckpoint.checkpointKey),
      observed: lifecycleCommandCheckpoint.observed === true,
      state: compactString(lifecycleCommandCheckpoint.state || 'unobserved'),
      requestedCommand: compactString(lifecycleCommandCheckpoint.requestedCommand),
      submitAction: compactString(lifecycleCommandCheckpoint.submitAction),
      idempotencyKey: compactString(lifecycleCommandCheckpoint.idempotencyKey),
      commandId: compactString(lifecycleCommandCheckpoint.commandId),
      acknowledged: lifecycleCommandCheckpoint.acknowledged === true,
      restartSafe: lifecycleCommandCheckpoint.restartSafe !== false,
      replaySafe: lifecycleCommandCheckpoint.replaySafe !== false,
      externalWrite: lifecycleCommandCheckpoint.externalWrite === true,
      nextAction: compactString(lifecycleCommandCheckpoint.nextAction || 'observe'),
      blockedReasons: stableList(lifecycleCommandCheckpoint.blockedReasons),
      controls: lifecycleCommandCheckpoint.controls || null,
      schedule: lifecycleCommandCheckpoint.schedule || null,
      clientPatch: lifecycleCommandCheckpoint.clientPatch || null,
      restartSemantics: lifecycleCommandCheckpoint.restartSemantics || null,
    },
    lifecycleControlPlane: {
      protocol: lifecycleControlPlane.protocol || 'aios.compile-cache-lifecycle-control-plane.mailchimp.v1',
      controlKey: compactString(lifecycleControlPlane.controlKey),
      state: lifecycleControlPlaneState,
      routeState: compactString(lifecycleControlPlane.routeState || 'unknown'),
      readyForRuntimeReuse: lifecycleControlPlane.readyForRuntimeReuse !== false && lifecycleControlPlaneBlocked !== true,
      readyForMutation: lifecycleControlPlane.readyForMutation === true,
      commandAccepted: lifecycleControlPlane.commandAccepted !== false && lifecycleControlPlaneBlocked !== true,
      requestedCommand: compactString(lifecycleControlPlane.requestedCommand),
      candidateCommand: compactString(lifecycleControlPlane.candidateCommand),
      primaryAction: compactString(lifecycleControlPlane.primaryAction || lifecycleControlPlane.nextAction),
      nextAction: compactString(lifecycleControlPlane.nextAction || 'observe'),
      schedule: lifecycleControlPlane.schedule || null,
      controls: lifecycleControlPlane.controls || null,
      mutations: lifecycleControlPlane.mutations || null,
      diagnostics: lifecycleControlPlane.diagnostics || null,
      blockedReasons: lifecycleControlPlaneBlockedReasons,
      deferredReasons: lifecycleControlPlaneDeferredReasons,
      clientPatch: lifecycleControlPlane.clientPatch || null,
      restartSemantics: lifecycleControlPlane.restartSemantics || {
        replaySafe: lifecycleControlPlaneBlocked !== true,
        duplicateCommandPolicy: 'dedupe-by-compile-cache-lifecycle-control-key',
        resumeFromLifecycleControlKey: compactString(lifecycleControlPlane.controlKey),
        externalWritesPerformed: false,
      },
    },
    boundaryCheckpoint: {
      state: compactString(boundaryCheckpoint.state || 'unknown'),
      ready: boundaryCheckpoint.ready === true,
      restartSafe: boundaryCheckpoint.restartSafe !== false,
      replayAllowed: boundaryCheckpoint.replayAllowed !== false,
      nextAction: compactString(boundaryCheckpoint.nextAction || 'repair_tenant_permissions'),
      tenant: compactString(boundaryCheckpoint.tenant),
      workspace: compactString(boundaryCheckpoint.workspace),
      runtimeTenant: compactString(boundaryCheckpoint.runtimeTenant),
      runtimeWorkspace: compactString(boundaryCheckpoint.runtimeWorkspace),
      blockedReasons: stableList(boundaryCheckpoint.blockedReasons),
      audit: boundaryCheckpoint.audit || null,
      auditHandoff: boundaryAuditHandoff,
      clientPatch: {
        ...(boundaryCheckpoint.clientPatch || {}),
        ...boundaryAuditHandoff.clientPatch,
      },
    },
    replayBarrier: {
      open: replayBarrier.open === true,
      restartSafe: replayBarrier.restartSafe === true,
      canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor === true,
      nextAction: compactString(replayBarrier.nextAction),
      recoveryCommand: compactString(replayBarrier.recoveryCommand),
      blockedReasons: stableList(replayBarrier.blockedReasons),
      retry: {
        attempts: Number(replayBarrier.retry?.attempts || operationalHealth.retry?.attempts || 0),
        maxAttempts: Number(replayBarrier.retry?.maxAttempts || operationalHealth.retry?.maxAttempts || 1),
        retryAfterMs: Number(replayBarrier.retry?.retryAfterMs || operationalHealth.retry?.retryAfterMs || 0),
        exhausted: replayBarrier.retry?.exhausted === true || compileCache.retryExhausted === true,
      },
      healthState: compactString(operationalHealth.state),
    },
    resumeGate: {
      ready: resumeGate.ready === true,
      replaySafe: resumeGate.replaySafe === true,
      restartSafe: resumeGate.restartSafe === true,
      routeState: compactString(resumeGate.routeState || 'unknown'),
      nextAction: compactString(resumeGate.nextAction || 'inspect_compile_cache_resume_gate'),
      recoveryCommand: compactString(resumeGate.recoveryCommand || resumeGate.nextAction),
      failureState: compactString(resumeGate.failureState),
      blockedReasons: stableList(resumeGate.blockedReasons),
      acceptance: resumeGate.acceptance || null,
      retry: resumeGate.retry || null,
    },
    resumeEvidenceHandoff: {
      protocol: resumeEvidenceHandoff.protocol || 'aios.compile-cache-resume-evidence-handoff.mailchimp.v1',
      state: compactString(resumeEvidenceHandoff.state || 'unknown'),
      ready: resumeEvidenceHandoff.ready === true,
      restartSafe: resumeEvidenceHandoff.restartSafe !== false,
      replaySafe: resumeEvidenceHandoff.replaySafe === true,
      nextAction: compactString(resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'),
      recoveryCommand: compactString(resumeEvidenceHandoff.recoveryCommand || resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'),
      missingEvidence: stableList(resumeEvidenceHandoff.missingEvidence),
      evidence: resumeEvidenceHandoff.evidence || null,
      route: resumeEvidenceHandoff.route || null,
    },
    clientResumePacket: {
      protocol: clientResumePacket.protocol || 'aios.compile-cache-client-resume-packet.mailchimp.v1',
      packetId: compactString(clientResumePacket.packetId),
      state: compactString(clientResumePacket.state || 'unknown'),
      readyForClientRuntime: clientResumePacket.readyForClientRuntime === true,
      readyForRuntimeReplay: clientResumePacket.readyForRuntimeReplay === true,
      nextAction: compactString(clientResumePacket.nextAction || 'review_compile_cache_status'),
      resumeToken: compactString(clientResumePacket.resumeToken),
      statusRevision: compactString(clientResumePacket.statusRevision),
      retry: {
        retryable: clientResumePacket.retry?.retryable === true,
        retryAfterMs: Number(clientResumePacket.retry?.retryAfterMs || 0),
        maxAttempts: Number(clientResumePacket.retry?.maxAttempts || 0),
        nextAction: compactString(clientResumePacket.retry?.nextAction || clientResumePacket.nextAction),
        exhausted: clientResumePacket.retry?.exhausted === true,
      },
      acceptance: clientResumePacket.acceptance || null,
      evidence: clientResumePacket.evidence || null,
      counters: clientResumePacket.counters || {},
      blockedReasons: stableList(clientResumePacket.blockedReasons),
      route: clientResumePacket.route || null,
      exportRow: clientResumePacket.exportRow || null,
      clientPatch: clientResumePacket.clientPatch || null,
      restartSemantics: clientResumePacket.restartSemantics || null,
    },
    replayCommandBundle: {
      protocol: replayCommandBundle.protocol || 'aios.compile-cache-replay-command-bundle.mailchimp.v1',
      bundleKey: compactString(replayCommandBundle.bundleKey),
      status: compactString(replayCommandBundle.status || (replayBundleBlocked ? 'blocked' : 'unknown')),
      ready: replayCommandBundle.ready === true,
      nextAction: replayBundleNextAction || 'review_compile_cache_status',
      recoveryCommand: compactString(replayCommandBundle.recoveryCommand || replayBundleNextAction || 'observe'),
      nextCommandId: compactString(replayCommandBundle.nextCommandId),
      idempotencyKey: compactString(replayCommandBundle.idempotencyKey || replayCommandBundle.bundleKey),
      counters: {
        commands: Number(replayCommandBundle.counters?.commands || replayBundleRows.length),
        ready: Number(replayCommandBundle.counters?.ready || 0),
        waiting: Number(replayCommandBundle.counters?.waiting || 0),
        blocked: Number(replayCommandBundle.counters?.blocked || 0),
        retryable: Number(replayCommandBundle.counters?.retryable || 0),
      },
      blockedReasons: replayBundleBlockedReasons,
      timeline: replayCommandBundle.timeline || null,
      exportSummary: replayCommandBundle.exportSummary || null,
      clientPatch: replayCommandBundle.clientPatch || null,
      restartSemantics: replayCommandBundle.restartSemantics || null,
      rows: replayBundleRows.map((row) => ({
        rowId: compactString(row.rowId),
        commandId: compactString(row.commandId),
        command: compactString(row.command || row.action || row.nextAction),
        owner: compactString(row.owner || 'runtime'),
        phase: compactString(row.phase || 'recovery'),
        status: compactString(row.status || 'waiting'),
        reason: compactString(row.reason),
        restartSafe: row.restartSafe !== false,
        replaySafe: row.replaySafe === true,
        idempotencyKey: compactString(row.idempotencyKey),
        resumeToken: compactString(row.resumeToken),
        blockedReasons: stableList(row.blockedReasons),
      })),
    },
    clientExportTimeline: {
      protocol: clientExportTimeline.protocol || 'aios.recovery-client-export-timeline.mailchimp.v1',
      timelineKey: compactString(clientExportTimeline.timelineKey),
      status: compactString(clientExportTimeline.status || (clientExportTimelineBlocked ? 'blocked' : 'unknown')),
      ready: clientExportTimeline.ready === true && clientExportTimelineBlocked === false,
      readyForClient: clientExportTimeline.readyForClient === true,
      readyForRuntimeReplay: clientExportTimeline.readyForRuntimeReplay === true,
      nextAction: clientExportTimelineNextAction || 'review_compile_cache_client_export_timeline',
      nextRowId: compactString(clientExportTimeline.nextRowId || clientExportTimelineBlockedRows[0]?.rowId),
      counters: {
        rows: Number(clientExportTimeline.counters?.rows || clientExportTimelineRows.length),
        readyRows: Number(clientExportTimeline.counters?.readyRows || clientExportTimelineRows.filter((row) => row.ready === true).length),
        blockedRows: Number(clientExportTimeline.counters?.blockedRows || clientExportTimelineBlockedRows.length),
        waitingRows: Number(clientExportTimeline.counters?.waitingRows || clientExportTimelineRows.filter((row) => row.status === 'waiting').length),
      },
      route: clientExportTimeline.route || null,
      exportSummary: clientExportTimeline.exportSummary || null,
      clientPatch: clientExportTimeline.clientPatch || null,
      restartSemantics: clientExportTimeline.restartSemantics || null,
      rows: clientExportTimelineRows.map((row) => ({
        rowId: compactString(row.rowId || row.id),
        phase: compactString(row.phase),
        source: compactString(row.source),
        status: compactString(row.status || (row.ready === false ? 'blocked' : 'ready')),
        ready: row.ready === true,
        required: row.required !== false,
        nextAction: compactString(row.nextAction),
        idempotencyKey: compactString(row.idempotencyKey),
        resumeToken: compactString(row.resumeToken),
        blockedReasons: stableList(row.blockedReasons),
      })),
    },
    acceptanceChecklist: {
      state: compactString(acceptanceChecklist.state || 'review'),
      ready: acceptanceChecklist.ready === true,
      nextAction: compactString(acceptanceChecklist.nextAction || acceptanceChecklist.route?.primaryAction || 'review_compile_cache_status'),
      acceptanceToken: compactString(acceptanceChecklist.acceptance?.token || acceptanceChecklist.route?.acceptanceToken),
      counts: acceptanceChecklist.counts || {},
      blockingItems: Array.isArray(acceptanceChecklist.blockingItems)
        ? acceptanceChecklist.blockingItems
        : [],
      route: acceptanceChecklist.route || null,
    },
    persistedReplay: {
      state: compactString(persistedReplay.state || 'unknown'),
      restartSafe: persistedReplay.restartSafe === true,
      replaySafe: persistedReplay.replaySafe === true,
      nextAction: compactString(persistedReplay.nextAction),
      idempotencyKey: compactString(persistedReplay.idempotencyKey),
      retryKey: compactString(persistedReplay.retryKey),
      replayKey: compactString(persistedReplay.replayKey),
      blockedReasons: stableList(persistedReplay.blockedReasons),
      recovery: persistedReplay.recovery || null,
    },
    clientCommand: {
      protocol: clientCommand.protocol || 'aios.adapter-client-command.mailchimp.v1',
      commandId: compactString(clientCommand.commandId),
      state: compactString(clientCommand.state || 'unknown'),
      routeState: compactString(clientCommand.routeState || 'unknown'),
      requestedAction: compactString(clientCommand.requestedAction),
      submitAction: compactString(clientCommand.submitAction),
      idempotencyKey: compactString(clientCommand.idempotencyKey),
      restartSafe: clientCommand.restartSafe === true,
      externalWrite: clientCommand.externalWrite === true,
      blockedReasons: stableList(clientCommand.validationSummary?.blockedReasons),
      preview: clientCommand.preview || null,
    },
    compileCache: {
      cacheKey: compactString(compileCache.cacheKey),
      status: compactString(compileCache.status),
      replaySafe: compileCache.replaySafe === true,
      refreshRequired: compileCache.refreshRequired === true,
      controlsRequired: compileCache.controlsRequired === true,
      reportReviewRequired: compileCache.reportReviewRequired === true,
      boundaryRepairRequired: compileCache.boundaryRepairRequired === true,
      boundaryRestartSafe: compileCache.boundaryRestartSafe !== false,
      boundaryReplayAllowed: compileCache.boundaryReplayAllowed !== false,
      barrierClosed: compileCache.barrierClosed === true,
      retryExhausted: compileCache.retryExhausted === true,
      persistedRestartSafe: compileCache.persistedRestartSafe !== false,
      persistedReplaySafe: compileCache.persistedReplaySafe === true,
      operationalHealthState: compactString(operationalHealth.state),
      resumeGateState: compactString(resumeGate.routeState || (resumeGate.ready ? 'ready' : 'unknown')),
      resumeGateNextAction: compactString(resumeGate.nextAction),
      resumeEvidenceState: compactString(resumeEvidenceHandoff.state || 'unknown'),
      resumeEvidenceReady: resumeEvidenceHandoff.ready === true,
      resumeEvidenceNextAction: compactString(resumeEvidenceHandoff.nextAction),
      resumeEvidenceMissing: stableList(resumeEvidenceHandoff.missingEvidence),
      clientResumeState: compactString(clientResumePacket.state || 'unknown'),
      clientResumeReady: clientResumePacket.readyForClientRuntime === true,
      clientResumeReplayReady: clientResumePacket.readyForRuntimeReplay === true,
      clientResumeNextAction: compactString(clientResumePacket.nextAction),
      clientResumeBlockedReasons: stableList(clientResumePacket.blockedReasons),
      replayCommandBundleStatus: compactString(replayCommandBundle.status),
      replayCommandBundleReady: replayCommandBundle.ready === true,
      replayCommandBundleNextAction: replayBundleNextAction,
      replayCommandBundleBlockedRows: Number(replayCommandBundle.counters?.blocked || 0),
      acceptanceChecklistState: compactString(acceptanceChecklist.state || 'review'),
      acceptanceChecklistNextAction: compactString(acceptanceChecklist.nextAction || acceptanceChecklist.route?.primaryAction),
      lifecycleCommandState: compactString(lifecycleCommandCheckpoint.state || 'unobserved'),
      lifecycleCommandNextAction: compactString(lifecycleCommandCheckpoint.nextAction),
      lifecycleCommandRestartSafe: lifecycleCommandCheckpoint.restartSafe !== false,
      uiPrimaryAction: compactString(routeHints.primaryAction),
      uiStatusRouteState: compactString(routeHints.statusRouteState),
      exportPackageId: compactString(exportPackage.packageId),
      exportPackageReady: exportPackage.exportReady === true,
      exportPackageNextAction: compactString(exportPackage.nextAction),
      recoveryLaneStatus: compactString(recoveryExportLane.status),
      recoveryLaneReady: recoveryExportLane.exportReady !== false,
      recoveryLaneNextAction: compactString(recoveryExportLane.nextAction),
      recoveryLaneBlockedRows: Number(recoveryExportLane.counters?.blockedRows || 0),
    },
    resume: {
      command: replaySafe
        ? 'resume_after_checkpoint'
        : (compileCache.checklistBlocked
          ? acceptanceChecklist.route?.recoveryCommand
            || acceptanceChecklist.nextAction
            || acceptanceChecklist.route?.primaryAction
          : '')
        || (adapterDispatchReadiness.ready === false
          ? adapterDispatchReadiness.nextAction
          : '')
        || (resumeEvidenceHandoff.ready === false
          ? resumeEvidenceHandoff.recoveryCommand || resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'
          : '')
        || (clientResumePacket.readyForClientRuntime === false
          ? clientResumePacket.nextAction || 'review_compile_cache_status'
          : '')
        || (persistedCommandReady === false
          ? persistedCommandNextAction || 'repair_persisted_command_evidence'
          : '')
        || (replayBundleBlocked
          ? replayBundleNextAction || 'review_compile_cache_replay_commands'
          : '')
          || (compileCache.lifecycleCommandBlocked
            ? lifecycleCommandCheckpoint.nextAction
              || (compileCache.lifecycleCommandHeld ? 'await_lifecycle_release' : 'repair_compile_cache_lifecycle_settings')
            : '')
          || (boundaryHandoff.readyForRuntime === false
            ? boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'repair_tenant_permissions'
            : '')
          || (boundaryHandoff.requiresAuditAppend === true && boundaryHandoff.auditAppendReady !== true
            ? boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'append_tenant_boundary_audit'
            : '')
          || resumeGate.recoveryCommand
          || barrierResumeCommand
          || routeHints.recoveryCommand
          || clientCommand.submitAction
          || steps[0]?.action
          || settings.command
          || 'observe',
      nextStep: (compileCache.checklistBlocked
        ? acceptanceChecklist.nextAction || acceptanceChecklist.route?.primaryAction
        : '')
        || (adapterDispatchReadiness.ready === false
          ? adapterDispatchReadiness.nextAction
          : '')
        || (resumeEvidenceHandoff.ready === false
          ? resumeEvidenceHandoff.nextAction || 'inspect_compile_cache_resume_evidence'
          : '')
        || (clientResumePacket.readyForClientRuntime === false
          ? clientResumePacket.nextAction || 'review_compile_cache_status'
          : '')
        || (persistedCommandReady === false
          ? persistedCommandNextAction || 'repair_persisted_command_evidence'
          : '')
        || (replayBundleBlocked
          ? replayBundleNextAction || 'review_compile_cache_replay_commands'
          : '')
        || (compileCache.lifecycleCommandBlocked
          ? lifecycleCommandCheckpoint.nextAction
            || (compileCache.lifecycleCommandHeld ? 'await_lifecycle_release' : 'repair_compile_cache_lifecycle_settings')
          : '')
        || (boundaryHandoff.readyForRuntime === false
          ? boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'repair_tenant_permissions'
          : '')
        || (boundaryHandoff.requiresAuditAppend === true && boundaryHandoff.auditAppendReady !== true
          ? boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'append_tenant_boundary_audit'
          : '')
        || resumeGate.nextAction
        || clientCommand.submitAction
        || nextSteps[0]?.action
        || steps[0]?.action
        || 'observe',
      blockedReasons: restartBlockedReasons,
      explain: restartBlockedReasons.length === 0
        ? 'Recovery state is restart-safe and can resume with the persisted command key.'
        : 'Recovery state is persisted but must clear blocked reasons before replay.',
    },
  };
}

function chooseRecoveryAction(diagnostic, status) {
  if (RECOVERABLE_CODES.has(diagnostic.code)) return RECOVERABLE_CODES.get(diagnostic.code);
  if (diagnostic.field === 'permissionBoundary') {
    return status.permissionHealth?.nextAction || status.permissionBoundary?.nextAction || 'repair_tenant_permissions';
  }
  if (diagnostic.code === 'mailchimp.status.compile_cache_replay_barrier_closed') {
    return status.compileCache?.replayBarrier?.recoveryCommand
      || status.compileCache?.replayBarrier?.nextAction
      || 'refresh_compile_cache';
  }
  if (diagnostic.code === 'mailchimp.status.compile_cache_operational_health_degraded') {
    return status.compileCache?.operationalHealth?.nextAction
      || status.compileCache?.replayBarrier?.nextAction
      || 'refresh_compile_cache';
  }
  if (status.provider?.leaseState === 'expired' || status.provider?.leaseState === 'missing_token') return 'refresh_provider_lease';
  if (status.provider?.receiptRequired === true && status.provider?.receiptAcknowledged !== true) return 'refresh_provider_receipt';
  if (status.provider?.externalHandoffState !== 'local_only' && !status.provider?.externalRequestId) return 'relink_external_handoff';
  if (diagnostic.severity === 'error' && status.dryRun) return 'repair_descriptor_before_dispatch';
  if (diagnostic.severity === 'error') return 'hold_for_operator';
  if (status.state === 'waiting_for_verifier') return 'collect_verifier_evidence';
  return 'observe';
}

export function classifyMailchimpRecovery(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const status = buildMailchimpStatusSnapshot(descriptor, runtime);
  const summary = summarizeMailchimpStatus(status);
  const diagnostics = stableDiagnostics(status.diagnostics);
  const recoveryItems = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    action: chooseRecoveryAction(diagnostic, status),
    field: diagnostic.field,
    message: diagnostic.message,
  }));

  if (summary.canRecover && recoveryItems.length === 0) {
    recoveryItems.push({
      code: 'mailchimp.recovery.state_requires_attention',
      severity: 'warning',
      action: status.state === 'waiting_for_verifier' ? 'collect_verifier_evidence' : 'inspect_runtime_events',
      field: 'state',
      message: `Mailchimp handoff is ${status.state}.`,
    });
  }

  const requiresRollback = recoveryItems.some((item) => item.action === 'hold_for_operator')
    && descriptor.truthBoundary?.externalWritesAllowed === true;
  const providerRecovery = buildProviderRecoveryContract(summary);
  const compileCacheRecovery = buildCompileCacheRecoveryContract(summary);
  const permissionBoundary = summary.permissionBoundary || {};
  const tenantPermissionDecisionBundle = summary.tenantPermissionDecisionBundle
    || descriptor.tenantPermissionDecisionBundle
    || {};
  const tenantBoundaryAuditEnvelope = summary.tenantBoundaryAuditEnvelope
    || status.tenantBoundaryAuditEnvelope
    || descriptor.tenantBoundaryAuditEnvelope
    || {};
  const adapterDispatchReadiness = descriptor.adapterDispatchReadiness || {};
  const adapterNextStepHandoff = summary.adapterNextStepHandoff
    || status.adapterNextStepHandoff
    || descriptor.nextStepHandoff
    || {};
  const decisionPersistenceEnvelope = status.decisionPersistenceEnvelope
    || summary.decisionPersistenceEnvelope
    || buildMailchimpStatusDecisionPersistenceEnvelope(status, runtime);
  const persistedResumeGuard = buildMailchimpRecoveryPersistedResumeGuard(status, runtime);
  const providerReceiptReplayGuard = buildProviderReceiptReplayGuard(
    providerRecovery,
    adapterDispatchReadiness,
    summary,
  );
  const boundaryHandoff = descriptor.boundaryHandoff || summary.tenantBoundaryHandoff || {};
  const boundaryContinuity = summary.tenantBoundaryContinuity
    || status.tenantBoundaryContinuity
    || descriptor.tenantBoundaryContinuity
    || {};
  if (boundaryContinuity.ready === false) {
    recoveryItems.push({
      code: 'mailchimp.recovery.tenant_boundary_continuity',
      severity: boundaryContinuity.state === 'waiting_for_audit' ? 'warning' : 'error',
      action: boundaryContinuity.nextAction || 'repair_tenant_permissions',
      field: 'tenantBoundaryContinuity',
      message: `Mailchimp tenant boundary continuity is ${boundaryContinuity.state || 'blocked'}.`,
    });
  }

  return {
    protocol: 'aios.recovery-handoff.mailchimp.v1',
    requestId: descriptor.requestId,
    adapter: 'mailchimp',
    action: descriptor.action,
    tenant: descriptor.tenant,
    recoverable: recoveryItems.some((item) => item.action !== 'hold_for_operator'),
    requiresRollback,
    status: summary,
    providerRecovery,
    providerReceiptReplayGuard,
    compileCacheRecovery,
    permissionBoundary,
    tenantPermissionDecisionBundle,
    tenantBoundaryAuditEnvelope,
    boundaryHandoff,
    boundaryContinuity,
    adapterDispatchReadiness,
    adapterNextStepHandoff,
    decisionPersistenceEnvelope,
    persistedResumeGuard,
    recoveryItems,
    truthBoundary: {
      level: descriptor.truthBoundary?.level || 'unknown',
      externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true,
      recoveryMayWriteExternally: false,
      reason: 'Recovery plans are local descriptors; external writes remain adapter-gated.',
    },
  };
}

export function buildMailchimpRecoveryDecisionReplayGuard(recovery = {}, settings = {}) {
  const decision = recovery.decisionPersistenceEnvelope || {};
  const adapterDecision = decision.adapterDecision || {};
  const acceptance = adapterDecision.acceptance || {};
  const persistence = decision.persistence || {};
  const command = decision.command || {};
  const acceptanceRequired = acceptance.required === true
    || decision.validationSummary?.acceptanceRequired === true;
  const acceptanceAccepted = acceptance.accepted === true
    || decision.validationSummary?.acceptanceAccepted === true;
  const persistedReady = persistence.restartSafe !== false
    && persistence.writeAllowed !== false
    && decision.validationSummary?.persistedReady !== false;
  const commandRestartSafe = command.restartSafe !== false;
  const replaySafe = decision.ready === true
    && commandRestartSafe
    && persistedReady
    && (!acceptanceRequired || acceptanceAccepted);
  const blockedReasons = stableList([
    ...stableList(decision.blockedReasons),
    ...(decision.ready === false ? ['status_decision_persistence_not_ready'] : []),
    ...(adapterDecision.readyForRuntime === false ? ['adapter_decision_not_runtime_ready'] : []),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance_required'] : []),
    ...(persistedReady ? [] : ['persisted_status_not_restart_safe']),
    ...(commandRestartSafe ? [] : ['decision_command_not_restart_safe']),
    ...(settings.enabled === false ? ['recovery_controls_disabled'] : []),
  ]);
  const state = blockedReasons.length === 0
    ? 'ready_for_replay'
    : blockedReasons.includes('operator_acceptance_required')
      ? 'waiting_for_acceptance'
      : blockedReasons.includes('persisted_status_not_restart_safe')
        ? 'waiting_for_status_persistence'
        : 'blocked';
  const nextAction = state === 'ready_for_replay'
    ? command.requested || decision.nextAction || 'resume_after_status_decision'
    : state === 'waiting_for_acceptance'
      ? 'request_operator_acceptance'
      : state === 'waiting_for_status_persistence'
        ? decision.nextAction || 'persist_status_snapshot'
        : decision.nextAction || recovery.adapterNextStepHandoff?.primaryAction || 'inspect_status_decision';
  const guardKey = `mailchimp-recovery-decision-replay:${[
    recovery.requestId || decision.requestId || 'handoff',
    decision.persistenceKey || adapterDecision.envelopeKey || 'decision',
    state,
  ].map(compactString).filter(Boolean).join(':')}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.recovery-decision-replay-guard.mailchimp.v1',
    guardKey,
    requestId: compactString(recovery.requestId || decision.requestId),
    tenant: compactString(recovery.tenant || decision.tenant),
    action: compactString(recovery.action || decision.action),
    state,
    ready: blockedReasons.length === 0,
    replaySafe,
    restartSafe: persistedReady && commandRestartSafe,
    nextAction,
    blockedReasons,
    decision: {
      persistenceKey: compactString(decision.persistenceKey),
      state: compactString(decision.state),
      readyForPersistence: decision.readyForPersistence === true,
      nextAction: compactString(decision.nextAction),
      route: decision.route || null,
    },
    adapterDecision: {
      envelopeKey: compactString(adapterDecision.envelopeKey),
      state: compactString(adapterDecision.state),
      readyForPreview: adapterDecision.readyForPreview === true,
      readyForRuntime: adapterDecision.readyForRuntime === true,
      acceptance,
    },
    persistence: {
      persisted: persistence.persisted === true,
      restartSafe: persistence.restartSafe !== false,
      replaySafe: persistence.replaySafe === true,
      snapshotKey: compactString(persistence.snapshotKey),
      nextCommandKey: compactString(persistence.nextCommandKey),
    },
    route: {
      target: 'recovery-decision-replay-guard',
      method: 'POST',
      idempotencyKey: guardKey,
      primaryAction: nextAction,
      requiredBodyKeys: state === 'waiting_for_acceptance'
        ? ['guardKey', 'acceptanceToken', 'accepted']
        : ['guardKey', 'requestId'],
    },
    clientPatch: {
      recoveryDecisionReplayGuardKey: guardKey,
      recoveryDecisionReplayGuardState: state,
      recoveryDecisionReplayGuardReady: blockedReasons.length === 0,
      recoveryDecisionReplayGuardNextAction: nextAction,
      recoveryDecisionReplayGuardBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe,
      duplicateCommandPolicy: 'dedupe-by-recovery-decision-replay-guard-key',
      resumeFromDecisionReplayGuardKey: guardKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpRecoveryPlan(input = {}, runtime = {}) {
  const recovery = classifyMailchimpRecovery(input, runtime);
  const settings = normalizeRecoverySettings(runtime.recoverySettings || runtime.settings || {});
  const decisionReplayGuard = buildMailchimpRecoveryDecisionReplayGuard(recovery, settings);
  const steps = recovery.recoveryItems.map((item, index) => ({
    index: index + 1,
    action: item.action,
    code: item.code,
    localOnly: true,
    requiresOperator: item.action === 'hold_for_operator',
    writesExternalSystem: false,
  }));

  if (steps.length === 0) {
    steps.push({
      index: 1,
      action: 'observe',
      code: 'mailchimp.recovery.noop',
      localOnly: true,
      requiresOperator: false,
      writesExternalSystem: false,
    });
  }

  if (recovery.providerRecovery.refreshRequired) {
    const providerAction = recovery.providerRecovery.providerContinuity?.holdExternalWrite === true
      ? recovery.providerRecovery.providerContinuity.nextAction || 'hold_for_provider_recovery'
      : recovery.providerRecovery.nextAction;
    const alreadyPlanned = steps.some((step) => step.action === providerAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: providerAction,
        code: `mailchimp.recovery.${providerAction}`,
        localOnly: true,
        requiresOperator: providerAction === 'relink_external_handoff' || providerAction === 'hold_for_provider_recovery',
        writesExternalSystem: false,
        evidence: {
          providerState: recovery.providerRecovery.providerState,
          externalHandoffState: recovery.providerRecovery.externalHandoffState,
          leaseState: recovery.providerRecovery.leaseState,
          continuityMode: recovery.providerRecovery.providerContinuity?.mode || 'unknown',
          continuityReasons: recovery.providerRecovery.providerContinuity?.degradedReasons || [],
        },
      });
    }
  }

  if (recovery.providerRecovery.receipt?.required === true
    && recovery.providerRecovery.receipt?.acknowledged !== true) {
    const receiptAction = 'refresh_provider_receipt';
    const alreadyPlanned = steps.some((step) => step.action === receiptAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: receiptAction,
        code: 'mailchimp.recovery.refresh_provider_receipt',
        localOnly: true,
        requiresOperator: false,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.providerReceiptReplayGuard?.ready === false) {
    const guardAction = recovery.providerReceiptReplayGuard.nextAction || 'refresh_provider_receipt';
    const alreadyPlanned = steps.some((step) => step.action === guardAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: guardAction,
        code: `mailchimp.recovery.${guardAction}`,
        localOnly: true,
        requiresOperator: guardAction === 'relink_external_handoff'
          || guardAction === 'hold_for_provider_recovery',
        writesExternalSystem: false,
        evidence: {
          guardKey: recovery.providerReceiptReplayGuard.guardKey,
          state: recovery.providerReceiptReplayGuard.state,
          linked: recovery.providerReceiptReplayGuard.linked,
          receiptRequired: recovery.providerReceiptReplayGuard.receiptRequired,
          receiptAcknowledged: recovery.providerReceiptReplayGuard.receiptAcknowledged,
          blockedReasons: recovery.providerReceiptReplayGuard.blockedReasons,
        },
      });
    }
  }

  if (recovery.persistedResumeGuard?.ready === false) {
    const resumeGuardAction = recovery.persistedResumeGuard.nextAction || 'repair_runtime_resume_ticket';
    const alreadyPlanned = steps.some((step) => step.action === resumeGuardAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: resumeGuardAction,
        code: 'mailchimp.recovery.persisted_resume_guard',
        localOnly: true,
        requiresOperator: resumeGuardAction === 'repair_tenant_permissions'
          || resumeGuardAction === 'hold_for_operator',
        writesExternalSystem: false,
        evidence: {
          guardKey: recovery.persistedResumeGuard.guardKey,
          ticketKey: recovery.persistedResumeGuard.ticketKey,
          state: recovery.persistedResumeGuard.state,
          restartSafe: recovery.persistedResumeGuard.restartSafe,
          replaySafe: recovery.persistedResumeGuard.replaySafe,
          blockedReasons: recovery.persistedResumeGuard.blockedReasons,
        },
      });
    }
  }

  if (recovery.permissionBoundary?.allowed === false) {
    const permissionAction = recovery.permissionBoundary.nextAction || 'repair_tenant_permissions';
    const alreadyPlanned = steps.some((step) => step.action === permissionAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: permissionAction,
        code: `mailchimp.recovery.${permissionAction}`,
        localOnly: true,
        requiresOperator: true,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.tenantPermissionDecisionBundle?.ready === false) {
    const permissionDecisionAction = recovery.tenantPermissionDecisionBundle.nextAction
      || recovery.tenantPermissionDecisionBundle.route?.primaryAction
      || 'repair_tenant_permissions';
    const alreadyPlanned = steps.some((step) => step.action === permissionDecisionAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: permissionDecisionAction,
        code: 'mailchimp.recovery.tenant_permission_decision',
        localOnly: true,
        requiresOperator: permissionDecisionAction !== 'append_tenant_boundary_audit',
        writesExternalSystem: false,
        evidence: {
          decisionKey: recovery.tenantPermissionDecisionBundle.decisionKey,
          status: recovery.tenantPermissionDecisionBundle.status,
          auditRequired: recovery.tenantPermissionDecisionBundle.audit?.required === true,
          auditReady: recovery.tenantPermissionDecisionBundle.audit?.ready === true,
          blockedReasons: stableList(recovery.tenantPermissionDecisionBundle.blockedReasons),
        },
      });
    }
  }

  if (recovery.tenantBoundaryAuditEnvelope?.ready === false) {
    const auditEnvelopeAction = recovery.tenantBoundaryAuditEnvelope.nextAction
      || recovery.tenantBoundaryAuditEnvelope.route?.primaryAction
      || 'append_tenant_boundary_audit';
    const alreadyPlanned = steps.some((step) => step.action === auditEnvelopeAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: auditEnvelopeAction,
        code: 'mailchimp.recovery.tenant_boundary_audit_envelope',
        localOnly: true,
        requiresOperator: auditEnvelopeAction !== 'append_tenant_boundary_audit',
        writesExternalSystem: false,
        evidence: {
          envelopeKey: recovery.tenantBoundaryAuditEnvelope.envelopeKey,
          state: recovery.tenantBoundaryAuditEnvelope.state,
          auditRequired: recovery.tenantBoundaryAuditEnvelope.auditRequired === true,
          auditReady: recovery.tenantBoundaryAuditEnvelope.auditReady === true,
          handoffKey: recovery.tenantBoundaryAuditEnvelope.audit?.handoffKey,
          blockedReasons: stableList(recovery.tenantBoundaryAuditEnvelope.blockedReasons),
        },
      });
    }
  }

  if (recovery.boundaryHandoff?.readyForRuntime === false) {
    const boundaryAction = recovery.boundaryHandoff.nextAction
      || recovery.boundaryHandoff.route?.nextAction
      || 'repair_tenant_permissions';
    const alreadyPlanned = steps.some((step) => step.action === boundaryAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: boundaryAction,
        code: 'mailchimp.recovery.tenant_boundary_handoff',
        localOnly: true,
        requiresOperator: true,
        writesExternalSystem: false,
      });
    }
  }

  if (
    recovery.boundaryHandoff?.requiresAuditAppend === true
    && recovery.boundaryHandoff?.auditAppendReady !== true
  ) {
    const auditAction = recovery.boundaryHandoff.nextAction
      || recovery.boundaryHandoff.route?.nextAction
      || 'append_tenant_boundary_audit';
    const alreadyPlanned = steps.some((step) => step.action === auditAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: auditAction,
        code: 'mailchimp.recovery.tenant_boundary_audit_append',
        localOnly: true,
        requiresOperator: auditAction === 'repair_tenant_permissions',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.controlsRequired) {
    const alreadyPlanned = steps.some((step) => step.action === recovery.compileCacheRecovery.nextAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: recovery.compileCacheRecovery.nextAction,
        code: `mailchimp.recovery.${recovery.compileCacheRecovery.nextAction}`,
        localOnly: true,
        requiresOperator: recovery.compileCacheRecovery.nextAction === 'await_compile_cache_operator_release',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.refreshRequired && !recovery.compileCacheRecovery.controlsRequired) {
    const alreadyPlanned = steps.some((step) => step.action === recovery.compileCacheRecovery.nextAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: recovery.compileCacheRecovery.nextAction,
        code: 'mailchimp.recovery.refresh_compile_cache',
        localOnly: true,
        requiresOperator: false,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.providerSyncRefreshRequired) {
    const providerSyncAction = recovery.compileCacheRecovery.nextAction;
    const alreadyPlanned = steps.some((step) => step.action === providerSyncAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: providerSyncAction,
        code: `mailchimp.recovery.${providerSyncAction}`,
        localOnly: true,
        requiresOperator: providerSyncAction === 'relink_external_handoff',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.boundaryRepairRequired) {
    const boundaryAction = recovery.compileCacheRecovery.boundaryCheckpoint.nextAction || 'repair_tenant_permissions';
    const alreadyPlanned = steps.some((step) => step.action === boundaryAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: boundaryAction,
        code: `mailchimp.recovery.${boundaryAction}`,
        localOnly: true,
        requiresOperator: true,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.barrierClosed) {
    const barrierAction = recovery.compileCacheRecovery.retryExhausted
      ? 'hold_for_operator'
      : recovery.compileCacheRecovery.replayBarrier.nextAction;
    const alreadyPlanned = steps.some((step) => step.action === barrierAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: barrierAction,
        code: `mailchimp.recovery.${barrierAction}`,
        localOnly: true,
        requiresOperator: barrierAction === 'hold_for_operator'
          || barrierAction === 'request_compile_cache_acceptance',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.resumeGateBlocked) {
    const resumeGateAction = recovery.compileCacheRecovery.resumeGate.nextAction
      || recovery.compileCacheRecovery.resumeGate.recoveryCommand
      || 'inspect_compile_cache_resume_gate';
    const alreadyPlanned = steps.some((step) => step.action === resumeGateAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: resumeGateAction,
        code: `mailchimp.recovery.${resumeGateAction}`,
        localOnly: true,
        requiresOperator: recovery.compileCacheRecovery.resumeGate.routeState === 'acceptance_required'
          || resumeGateAction === 'hold_for_operator'
          || resumeGateAction === 'request_compile_cache_acceptance',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.resumeEvidenceBlocked) {
    const evidenceAction = recovery.compileCacheRecovery.resumeEvidenceHandoff.nextAction
      || recovery.compileCacheRecovery.resumeEvidenceHandoff.recoveryCommand
      || 'inspect_compile_cache_resume_evidence';
    const alreadyPlanned = steps.some((step) => step.action === evidenceAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: evidenceAction,
        code: 'mailchimp.recovery.compile_cache_resume_evidence',
        localOnly: true,
        requiresOperator: evidenceAction === 'request_compile_cache_acceptance'
          || evidenceAction === 'append_tenant_boundary_audit',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.replayBundleBlocked) {
    const bundleAction = recovery.compileCacheRecovery.replayCommandBundle.nextAction
      || recovery.compileCacheRecovery.replayCommandBundle.recoveryCommand
      || 'review_compile_cache_replay_commands';
    const alreadyPlanned = steps.some((step) => step.action === bundleAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: bundleAction,
        code: 'mailchimp.recovery.compile_cache_replay_command_bundle',
        localOnly: true,
        requiresOperator: recovery.compileCacheRecovery.replayCommandBundle.counters.blocked > 0
          || bundleAction === 'request_compile_cache_acceptance',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.checklistBlocked) {
    const checklistAction = recovery.compileCacheRecovery.acceptanceChecklist.nextAction
      || recovery.compileCacheRecovery.acceptanceChecklist.route?.primaryAction
      || 'review_compile_cache_status';
    const alreadyPlanned = steps.some((step) => step.action === checklistAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: checklistAction,
        code: 'mailchimp.recovery.compile_cache_acceptance_checklist',
        localOnly: true,
        requiresOperator: recovery.compileCacheRecovery.checklistAcceptanceRequired
          || checklistAction === 'request_compile_cache_acceptance',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.reportReviewRequired) {
    const alreadyPlanned = steps.some((step) => step.action === recovery.compileCacheRecovery.nextAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: recovery.compileCacheRecovery.nextAction,
        code: 'mailchimp.recovery.review_compile_cache_export',
        localOnly: true,
        requiresOperator: false,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.exportPackageReviewRequired) {
    const packageAction = recovery.compileCacheRecovery.exportPackage.nextAction || recovery.compileCacheRecovery.nextAction;
    const alreadyPlanned = steps.some((step) => step.action === packageAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: packageAction,
        code: 'mailchimp.recovery.review_compile_cache_export_package',
        localOnly: true,
        requiresOperator: packageAction === 'request_compile_cache_acceptance',
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.compileCacheRecovery.recoveryLaneBlocked) {
    const laneAction = recovery.compileCacheRecovery.recoveryExportLane.nextAction
      || recovery.compileCacheRecovery.nextAction
      || 'review_compile_cache_export';
    const alreadyPlanned = steps.some((step) => step.action === laneAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: laneAction,
        code: 'mailchimp.recovery.compile_cache_recovery_export_lane',
        localOnly: true,
        requiresOperator: recovery.compileCacheRecovery.recoveryExportLane.counters.blockedRows > 0,
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.adapterDispatchReadiness?.ready === false) {
    const dispatchAction = recovery.adapterDispatchReadiness.nextAction || 'repair_mailchimp_dispatch_readiness';
    const alreadyPlanned = steps.some((step) => step.action === dispatchAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: dispatchAction,
        code: 'mailchimp.recovery.adapter_dispatch_readiness',
        localOnly: true,
        requiresOperator: dispatchAction === 'request_operator_acceptance'
          || stableList(recovery.adapterDispatchReadiness.blockedReasons).includes('operator_acceptance_required'),
        writesExternalSystem: false,
      });
    }
  }

  if (recovery.adapterNextStepHandoff?.readyForRuntime === false) {
    const nextStepAction = recovery.adapterNextStepHandoff.primaryAction
      || recovery.adapterNextStepHandoff.route?.primaryAction
      || recovery.adapterNextStepHandoff.recoveryCommands?.[0]
      || 'inspect_mailchimp_handoff';
    const alreadyPlanned = steps.some((step) => step.action === nextStepAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: nextStepAction,
        code: 'mailchimp.recovery.adapter_next_step_handoff',
        localOnly: true,
        requiresOperator: recovery.adapterNextStepHandoff.state === 'client_acceptance_required'
          || nextStepAction === 'request_operator_acceptance',
        writesExternalSystem: false,
        evidence: {
          handoffKey: recovery.adapterNextStepHandoff.handoffKey,
          state: recovery.adapterNextStepHandoff.state,
          readyForClient: recovery.adapterNextStepHandoff.readyForClient === true,
          routeState: recovery.adapterNextStepHandoff.route?.state || recovery.adapterNextStepHandoff.state,
          recoveryCommands: stableList(recovery.adapterNextStepHandoff.recoveryCommands),
          blockedReasons: stableList(recovery.adapterNextStepHandoff.blockedReasons),
        },
      });
    }
  }

  if (decisionReplayGuard.ready === false) {
    const decisionAction = decisionReplayGuard.nextAction || 'inspect_status_decision';
    const alreadyPlanned = steps.some((step) => step.action === decisionAction);
    if (!alreadyPlanned) {
      steps.push({
        index: steps.length + 1,
        action: decisionAction,
        code: 'mailchimp.recovery.decision_replay_guard',
        localOnly: true,
        requiresOperator: decisionReplayGuard.state === 'waiting_for_acceptance'
          || decisionAction === 'request_operator_acceptance',
        writesExternalSystem: false,
        evidence: {
          guardKey: decisionReplayGuard.guardKey,
          state: decisionReplayGuard.state,
          persistenceKey: decisionReplayGuard.decision.persistenceKey,
          adapterDecisionState: decisionReplayGuard.adapterDecision.state,
          restartSafe: decisionReplayGuard.restartSafe,
          replaySafe: decisionReplayGuard.replaySafe,
          blockedReasons: decisionReplayGuard.blockedReasons,
        },
      });
    }
  }

  const dedupedSteps = steps.reduce((unique, step) => {
    const key = step.action;
    if (unique.keys.has(key)) return unique;
    unique.keys.add(key);
    unique.items.push({
      ...step,
      index: unique.items.length + 1,
    });
    return unique;
  }, { keys: new Set(), items: [] }).items;

  const providerPreview = {
    title: `Mailchimp provider recovery for ${recovery.action || 'handoff'}`,
    state: recovery.providerRecovery.providerState,
    externalHandoffState: recovery.providerRecovery.externalHandoffState,
    externalRequestId: recovery.providerRecovery.externalRequestId,
    leaseState: recovery.providerRecovery.leaseState,
    receiptState: recovery.providerRecovery.receipt.state,
    receiptAcknowledged: recovery.providerRecovery.receipt.acknowledged,
    receiptRequired: recovery.providerRecovery.receipt.required,
    receiptGuardState: recovery.providerReceiptReplayGuard.state,
    receiptGuardReady: recovery.providerReceiptReplayGuard.ready === true,
    receiptGuardReplaySafe: recovery.providerReceiptReplayGuard.replaySafe === true,
    receiptGuardKey: recovery.providerReceiptReplayGuard.guardKey,
    syncReady: recovery.providerRecovery.syncReady,
    capabilitySatisfied: recovery.providerRecovery.capabilitySatisfied,
    restartSafe: recovery.providerRecovery.restartSafe,
    contractState: recovery.providerRecovery.providerContractState,
    continuityMode: recovery.providerRecovery.providerContinuity.mode,
    continuityHealthy: recovery.providerRecovery.providerContinuity.healthy,
    continuityRetryable: recovery.providerRecovery.providerContinuity.retryable,
    continuityRetryAfterMs: recovery.providerRecovery.providerContinuity.retryAfterMs,
    continuityReasons: recovery.providerRecovery.providerContinuity.degradedReasons,
    exportReady: recovery.providerRecovery.exportReady,
    blockedReasons: recovery.providerRecovery.blockedReasons,
    nextAction: recovery.providerRecovery.nextAction,
  };
  const persistedState = buildPersistedRecoveryState(recovery, settings, dedupedSteps);
  const clientWorkflowAnalytics = buildClientWorkflowRecoveryAnalytics(persistedState, dedupedSteps);
  const clientWorkflowReport = buildMailchimpRecoveryClientWorkflowReport(persistedState, dedupedSteps);
  const commandManifest = buildRecoveryCommandManifest(recovery, settings, persistedState, dedupedSteps);

  return {
    ...recovery,
    settings,
    settingsDiagnostics: validateRecoverySettings(settings, recovery),
    plan: {
      strategy: recovery.requiresRollback ? 'prepare_rollback_then_hold' : 'repair_and_resume',
      steps: dedupedSteps,
      providerRecovery: recovery.providerRecovery,
      providerReceiptReplayGuard: recovery.providerReceiptReplayGuard,
      compileCacheRecovery: recovery.compileCacheRecovery,
      permissionBoundary: recovery.permissionBoundary,
      tenantPermissionDecisionBundle: recovery.tenantPermissionDecisionBundle,
      tenantBoundaryAuditEnvelope: recovery.tenantBoundaryAuditEnvelope,
      boundaryHandoff: recovery.boundaryHandoff,
      adapterDispatchReadiness: recovery.adapterDispatchReadiness,
      adapterNextStepHandoff: recovery.adapterNextStepHandoff,
      decisionPersistenceEnvelope: recovery.decisionPersistenceEnvelope,
      persistedResumeGuard: recovery.persistedResumeGuard,
      decisionReplayGuard,
      persistedState,
      clientWorkflowAnalytics,
      commandManifest,
      providerPreview,
      resumePolicy: recovery.status.state === 'waiting_for_verifier'
        ? 'resume_after_verifier_evidence'
        : recovery.compileCacheRecovery.refreshRequired
          ? 'resume_after_compile_cache_refresh'
        : recovery.compileCacheRecovery.exportPackageReviewRequired
          ? 'resume_after_compile_cache_export_package_review'
        : recovery.compileCacheRecovery.providerSyncRefreshRequired
          ? 'resume_after_provider_sync_checkpoint'
        : recovery.compileCacheRecovery.boundaryRepairRequired
          ? 'resume_after_boundary_checkpoint_repair'
        : recovery.permissionBoundary?.allowed === false
          ? 'resume_after_permission_repair'
        : recovery.tenantPermissionDecisionBundle?.ready === false
          ? recovery.tenantPermissionDecisionBundle?.audit?.required === true
            && recovery.tenantPermissionDecisionBundle?.audit?.ready !== true
            ? 'resume_after_tenant_permission_audit'
            : 'resume_after_tenant_permission_decision'
        : recovery.tenantBoundaryAuditEnvelope?.ready === false
          ? recovery.tenantBoundaryAuditEnvelope.auditRequired === true
            && recovery.tenantBoundaryAuditEnvelope.auditReady !== true
            ? 'resume_after_tenant_boundary_audit'
            : 'resume_after_tenant_boundary_repair'
        : recovery.persistedResumeGuard?.ready === false
          ? recovery.persistedResumeGuard.state === 'stale_ticket'
            ? 'resume_after_runtime_resume_ticket_refresh'
            : 'resume_after_status_resume_ticket_persistence'
        : recovery.providerReceiptReplayGuard.ready === false
          ? recovery.providerReceiptReplayGuard.state === 'waiting_for_external_handoff_link'
            ? 'resume_after_external_handoff_relink'
            : recovery.providerReceiptReplayGuard.state === 'waiting_for_provider_receipt'
              ? 'resume_after_provider_receipt'
              : 'resume_after_provider_receipt_guard'
        : recovery.providerRecovery.receipt?.required === true
          && recovery.providerRecovery.receipt?.acknowledged !== true
          ? 'resume_after_provider_receipt'
        : recovery.providerRecovery.refreshRequired
          && recovery.providerRecovery.providerContinuity?.holdExternalWrite === true
          ? 'resume_after_provider_continuity_hold'
        : recovery.providerRecovery.refreshRequired
          ? 'resume_after_provider_refresh'
        : 'resume_after_descriptor_repair',
      lifecycle: buildLifecycleState(recovery, settings, dedupedSteps),
      exportReady: recovery.status.exportReady === true,
      providerCapabilitySatisfied: recovery.status.provider?.capabilitySatisfied !== false,
      tenantPermissionBoundarySatisfied: recovery.permissionBoundary?.allowed !== false,
      tenantPermissionDecisionReady: recovery.tenantPermissionDecisionBundle?.ready !== false,
      tenantPermissionDecisionAuditReady: recovery.tenantPermissionDecisionBundle?.audit?.required !== true
        || recovery.tenantPermissionDecisionBundle?.audit?.ready === true,
      tenantBoundaryAuditEnvelopeReady: recovery.tenantBoundaryAuditEnvelope?.ready !== false,
      tenantBoundaryAuditEnvelopeAuditReady: recovery.tenantBoundaryAuditEnvelope?.auditRequired !== true
        || recovery.tenantBoundaryAuditEnvelope?.auditReady === true,
      tenantBoundaryHandoffReady: recovery.boundaryHandoff?.readyForRuntime !== false,
      tenantBoundaryAuditAppendReady: recovery.boundaryHandoff?.requiresAuditAppend !== true
        || recovery.boundaryHandoff?.auditAppendReady === true,
      persistedResumeGuardReady: recovery.persistedResumeGuard?.ready === true,
      persistedResumeGuardReplaySafe: recovery.persistedResumeGuard?.replaySafe === true,
      restartSafeProviderLease: recovery.providerRecovery.restartSafe === true,
      replaySafeCompileCache: recovery.compileCacheRecovery.replaySafe === true,
      dispatchReady: recovery.adapterDispatchReadiness?.dispatchReady === true,
      clientWorkflowReady: persistedState.clientWorkflowHandoff.ready === true,
      clientResumeReady: persistedState.clientResumePacket.readyForClientRuntime === true,
      clientResumeReplayReady: persistedState.clientResumePacket.readyForRuntimeReplay === true,
      clientReadinessReady: persistedState.clientReadinessDecision.readyForClient === true,
      clientReadinessRuntimeReady: persistedState.clientReadinessDecision.readyForRuntimeStart === true,
      commandManifestReady: commandManifest.exportReady === true,
    },
    ui: {
      preview: {
        title: `Mailchimp recovery preview for ${recovery.action || 'handoff'}`,
        requestId: recovery.requestId,
        tenant: recovery.tenant,
        statusState: recovery.status.state,
      nextStep: recovery.providerRecovery.refreshRequired
          ? recovery.providerRecovery.nextAction
          : recovery.persistedResumeGuard?.ready === false
            ? recovery.persistedResumeGuard.nextAction
          : recovery.status.readiness?.nextStep || 'inspect_recovery_plan',
        provider: providerPreview,
          permissionBoundary: recovery.permissionBoundary,
          boundaryHandoff: recovery.boundaryHandoff,
          compileCache: {
          status: recovery.compileCacheRecovery.status,
          stale: recovery.compileCacheRecovery.stale,
          replayed: recovery.compileCacheRecovery.replayed,
          exportReady: recovery.compileCacheRecovery.exportReady,
          hitRate: recovery.compileCacheRecovery.report.hitRate,
          nextAction: recovery.compileCacheRecovery.nextAction,
          uiHandoff: recovery.status.compileCacheUiHandoff || recovery.status.compileCache?.uiHandoff || null,
          lifecycleNextAction: recovery.compileCacheRecovery.lifecycle.nextAction,
          lifecycleBlocked: recovery.compileCacheRecovery.lifecycleBlocked,
          controlsRequired: recovery.compileCacheRecovery.controlsRequired,
          lifecycleValidation: recovery.compileCacheRecovery.lifecycle.validationSummary,
          blockedReasons: recovery.compileCacheRecovery.report.blockedReasons,
          providerSyncCheckpoint: recovery.compileCacheRecovery.providerSyncCheckpoint,
          boundaryCheckpoint: recovery.compileCacheRecovery.boundaryCheckpoint,
          replayBarrier: recovery.compileCacheRecovery.replayBarrier,
          operationalHealth: recovery.compileCacheRecovery.operationalHealth,
          resumeGate: recovery.compileCacheRecovery.resumeGate,
          resumeEvidenceHandoff: recovery.compileCacheRecovery.resumeEvidenceHandoff,
          acceptanceChecklist: recovery.compileCacheRecovery.acceptanceChecklist,
          replayCommandBundle: recovery.compileCacheRecovery.replayCommandBundle,
          clientExportTimeline: recovery.compileCacheRecovery.clientExportTimeline,
          exportPackage: recovery.compileCacheRecovery.exportPackage,
        },
          adapterDispatchReadiness: {
          readinessKey: recovery.adapterDispatchReadiness?.readinessKey || null,
          state: recovery.adapterDispatchReadiness?.state || 'unknown',
          ready: recovery.adapterDispatchReadiness?.ready === true,
          dispatchReady: recovery.adapterDispatchReadiness?.dispatchReady === true,
          queueReady: recovery.adapterDispatchReadiness?.queueReady === true,
          nextAction: recovery.adapterDispatchReadiness?.nextAction || null,
          blockedReasons: recovery.adapterDispatchReadiness?.blockedReasons || [],
          route: recovery.adapterDispatchReadiness?.route || null,
          acceptance: recovery.adapterDispatchReadiness?.acceptance || null,
        },
        decisionReplayGuard: {
          guardKey: decisionReplayGuard.guardKey,
          state: decisionReplayGuard.state,
          ready: decisionReplayGuard.ready === true,
          restartSafe: decisionReplayGuard.restartSafe === true,
          replaySafe: decisionReplayGuard.replaySafe === true,
          nextAction: decisionReplayGuard.nextAction,
          blockedReasons: decisionReplayGuard.blockedReasons,
          persistenceKey: decisionReplayGuard.decision.persistenceKey,
          adapterDecisionState: decisionReplayGuard.adapterDecision.state,
        },
        persistedResumeGuard: {
          guardKey: recovery.persistedResumeGuard?.guardKey || '',
          ticketKey: recovery.persistedResumeGuard?.ticketKey || '',
          state: recovery.persistedResumeGuard?.state || 'unknown',
          ready: recovery.persistedResumeGuard?.ready === true,
          restartSafe: recovery.persistedResumeGuard?.restartSafe === true,
          replaySafe: recovery.persistedResumeGuard?.replaySafe === true,
          nextAction: recovery.persistedResumeGuard?.nextAction || 'inspect_persisted_resume_ticket',
          blockedReasons: recovery.persistedResumeGuard?.blockedReasons || [],
        },
        persistedState: {
          state: persistedState.state,
          restartSafe: persistedState.restartSafe,
          replaySafe: persistedState.replaySafe,
          nextCommandKey: persistedState.idempotency.nextCommandKey,
          resumeCommand: persistedState.resume.command,
          blockedReasons: persistedState.resume.blockedReasons,
          clientCommand: persistedState.clientCommand,
          externalHandoffReceipt: persistedState.externalHandoffReceipt,
          adapterDispatchReadiness: persistedState.adapterDispatchReadiness,
          clientWorkflowHandoff: persistedState.clientWorkflowHandoff,
          clientReadinessDecision: persistedState.clientReadinessDecision,
          clientResumePacket: persistedState.clientResumePacket,
          clientWorkflowAnalytics,
          clientWorkflowReport,
          commandManifest: {
            status: commandManifest.status,
            nextAction: commandManifest.nextAction,
            nextCommandId: commandManifest.nextCommandId,
            counters: commandManifest.counters,
            blockedReasons: commandManifest.blockedReasons,
          },
          replayBarrier: persistedState.replayBarrier,
          resumeGate: persistedState.resumeGate,
          resumeEvidenceHandoff: persistedState.resumeEvidenceHandoff,
          replayCommandBundle: persistedState.replayCommandBundle,
          clientExportTimeline: persistedState.clientExportTimeline,
          acceptanceChecklist: persistedState.acceptanceChecklist,
        },
      },
      validationSummary: {
        recoveryItems: recovery.recoveryItems.length,
        settingsDiagnostics: validateRecoverySettings(settings, recovery).length,
        providerRefreshRequired: recovery.providerRecovery.refreshRequired,
        providerContinuityMode: recovery.providerRecovery.providerContinuity.mode,
        providerContinuityHoldExternalWrite: recovery.providerRecovery.providerContinuity.holdExternalWrite,
        providerContinuityRetryable: recovery.providerRecovery.providerContinuity.retryable,
        providerContinuityRetryAfterMs: recovery.providerRecovery.providerContinuity.retryAfterMs,
        providerContinuityDegradedReasons: recovery.providerRecovery.providerContinuity.degradedReasons,
        compileCacheRefreshRequired: recovery.compileCacheRecovery.refreshRequired,
        compileCacheReportReviewRequired: recovery.compileCacheRecovery.reportReviewRequired,
        compileCacheExportPackageReviewRequired: recovery.compileCacheRecovery.exportPackageReviewRequired,
        compileCacheControlsRequired: recovery.compileCacheRecovery.controlsRequired,
        compileCacheProviderSyncRefreshRequired: recovery.compileCacheRecovery.providerSyncRefreshRequired,
        compileCacheBoundaryRepairRequired: recovery.compileCacheRecovery.boundaryRepairRequired,
        compileCacheReplayBarrierClosed: recovery.compileCacheRecovery.barrierClosed,
        compileCacheRetryExhausted: recovery.compileCacheRecovery.retryExhausted,
        compileCacheResumeGateBlocked: recovery.compileCacheRecovery.resumeGateBlocked,
        compileCacheResumeGateRouteState: recovery.compileCacheRecovery.resumeGate.routeState,
        compileCacheResumeEvidenceBlocked: recovery.compileCacheRecovery.resumeEvidenceBlocked,
        compileCacheResumeEvidenceState: recovery.compileCacheRecovery.resumeEvidenceHandoff.state,
        compileCacheResumeEvidenceMissing: recovery.compileCacheRecovery.resumeEvidenceMissing,
        compileCacheReplayCommandBundleBlocked: recovery.compileCacheRecovery.replayBundleBlocked,
        compileCacheReplayCommandBundleReady: recovery.compileCacheRecovery.replayCommandBundle.ready === true,
        compileCacheReplayCommandBundleRows: recovery.compileCacheRecovery.replayCommandBundle.counters.commands,
        compileCacheReplayCommandBundleBlockedRows: recovery.compileCacheRecovery.replayCommandBundle.counters.blocked,
        compileCacheClientExportTimelineBlocked: recovery.compileCacheRecovery.clientExportTimelineBlocked,
        compileCacheClientExportTimelineReady: recovery.compileCacheRecovery.clientExportTimeline.ready === true,
        compileCacheClientExportTimelineRows: recovery.compileCacheRecovery.clientExportTimeline.counters.rows,
        compileCacheClientExportTimelineBlockedRows: recovery.compileCacheRecovery.clientExportTimeline.counters.blockedRows,
        compileCacheClientExportTimelineNextAction: recovery.compileCacheRecovery.clientExportTimeline.nextAction,
        compileCacheAcceptanceChecklistBlocked: recovery.compileCacheRecovery.checklistBlocked,
        compileCacheAcceptanceChecklistState: recovery.compileCacheRecovery.acceptanceChecklist.state,
        compileCacheAcceptanceChecklistBlockingItems: recovery.compileCacheRecovery.acceptanceChecklist.blockingItems.length,
        permissionBoundaryBlocked: recovery.permissionBoundary?.allowed === false,
        boundaryHandoffBlocked: recovery.boundaryHandoff?.readyForRuntime === false,
        boundaryAuditAppendRequired: recovery.boundaryHandoff?.requiresAuditAppend === true
          && recovery.boundaryHandoff?.auditAppendReady !== true,
        providerReceiptRequired: recovery.providerRecovery.receipt?.required === true,
        providerReceiptAcknowledged: recovery.providerRecovery.receipt?.acknowledged === true,
        providerReceiptGuardState: recovery.providerReceiptReplayGuard.state,
        providerReceiptGuardReady: recovery.providerReceiptReplayGuard.ready === true,
        providerReceiptGuardReplaySafe: recovery.providerReceiptReplayGuard.replaySafe === true,
        providerReceiptGuardBlockedReasons: recovery.providerReceiptReplayGuard.blockedReasons.length,
        persistedResumeGuardState: recovery.persistedResumeGuard?.state || 'unknown',
        persistedResumeGuardReady: recovery.persistedResumeGuard?.ready === true,
        persistedResumeGuardRestartSafe: recovery.persistedResumeGuard?.restartSafe === true,
        persistedResumeGuardReplaySafe: recovery.persistedResumeGuard?.replaySafe === true,
        persistedResumeGuardBlockedReasons: recovery.persistedResumeGuard?.blockedReasons?.length || 0,
        adapterDispatchReadinessState: recovery.adapterDispatchReadiness?.state || 'unknown',
        adapterDispatchReady: recovery.adapterDispatchReadiness?.ready === true,
        adapterDispatchRuntimeReady: recovery.adapterDispatchReadiness?.dispatchReady === true,
        adapterDispatchBlockedReasons: recovery.adapterDispatchReadiness?.blockedReasons?.length || 0,
        decisionReplayGuardState: decisionReplayGuard.state,
        decisionReplayGuardReady: decisionReplayGuard.ready === true,
        decisionReplayGuardRestartSafe: decisionReplayGuard.restartSafe === true,
        decisionReplayGuardReplaySafe: decisionReplayGuard.replaySafe === true,
        decisionReplayGuardBlockedReasons: decisionReplayGuard.blockedReasons.length,
        clientWorkflowState: persistedState.clientWorkflowHandoff.state,
        clientWorkflowReady: persistedState.clientWorkflowHandoff.ready === true,
        clientWorkflowRetryable: persistedState.clientWorkflowHandoff.retry.retryable === true,
        clientWorkflowBlockedReasons: persistedState.clientWorkflowHandoff.blockedReasons.length,
        clientReadinessStatus: persistedState.clientReadinessDecision.status,
        clientReadinessReadyForClient: persistedState.clientReadinessDecision.readyForClient === true,
        clientReadinessReadyForRuntimeStart: persistedState.clientReadinessDecision.readyForRuntimeStart === true,
        clientReadinessNextAction: persistedState.clientReadinessDecision.nextAction,
        clientReadinessBlockedReasons: persistedState.clientReadinessDecision.blockedReasons.length,
        clientReadinessAcceptanceRequired: persistedState.clientReadinessDecision.acceptance.required === true
          && persistedState.clientReadinessDecision.acceptance.accepted !== true,
        clientResumeState: persistedState.clientResumePacket.state,
        clientResumeReady: persistedState.clientResumePacket.readyForClientRuntime === true,
        clientResumeReplayReady: persistedState.clientResumePacket.readyForRuntimeReplay === true,
        clientResumeRetryable: persistedState.clientResumePacket.retry.retryable === true,
        clientResumeBlockedReasons: persistedState.clientResumePacket.blockedReasons.length,
        clientWorkflowExportReady: clientWorkflowAnalytics.exportReady === true,
        clientWorkflowReportStatus: clientWorkflowReport.status,
        clientWorkflowReportReady: clientWorkflowReport.readyForClientResume === true,
        clientWorkflowReportRuntimeReplayReady: clientWorkflowReport.readyForRuntimeReplay === true,
        clientWorkflowReportBlockedReasons: clientWorkflowReport.counters.exportBlockedReasons,
        clientExportTimelineReady: clientWorkflowAnalytics.counters.clientExportTimelineReady === 1,
        clientExportTimelineBlockedRows: clientWorkflowAnalytics.counters.clientExportTimelineBlockedRows,
        recoveryCommandManifestReady: commandManifest.exportReady === true,
        recoveryCommandManifestBlocked: commandManifest.counters.blocked,
        recoveryCommandManifestRetryable: commandManifest.counters.retryable,
        persistedState: persistedState.state,
        restartSafe: persistedState.restartSafe,
        replaySafe: persistedState.replaySafe,
      },
      acceptance: {
        required: persistedState.acceptance.required
          || persistedState.resumeGate.acceptance?.required === true
          || persistedState.acceptanceChecklist.acceptance?.required === true
          || persistedState.clientReadinessDecision.acceptance.required === true
          || decisionReplayGuard.adapterDecision.acceptance?.required === true
          || settings.operatorApprovalRequired === true
          || recovery.requiresRollback,
        accepted: persistedState.acceptance.accepted
          || persistedState.resumeGate.acceptance?.accepted === true
          || persistedState.acceptanceChecklist.ready === true
          || persistedState.clientReadinessDecision.acceptance.accepted === true
          || decisionReplayGuard.adapterDecision.acceptance?.accepted === true,
        acceptedBy: persistedState.acceptance.acceptedBy
          || compactString(persistedState.resumeGate.acceptance?.acceptedBy)
          || compactString(persistedState.acceptanceChecklist.acceptance?.acceptedBy)
          || compactString(decisionReplayGuard.adapterDecision.acceptance?.acceptedBy),
        acceptedAt: persistedState.acceptance.acceptedAt
          || compactString(persistedState.resumeGate.acceptance?.acceptedAt)
          || compactString(persistedState.acceptanceChecklist.acceptance?.acceptedAt)
          || compactString(decisionReplayGuard.adapterDecision.acceptance?.acceptedAt),
        reason: persistedState.acceptance.reason
          || compactString(persistedState.resumeGate.acceptance?.reason)
          || compactString(persistedState.acceptanceChecklist.acceptance?.requiredBecause?.[0])
          || persistedState.clientReadinessDecision.acceptance.reason
          || compactString(decisionReplayGuard.adapterDecision.acceptance?.reason)
          || (recovery.requiresRollback
          ? 'Rollback-sensitive recovery requires operator acceptance.'
          : settings.operatorApprovalRequired === true
            ? 'Recovery settings require operator acceptance.'
            : ''),
        token: persistedState.acceptance.token
          || persistedState.clientReadinessDecision.acceptance.token
          || compactString(persistedState.acceptanceChecklist.acceptanceToken)
          || compactString(decisionReplayGuard.adapterDecision.acceptance?.token),
      },
      exports: {
        clientWorkflowHandoff: clientWorkflowAnalytics.exportSummary,
        clientWorkflowReport: clientWorkflowReport.exportSummary,
        commandManifest,
        timeline: clientWorkflowReport.timeline,
        counters: {
          ...clientWorkflowAnalytics.counters,
          clientWorkflowReportTimelineRows: clientWorkflowReport.counters.timelineRows,
          clientWorkflowReportBlockedRows: clientWorkflowReport.counters.blockedTimelineRows,
          clientWorkflowReportRetryableRows: clientWorkflowReport.counters.retryableRows,
          commandManifestCommands: commandManifest.counters.commands,
          commandManifestBlocked: commandManifest.counters.blocked,
          commandManifestRetryable: commandManifest.counters.retryable,
          commandManifestReplayBundleCommands: commandManifest.counters.replayBundleCommands,
        },
      },
    },
  };
}

export function applyMailchimpRecoveryPatch(input = {}, patch = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const next = {
    ...descriptor,
    dryRun: patch.dryRun ?? descriptor.dryRun,
    idempotencyKey: compactString(patch.idempotencyKey || descriptor.idempotencyKey),
    diagnostics: [],
    truthBoundary: {
      ...descriptor.truthBoundary,
      level: compactString(patch.truthBoundary || descriptor.truthBoundary?.level),
    },
  };
  if (next.dryRun) {
    next.capabilities = descriptor.capabilities.filter((capability) => capability !== 'external.write').concat('external.write.denied').sort();
    next.truthBoundary.externalWritesAllowed = false;
  }
  return next;
}
