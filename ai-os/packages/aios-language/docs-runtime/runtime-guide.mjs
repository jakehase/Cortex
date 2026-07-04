import { compileMailchimpAdapterHandoff } from '../runtime/adapter-handoff.mjs';
import {
  buildMailchimpStatusSnapshot,
  summarizeMailchimpStatus,
} from '../runtime/status-handoff.mjs';

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(',');
  return Array.from(new Set(list.map(compactString).filter(Boolean))).sort();
}

function summarizeDescriptor(descriptor) {
  return {
    id: compactString(descriptor.id || descriptor.jobId || descriptor.name || 'mailchimp.runtime.guide'),
    adapter: compactString(descriptor.adapter || 'mailchimp'),
    action: compactString(descriptor.action),
    tenant: compactString(descriptor.tenant),
    truth: compactString(descriptor.truth),
    dryRun: descriptor.dryRun === true,
    capabilities: stableList(descriptor.capabilities),
    idempotencyKey: compactString(descriptor.idempotencyKey),
    externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true,
  };
}

function normalizeStatusEvents(snapshot) {
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  return events.map((event, index) => ({
    index,
    state: compactString(event.state || 'unknown'),
    code: compactString(event.code || event.type || 'mailchimp.runtime.event'),
    at: compactString(event.at || event.time),
    message: compactString(event.message),
  }));
}

function normalizeRuntimeHealthSignals(descriptor, snapshot, runtime = {}) {
  const provider = snapshot.providerServiceContract || snapshot.provider || {};
  const readiness = snapshot.readiness || {};
  const memoryBoundary = runtime.memoryBoundary
    || runtime.memoryContract?.boundaryLedger
    || runtime.memoryGuide?.boundaryLedger
    || {};
  const retry = runtime.retry && typeof runtime.retry === 'object' ? runtime.retry : {};
  const retryAttempt = Number.isFinite(Number(retry.attempt)) ? Number(retry.attempt) : 0;
  const retryLimit = Number.isFinite(Number(retry.limit)) ? Number(retry.limit) : 3;
  const retryAfterSeconds = Number.isFinite(Number(retry.afterSeconds))
    ? Number(retry.afterSeconds)
    : Math.min(300, 15 * (2 ** Math.min(retryAttempt, 5)));
  const providerBlocked = provider.state === 'blocked'
    || provider.capabilityNegotiation?.satisfied === false
    || provider.sync?.stale === true;
  const boundaryReasons = stableList(memoryBoundary.blockedReasons || runtime.boundaryBlockedReasons);
  const degradedReasons = stableList([
    ...(provider.sync?.stale === true ? ['provider_sync_stale'] : []),
    ...(snapshot.state === 'waiting_for_verifier' ? ['waiting_for_verifier'] : []),
    ...(readiness.nextStep === 'collect_verifier_evidence' ? ['verifier_evidence_missing'] : []),
    ...(runtime.degradedReasons || []),
  ]);
  const hardFailures = stableList([
    ...(providerBlocked ? ['provider_contract_blocked'] : []),
    ...(descriptor.externalWritesAllowed && !descriptor.idempotencyKey ? ['missing_idempotency_key'] : []),
    ...boundaryReasons,
    ...(readiness.ready === false ? ['runtime_readiness_false'] : []),
  ]);
  const retryable = hardFailures.length === 0
    && snapshot.terminal !== true
    && retryAttempt < retryLimit
    && degradedReasons.length > 0;

  return {
    state: hardFailures.length
      ? 'blocked'
      : degradedReasons.length
        ? 'degraded'
        : snapshot.terminal === true
          ? 'terminal'
          : 'healthy',
    hardFailures,
    degradedReasons,
    retry: {
      attempt: retryAttempt,
      limit: retryLimit,
      retryable,
      afterSeconds: retryable ? retryAfterSeconds : 0,
      nextAction: retryable ? 'retry_runtime_handoff_after_backoff' : null,
    },
    boundary: {
      accepted: boundaryReasons.length === 0,
      blockedReasons: boundaryReasons,
      auditHandoff: memoryBoundary.auditHandoff || runtime.auditHandoff || null,
      tenantScope: memoryBoundary.tenantScope || runtime.tenantScope || null,
    },
  };
}

function buildActionableErrors(health, descriptorSummary) {
  return health.hardFailures.map((reason) => {
    const action = reason === 'missing_idempotency_key'
      ? 'attach_idempotency_key'
      : reason === 'provider_contract_blocked'
        ? 'refresh_provider_contract'
        : reason.startsWith('missing_grant:')
          ? 'request_runtime_permission_grant'
          : reason.startsWith('denied_grant:')
            ? 'remove_conflicting_permission_denial'
            : reason === 'cross_tenant_mount_scope'
              ? 'rebuild_memory_mounts_for_tenant'
              : reason === 'workspace_mount_scope_mismatch'
                ? 'rebuild_memory_mounts_for_workspace'
                : reason === 'audit_append_unavailable'
                  ? 'attach_audit_append_capability'
                  : 'repair_runtime_contract';
    return {
      code: `mailchimp.runtime.${reason.replaceAll(':', '.')}`,
      severity: 'error',
      action,
      adapter: descriptorSummary.adapter,
      tenant: descriptorSummary.tenant || health.boundary.tenantScope?.tenantId || '',
      message: reason,
    };
  });
}

function buildRuntimeReadiness(descriptor, snapshot, summary) {
  const provider = snapshot.providerServiceContract || snapshot.provider || {};
  const readiness = snapshot.readiness || {};
  const missingIdempotency = descriptor.externalWritesAllowed && !descriptor.idempotencyKey;
  const providerBlocked = provider.state === 'blocked'
    || provider.capabilityNegotiation?.satisfied === false
    || provider.sync?.stale === true;
  const verifierBlocked = snapshot.state === 'waiting_for_verifier'
    || readiness.nextStep === 'collect_verifier_evidence';
  const blocked = readiness.ready === false || providerBlocked || missingIdempotency;

  return {
    status: blocked
      ? 'blocked'
      : verifierBlocked
        ? 'waiting_for_verifier'
        : snapshot.terminal === true
          ? 'terminal'
          : 'ready',
    acceptedForRuntime: blocked === false && snapshot.terminal !== true,
    acceptedForClientStatus: true,
    nextAction: missingIdempotency
      ? 'attach_idempotency_key'
      : providerBlocked
        ? 'refresh_provider_contract'
        : verifierBlocked
          ? 'collect_verifier_evidence'
          : readiness.nextStep || summary.nextAction || 'dispatch_runtime_adapter',
    validationSummary: {
      state: snapshot.state || 'unknown',
      terminal: snapshot.terminal === true,
      ready: readiness.ready !== false,
      providerBlocked,
      verifierBlocked,
      missingIdempotency,
      activeEvents: summary.activeEvents || 0,
    },
  };
}

function buildRuntimeReadinessWithHealth(descriptor, snapshot, summary, health) {
  const base = buildRuntimeReadiness(descriptor, snapshot, summary);
  const blocked = health.state === 'blocked';
  const degraded = health.state === 'degraded';

  return {
    ...base,
    status: blocked
      ? 'blocked'
      : degraded
        ? 'degraded'
        : base.status,
    acceptedForRuntime: blocked === false
      && base.acceptedForRuntime === true
      && health.state !== 'terminal',
    degradedMode: degraded,
    retryAfterSeconds: health.retry.afterSeconds,
    nextAction: blocked
      ? buildActionableErrors(health, descriptor)[0]?.action || base.nextAction
      : health.retry.nextAction || base.nextAction,
    validationSummary: {
      ...base.validationSummary,
      healthState: health.state,
      hardFailures: health.hardFailures.length,
      degradedReasons: health.degradedReasons.length,
      retryable: health.retry.retryable,
      boundaryAccepted: health.boundary.accepted,
    },
  };
}

export function buildMailchimpRuntimeGuideHandoff(input = {}, runtime = {}) {
  const descriptor = compileMailchimpAdapterHandoff(input, runtime);
  const snapshot = buildMailchimpStatusSnapshot(descriptor, runtime);
  const summary = summarizeMailchimpStatus(snapshot);
  const descriptorSummary = summarizeDescriptor(descriptor);
  const health = normalizeRuntimeHealthSignals(descriptorSummary, snapshot, runtime);
  const actionableErrors = buildActionableErrors(health, descriptorSummary);
  const readiness = buildRuntimeReadinessWithHealth(descriptorSummary, snapshot, summary, health);
  const events = normalizeStatusEvents(snapshot);

  return {
    kind: 'aios.docsRuntime.runtimeGuide.mailchimp.v1',
    provider: 'mailchimp',
    descriptor,
    descriptorSummary,
    statusSnapshot: snapshot,
    statusSummary: summary,
    statusLedger: {
      state: snapshot.state || 'unknown',
      visibleStatus: summary.visibleStatus || readiness.status,
      latestEvent: events[events.length - 1] || null,
      events,
      health,
      actionableErrors,
      nextAction: readiness.nextAction,
    },
    adapterHandoff: {
      acceptedForRuntime: readiness.acceptedForRuntime,
      adapter: descriptorSummary.adapter,
      action: descriptorSummary.action,
      capabilities: descriptorSummary.capabilities,
      idempotencyKey: descriptorSummary.idempotencyKey || null,
      dryRun: descriptorSummary.dryRun,
      truthBoundary: descriptor.truthBoundary || null,
      auditHandoff: health.boundary.auditHandoff,
      tenantScope: health.boundary.tenantScope,
    },
    readiness,
    operationalHealth: health,
    actionableErrors,
    exportSummary: {
      exportReady: readiness.acceptedForRuntime || readiness.status === 'waiting_for_verifier',
      blockedReasons: stableList([
        ...Object.entries(readiness.validationSummary)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .filter((key) => key.endsWith('Blocked') || key === 'missingIdempotency'),
        ...health.hardFailures,
      ]),
      validationSummary: readiness.validationSummary,
    },
  };
}

export function assertMailchimpRuntimeGuideReady(contract) {
  const target = contract?.kind === 'aios.docsRuntime.runtimeGuide.mailchimp.v1'
    ? contract
    : buildMailchimpRuntimeGuideHandoff(contract || {});
  return {
    ok: target.readiness.acceptedForRuntime === true,
    status: target.readiness.status,
    nextAction: target.readiness.nextAction,
    blockedReasons: target.exportSummary.blockedReasons,
    validationSummary: target.readiness.validationSummary,
  };
}
