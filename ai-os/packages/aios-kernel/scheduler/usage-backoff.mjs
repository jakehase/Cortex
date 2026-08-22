export const surfaceId = "aios_scheduler_usage-backoff_060";
export const surfaceGroup = "scheduler";
export const surfaceName = "usage-backoff";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_DEGRADED_AT = 0.85;
const DEFAULT_BLOCKED_AT = 1;
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_HEALTH_STALE_AFTER_MS = 120_000;
const DEFAULT_ERROR_BURST_LIMIT = 3;
const DEFAULT_LANE_WINDOW_MS = 300_000;
const DEFAULT_ADMISSION_UNITS = 1;
const DEFAULT_LANE_HISTORY_LIMIT = 12;
const DEFAULT_LANE_STRIKE_LIMIT = 2;
const DEFAULT_LANE_STRIKE_BACKOFF_MS = 30_000;
const DEFAULT_CONTINUATION_WINDOW_MS = 900_000;
const DEFAULT_MAX_CONTINUATION_WINDOW_MS = 86_400_000;

function asFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeIso(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildValidation(input, limits) {
  const issues = [];
  if (limits.limit <= 0) {
    issues.push({
      code: 'usage_limit_missing',
      severity: 'error',
      message: 'A positive usage limit is required before scheduler admission can be evaluated.',
      action: 'Provide limits.limit or quota.limit for this scheduler window.'
    });
  }
  if (limits.used < 0) {
    issues.push({
      code: 'usage_used_negative',
      severity: 'error',
      message: 'Usage used cannot be negative.',
      action: 'Normalize metering input before calling the scheduler backoff surface.'
    });
  }
  if (input.lastFailure && typeof input.lastFailure !== 'object') {
    issues.push({
      code: 'invalid_failure_state',
      severity: 'warning',
      message: 'lastFailure must be an object to participate in retry/backoff calculations.',
      action: 'Pass lastFailure as { code, message, retryable, attempts }.'
    });
  }
  return issues;
}

function normalizeLimits(input) {
  const quota = input.quota && typeof input.quota === 'object' ? input.quota : {};
  const limits = input.limits && typeof input.limits === 'object' ? input.limits : {};
  const limit = asFiniteNumber(input.limit, asFiniteNumber(limits.limit, asFiniteNumber(quota.limit, 0)));
  const used = asFiniteNumber(input.used, asFiniteNumber(limits.used, asFiniteNumber(quota.used, 0)));
  const reserved = asFiniteNumber(input.reserved, asFiniteNumber(limits.reserved, asFiniteNumber(quota.reserved, 0)));
  const remaining = Math.max(0, limit - used - Math.max(0, reserved));
  return {
    limit,
    used,
    reserved: Math.max(0, reserved),
    remaining,
    pressure: limit > 0 ? clamp((used + Math.max(0, reserved)) / limit, 0, 1) : 1,
    windowMs: Math.max(1, asFiniteNumber(input.windowMs, asFiniteNumber(limits.windowMs, DEFAULT_WINDOW_MS)))
  };
}

function scopedString(record, ...keys) {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim().length > 0) return record[key].trim();
  }
  return null;
}

function scopeComparison(expected, actual) {
  return {
    expected,
    actual: actual || null,
    present: Boolean(actual),
    matches: !actual || actual === expected
  };
}

function normalizeUsageLaneScopeBoundary(input, lane, metering, oauth, scope, laneId) {
  const explicitTenantId = firstString(
    input.laneTenantId,
    lane.tenantId,
    lane.ownerTenantId,
    metering.tenantId,
    oauth.tenantId
  );
  const explicitWorkspaceId = firstString(
    input.laneWorkspaceId,
    lane.workspaceId,
    lane.workspace,
    metering.workspaceId,
    oauth.workspaceId
  );
  const explicitRouteId = firstString(
    input.laneRouteId,
    lane.routeId,
    metering.routeId,
    oauth.routeId
  );
  const comparisons = {
    tenant: scopeComparison(scope.tenantId, explicitTenantId),
    workspace: scopeComparison(scope.workspaceId, explicitWorkspaceId),
    route: scopeComparison(scope.routeId, explicitRouteId)
  };
  const mismatchCodes = Object.entries(comparisons)
    .filter(([, comparison]) => comparison.present && !comparison.matches)
    .map(([name]) => `lane_${name}_mismatch`);
  const scoped = Object.values(comparisons).some((comparison) => comparison.present);
  const stateKeyPrefix = `scheduler/${encodeURIComponent(scope.tenantId)}/${encodeURIComponent(scope.workspaceId)}/lanes/`;

  return {
    schema: 'aios.scheduler.usageBackoff.usageLaneScopeBoundary.v1',
    enforced: input.enforceUsageLaneScopeBoundary !== false,
    scoped,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    routeId: scope.routeId,
    laneId,
    stateKeyPrefix,
    comparisons,
    mismatchCodes,
    matches: mismatchCodes.length === 0,
    stateKey: `${stateKeyPrefix}${encodeURIComponent(laneId)}`
  };
}

function normalizeUsageLaneHistory(input, lane, metering, now, normalizedKind, scope, laneId) {
  const history = Array.isArray(input.usageLaneHistory)
    ? input.usageLaneHistory
    : Array.isArray(lane.history)
      ? lane.history
      : Array.isArray(metering.history)
        ? metering.history
        : Array.isArray(input.laneSnapshots)
          ? input.laneSnapshots
          : [];
  const limit = clamp(Math.trunc(asFiniteNumber(input.laneHistoryLimit, asFiniteNumber(lane.historyLimit, DEFAULT_LANE_HISTORY_LIMIT))), 1, 50);
  const rawSamples = history.slice(-limit);
  const rejectedSamples = [];
  const samples = rawSamples.map((entry, index) => {
    const record = entry && typeof entry === 'object' ? entry : {};
    const sampleTenantId = scopedString(record, 'tenantId', 'ownerTenantId');
    const sampleWorkspaceId = scopedString(record, 'workspaceId', 'workspace');
    const sampleRouteId = scopedString(record, 'routeId');
    const sampleLaneId = scopedString(record, 'laneId', 'id');
    const scopeMismatches = [
      sampleTenantId && sampleTenantId !== scope.tenantId ? 'tenant' : null,
      sampleWorkspaceId && sampleWorkspaceId !== scope.workspaceId ? 'workspace' : null,
      sampleRouteId && sampleRouteId !== scope.routeId ? 'route' : null,
      sampleLaneId && sampleLaneId !== laneId ? 'lane' : null
    ].filter(Boolean);
    if (scopeMismatches.length > 0) {
      rejectedSamples.push({
        sequence: Math.max(0, Math.trunc(asFiniteNumber(record.sequence, index))),
        observedAt: normalizeIso(record.observedAt || record.generatedAt || record.at),
        laneId: sampleLaneId || null,
        tenantId: sampleTenantId || null,
        workspaceId: sampleWorkspaceId || null,
        routeId: sampleRouteId || null,
        mismatchCodes: scopeMismatches.map((part) => `history_${part}_mismatch`)
      });
      return null;
    }
    const recordLimit = asFiniteNumber(record.limit, asFiniteNumber(record.laneLimit, 0));
    const used = Math.max(0, asFiniteNumber(record.used, asFiniteNumber(record.laneUsed, 0)));
    const reserved = Math.max(0, asFiniteNumber(record.reserved, asFiniteNumber(record.laneReserved, 0)));
    const remaining = Math.max(0, asFiniteNumber(record.remaining, recordLimit > 0 ? recordLimit - used - reserved : 0));
    const pressure = recordLimit > 0 ? clamp((used + reserved) / recordLimit, 0, 1) : remaining <= 0 ? 1 : 0;
    const retryAfterMs = Math.max(0, Math.trunc(asFiniteNumber(record.retryAfterMs, asFiniteNumber(record.delayMs, 0))));
    const resetAt = normalizeDeadline(record.resetAt || record.windowResetAt);
    const resumeAt = normalizeDeadline(record.resumeAt || record.nextRetryAt)
      || (retryAfterMs > 0 ? new Date(new Date(now).getTime() + retryAfterMs).toISOString() : null)
      || (resetAt && new Date(resetAt).getTime() > new Date(now).getTime() ? resetAt : null);
    const exhausted = record.exhausted == null
      ? remaining <= 0 || pressure >= 1 || retryAfterMs > 0
      : asBoolean(record.exhausted, false);

    return {
      sequence: Math.max(0, Math.trunc(asFiniteNumber(record.sequence, index))),
      observedAt: normalizeIso(record.observedAt || record.generatedAt || record.at),
      laneId: sampleLaneId || laneId,
      tenantId: sampleTenantId || scope.tenantId,
      workspaceId: sampleWorkspaceId || scope.workspaceId,
      routeId: sampleRouteId || scope.routeId,
      kind: firstString(record.kind, record.type) || normalizedKind,
      exhausted,
      limit: recordLimit > 0 ? recordLimit : null,
      remaining,
      pressurePct: Math.round(pressure * 100),
      retryAfterMs,
      resetAt,
      resumeAt
    };
  }).filter(Boolean);
  const exhaustedStreak = [...samples].reverse().findIndex((sample) => !sample.exhausted);
  const consecutiveExhausted = exhaustedStreak === -1 ? samples.length : exhaustedStreak;
  const strikeLimit = Math.max(1, Math.trunc(asFiniteNumber(input.laneStrikeLimit, asFiniteNumber(lane.strikeLimit, DEFAULT_LANE_STRIKE_LIMIT))));
  const latestResumeAt = [...samples]
    .reverse()
    .map((sample) => sample.resumeAt)
    .find((resumeAt) => resumeAt && new Date(resumeAt).getTime() > new Date(now).getTime()) || null;
  const latestRetryAfterMs = [...samples].reverse().find((sample) => sample.retryAfterMs > 0)?.retryAfterMs || 0;
  const enforcedBackoff = consecutiveExhausted >= strikeLimit;
  const strikeDelayMs = enforcedBackoff
    ? Math.min(DEFAULT_MAX_BACKOFF_MS, DEFAULT_LANE_STRIKE_BACKOFF_MS * consecutiveExhausted)
    : 0;
  const resumeAt = latestResumeAt
    || (latestRetryAfterMs > 0 ? new Date(new Date(now).getTime() + latestRetryAfterMs).toISOString() : null)
    || (strikeDelayMs > 0 ? new Date(new Date(now).getTime() + strikeDelayMs).toISOString() : null);

  return {
    schema: 'aios.scheduler.usageBackoff.usageLaneHistory.v1',
    configured: samples.length > 0,
    sampleCount: samples.length,
    rejectedSampleCount: rejectedSamples.length,
    limit,
    strikeLimit,
    consecutiveExhausted,
    enforcedBackoff,
    delayMs: resumeAt ? Math.max(0, new Date(resumeAt).getTime() - new Date(now).getTime()) : 0,
    resumeAt,
    resumeReason: latestResumeAt ? 'history-resume' : latestRetryAfterMs > 0 ? 'history-retry-after' : strikeDelayMs > 0 ? 'history-strike' : 'none',
    lastSample: samples[samples.length - 1] || null,
    samples,
    rejectedSamples
  };
}

function normalizeUsageLaneFailure(input, lane, metering, oauth, now, laneId) {
  const failure = input.usageLaneFailure && typeof input.usageLaneFailure === 'object'
    ? input.usageLaneFailure
    : input.laneFailure && typeof input.laneFailure === 'object'
      ? input.laneFailure
      : lane.failure && typeof lane.failure === 'object'
        ? lane.failure
        : metering.failure && typeof metering.failure === 'object'
          ? metering.failure
          : oauth.failure && typeof oauth.failure === 'object'
            ? oauth.failure
            : {};
  const rawCode = firstString(
    input.usageLaneFailureCode,
    failure.code,
    failure.type,
    failure.status,
    oauth.error,
    metering.errorCode
  );
  const code = rawCode ? rawCode.toLowerCase().replaceAll(' ', '_') : null;
  const httpStatus = Math.trunc(asFiniteNumber(failure.httpStatus, asFiniteNumber(failure.statusCode, 0)));
  const attempts = Math.max(0, Math.trunc(asFiniteNumber(
    input.usageLaneFailureAttempts,
    asFiniteNumber(failure.attempts, asFiniteNumber(lane.failureAttempts, 0))
  )));
  const retryAfterMs = Math.max(0, Math.trunc(asFiniteNumber(
    input.usageLaneFailureRetryAfterMs,
    asFiniteNumber(failure.retryAfterMs, asFiniteNumber(failure.delayMs, 0))
  )));
  const resumeAt = normalizeDeadline(input.usageLaneFailureResumeAt || failure.resumeAt || failure.nextRetryAt)
    || (retryAfterMs > 0 ? new Date(new Date(now).getTime() + retryAfterMs).toISOString() : null);
  const retryableCodes = ['rate_limited', 'throttled', 'timeout', 'temporarily_unavailable', 'service_unavailable', 'provider_unavailable', 'meter_unavailable', 'sync_lag', 'token_expired', 'refresh_required'];
  const terminalCodes = ['invalid_grant', 'token_revoked', 'refresh_failed', 'permission_denied', 'unauthorized', 'forbidden', 'subject_mismatch', 'lane_closed'];
  const retryableByCode = code
    ? retryableCodes.includes(code) || httpStatus === 408 || httpStatus === 409 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500
    : attempts > 0 || retryAfterMs > 0;
  const terminalByCode = code ? terminalCodes.includes(code) || httpStatus === 401 || httpStatus === 403 : false;
  const retryable = failure.retryable == null
    ? retryableByCode && !terminalByCode
    : asBoolean(failure.retryable, retryableByCode) && !terminalByCode;
  const degradeOnly = asBoolean(input.usageLaneFailureDegradedMode, asBoolean(failure.degradedMode, code === 'sync_lag'));
  const present = Boolean(code || failure.message || attempts > 0 || retryAfterMs > 0 || httpStatus > 0);
  const blocking = present && !degradeOnly && (!retryable || retryAfterMs > 0 || attempts > 0 || terminalByCode);
  const issueCode = !present
    ? null
    : terminalByCode || !retryable
      ? 'usage_lane_failure_terminal'
      : degradeOnly
        ? 'usage_lane_failure_degraded'
        : 'usage_lane_failure_backoff';

  return {
    schema: 'aios.scheduler.usageBackoff.usageLaneFailure.v1',
    configured: present,
    laneId,
    code,
    message: firstString(failure.message, failure.detail, oauth.errorDescription, metering.errorMessage),
    httpStatus: httpStatus > 0 ? httpStatus : null,
    retryable,
    attempts,
    retryAfterMs,
    resumeAt,
    degradedMode: degradeOnly,
    terminal: present && (terminalByCode || !retryable),
    admissionImpact: !present ? 'allow' : blocking ? 'block' : 'degrade',
    issueCode,
    action: !present
      ? null
      : terminalByCode || !retryable
        ? `Repair or reauthorize usage lane ${laneId} before scheduler admission resumes.`
        : resumeAt
          ? `Retry usage lane ${laneId} no earlier than ${resumeAt}.`
          : `Keep usage lane ${laneId} in degraded mode until provider metering recovers.`
  };
}

function normalizeUsageLane(input, now, scope, limits) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const lane = input.usageLane && typeof input.usageLane === 'object'
    ? input.usageLane
    : input.lane && typeof input.lane === 'object'
      ? input.lane
      : input.messageMeter && typeof input.messageMeter === 'object'
        ? input.messageMeter
        : scheduler.usageLane && typeof scheduler.usageLane === 'object'
          ? scheduler.usageLane
          : {};
  const oauth = input.oauth && typeof input.oauth === 'object' ? input.oauth : {};
  const metering = input.metering && typeof input.metering === 'object' ? input.metering : {};
  const configured = Boolean(
    input.usageLane
    || input.lane
    || input.messageMeter
    || scheduler.usageLane
    || input.oauth
    || input.metering
    || input.usageLaneHistory
    || input.laneSnapshots
  );
  const kind = String(firstString(input.laneKind, lane.kind, lane.type, oauth.kind, metering.kind) || 'message-metered').toLowerCase();
  const normalizedKind = ['oauth', 'message-metered', 'message', 'metered'].includes(kind)
    ? kind === 'message' || kind === 'metered' ? 'message-metered' : kind
    : 'custom-metered';
  const limit = asFiniteNumber(input.laneLimit, asFiniteNumber(lane.limit, asFiniteNumber(metering.limit, limits.limit)));
  const used = Math.max(0, asFiniteNumber(input.laneUsed, asFiniteNumber(lane.used, asFiniteNumber(metering.used, 0))));
  const reserved = Math.max(0, asFiniteNumber(input.laneReserved, asFiniteNumber(lane.reserved, asFiniteNumber(metering.reserved, 0))));
  const windowMs = Math.max(1, Math.trunc(asFiniteNumber(input.laneWindowMs, asFiniteNumber(lane.windowMs, asFiniteNumber(metering.windowMs, DEFAULT_LANE_WINDOW_MS)))));
  const resetAt = normalizeDeadline(input.laneResetAt || lane.resetAt || lane.windowResetAt || metering.resetAt);
  const retryAfterMs = Math.max(0, Math.trunc(asFiniteNumber(input.laneRetryAfterMs, asFiniteNumber(lane.retryAfterMs, asFiniteNumber(metering.retryAfterMs, 0)))));
  const resumeFromReset = resetAt && new Date(resetAt).getTime() > new Date(now).getTime() ? resetAt : null;
  const resumeFromRetryAfter = retryAfterMs > 0 ? new Date(new Date(now).getTime() + retryAfterMs).toISOString() : null;
  const tokenSubject = firstString(input.oauthSubject, oauth.subject, oauth.userId, lane.subject, metering.subject);
  const laneId = firstString(input.laneId, lane.id, lane.laneId, oauth.clientId, metering.laneId)
    || `${scope.tenantId}:${scope.workspaceId}:${scope.routeId}:${normalizedKind}`;
  const scopeBoundary = normalizeUsageLaneScopeBoundary(input, lane, metering, oauth, scope, laneId);
  const laneHistory = normalizeUsageLaneHistory(input, lane, metering, now, normalizedKind, scope, laneId);
  const laneFailure = normalizeUsageLaneFailure(input, lane, metering, oauth, now, laneId);
  const remaining = Math.max(0, limit - used - reserved);
  const pressure = limit > 0 ? clamp((used + reserved) / limit, 0, 1) : configured ? 1 : 0;
  const scopeBlocked = configured && scopeBoundary.enforced && !scopeBoundary.matches;
  const failureBlocked = configured && laneFailure.admissionImpact === 'block';
  const exhausted = configured && (limit <= 0 || remaining <= 0 || pressure >= 1 || laneHistory.enforcedBackoff || scopeBlocked || failureBlocked);
  const resumeAt = scopeBlocked
    ? null
    : laneFailure.resumeAt || resumeFromRetryAfter || resumeFromReset || laneHistory.resumeAt || (exhausted ? new Date(new Date(now).getTime() + windowMs).toISOString() : null);
  const delayMs = resumeAt ? Math.max(0, new Date(resumeAt).getTime() - new Date(now).getTime()) : 0;

  return {
    schema: 'aios.scheduler.usageBackoff.usageLane.v1',
    configured,
    id: laneId,
    kind: normalizedKind,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    routeId: scope.routeId,
    queue: scope.queue,
    tokenSubject,
    limit,
    used,
    reserved,
    remaining,
    pressure,
    pressurePct: Math.round(pressure * 100),
    windowMs,
    resetAt,
    retryAfterMs,
    resumeAt,
    delayMs,
    exhausted,
    failure: laneFailure,
    scopeBoundary,
    history: laneHistory,
    admissionImpact: scopeBlocked || exhausted ? 'block' : laneFailure.admissionImpact === 'degrade' || configured && pressure >= DEFAULT_DEGRADED_AT ? 'degrade' : 'allow',
    resumeReason: scopeBlocked ? 'lane-scope-boundary' : laneFailure.resumeAt ? 'lane-failure' : retryAfterMs > 0 ? 'retry-after' : resumeFromReset ? 'meter-reset' : laneHistory.resumeReason !== 'none' ? laneHistory.resumeReason : exhausted ? 'window-estimate' : 'none',
    stateKey: scopeBoundary.stateKey
  };
}

function normalizeAdmissionCost(input, limits, usageLane) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const metering = input.metering && typeof input.metering === 'object' ? input.metering : {};
  const cost = input.admissionCost && typeof input.admissionCost === 'object'
    ? input.admissionCost
    : input.cost && typeof input.cost === 'object'
      ? input.cost
      : input.usageCost && typeof input.usageCost === 'object'
        ? input.usageCost
        : scheduler.admissionCost && typeof scheduler.admissionCost === 'object'
          ? scheduler.admissionCost
          : {};
  const rawUnits = asFiniteNumber(
    input.usageUnits,
    asFiniteNumber(
      input.requestedUnits,
      asFiniteNumber(
        request.usageUnits,
        asFiniteNumber(cost.units, asFiniteNumber(metering.units, DEFAULT_ADMISSION_UNITS))
      )
    )
  );
  const units = Math.max(1, Math.trunc(rawUnits));
  const quotaUnits = Math.max(1, Math.trunc(asFiniteNumber(
    input.quotaUnits,
    asFiniteNumber(cost.quotaUnits, asFiniteNumber(cost.usageUnits, units))
  )));
  const laneUnits = Math.max(1, Math.trunc(asFiniteNumber(
    input.laneUnits,
    asFiniteNumber(cost.laneUnits, asFiniteNumber(cost.messageUnits, quotaUnits))
  )));
  const quotaFits = limits.limit > 0 && limits.remaining >= quotaUnits;
  const laneFits = !usageLane.configured || (usageLane.limit > 0 && usageLane.remaining >= laneUnits);
  const reservationKey = firstString(
    input.reservationKey,
    cost.reservationKey,
    request.reservationKey,
    input.idempotencyKey,
    request.idempotencyKey
  );

  return {
    schema: 'aios.scheduler.usageBackoff.admissionCost.v1',
    units,
    quotaUnits,
    laneUnits: usageLane.configured ? laneUnits : 0,
    reservationKey,
    quotaFits,
    laneFits,
    fits: quotaFits && laneFits,
    quotaRemainingBeforeDecision: limits.remaining,
    laneRemainingBeforeDecision: usageLane.configured ? usageLane.remaining : null,
    quotaRemainingAfterDecision: Math.max(0, limits.remaining - quotaUnits),
    laneRemainingAfterDecision: usageLane.configured ? Math.max(0, usageLane.remaining - laneUnits) : null,
    pressureAfterDecisionPct: limits.limit > 0
      ? Math.round(clamp((limits.used + limits.reserved + quotaUnits) / limits.limit, 0, 1) * 100)
      : 100,
    lanePressureAfterDecisionPct: usageLane.configured && usageLane.limit > 0
      ? Math.round(clamp((usageLane.used + usageLane.reserved + laneUnits) / usageLane.limit, 0, 1) * 100)
      : usageLane.configured ? 100 : null
  };
}

function buildAdmissionCostValidation(admissionCost, usageLane) {
  const issues = [];
  if (!admissionCost.quotaFits) {
    issues.push({
      code: 'admission_cost_exceeds_quota',
      severity: 'error',
      message: 'Requested scheduler admission units exceed remaining quota capacity.',
      action: `Reduce requested quota units to ${admissionCost.quotaRemainingBeforeDecision} or wait for the quota window to recover.`
    });
  }
  if (!admissionCost.laneFits) {
    issues.push({
      code: 'admission_cost_exceeds_usage_lane',
      severity: 'error',
      message: 'Requested scheduler admission units exceed the remaining OAuth or message-metered lane capacity.',
      action: usageLane.resumeAt
        ? `Retry this lane no earlier than ${usageLane.resumeAt}.`
        : `Reduce requested lane units to ${admissionCost.laneRemainingBeforeDecision} or wait for the lane meter to reset.`
    });
  }
  return issues;
}

function buildUsageLaneValidation(usageLane) {
  const issues = [];
  if (!usageLane.configured) return issues;
  if (usageLane.scopeBoundary.enforced && !usageLane.scopeBoundary.matches) {
    issues.push({
      code: 'usage_lane_scope_mismatch',
      severity: 'error',
      message: 'The OAuth or message-metered scheduler lane belongs to a different tenant, workspace, or route scope.',
      action: 'Load a lane meter from the current scheduler scope or evaluate the request inside the lane owner scope.'
    });
  }
  if (usageLane.history.rejectedSampleCount > 0) {
    issues.push({
      code: 'usage_lane_history_scope_filtered',
      severity: 'warning',
      message: 'Some OAuth or message-metered lane history samples were ignored because they crossed scheduler scope boundaries.',
      action: 'Persist lane history under the current tenant, workspace, route, and lane id before relying on historical backoff.'
    });
  }
  if (!['oauth', 'message-metered', 'custom-metered'].includes(usageLane.kind)) {
    issues.push({
      code: 'usage_lane_kind_invalid',
      severity: 'warning',
      message: 'Usage lane kind is not recognized by the scheduler usage-backoff surface.',
      action: 'Use oauth, message-metered, or custom-metered for lane.kind.'
    });
  }
  if (usageLane.limit <= 0) {
    issues.push({
      code: 'usage_lane_limit_missing',
      severity: 'error',
      message: 'A positive OAuth or message-metered lane limit is required for lane admission.',
      action: 'Attach usageLane.limit, lane.limit, or metering.limit for this scheduler lane.'
    });
  }
  if (usageLane.failure.configured && !(usageLane.exhausted && usageLane.failure.admissionImpact === 'block')) {
    issues.push({
      code: usageLane.failure.issueCode,
      severity: usageLane.failure.admissionImpact === 'block' ? 'error' : 'warning',
      message: usageLane.failure.terminal
        ? 'The OAuth or message-metered scheduler lane has a terminal provider failure.'
        : usageLane.failure.admissionImpact === 'block'
          ? 'The OAuth or message-metered scheduler lane is under provider failure backoff.'
          : 'The OAuth or message-metered scheduler lane is operating in degraded provider-failure mode.',
      action: usageLane.failure.action
    });
  }
  if (usageLane.exhausted) {
    issues.push({
      code: usageLane.scopeBoundary.enforced && !usageLane.scopeBoundary.matches
        ? 'usage_lane_scope_backoff'
        : usageLane.failure.admissionImpact === 'block'
          ? usageLane.failure.issueCode
          : usageLane.history.enforcedBackoff ? 'usage_lane_history_backoff' : 'usage_lane_exhausted',
      severity: 'error',
      message: usageLane.scopeBoundary.enforced && !usageLane.scopeBoundary.matches
        ? 'The OAuth or message-metered scheduler lane is blocked by scope boundary enforcement.'
        : usageLane.failure.admissionImpact === 'block'
        ? 'The OAuth or message-metered scheduler lane is blocked by its provider failure state.'
        : usageLane.history.enforcedBackoff
        ? 'The OAuth or message-metered scheduler lane is in historical exhaustion backoff.'
        : 'The OAuth or message-metered scheduler lane is exhausted.',
      action: usageLane.resumeAt
        ? usageLane.resumeReason === 'lane-scope-boundary'
          ? 'Correct the lane tenant, workspace, or route metadata before scheduler admission can resume.'
          : `Resume this lane no earlier than ${usageLane.resumeAt}.`
        : 'Wait for the lane meter to reset before admitting more scheduler work.'
    });
  } else if (usageLane.admissionImpact === 'degrade') {
    issues.push({
      code: usageLane.failure.admissionImpact === 'degrade' ? usageLane.failure.issueCode : 'usage_lane_near_limit',
      severity: 'warning',
      message: usageLane.failure.admissionImpact === 'degrade'
        ? 'The OAuth or message-metered scheduler lane is degraded by provider failure state.'
        : 'The OAuth or message-metered scheduler lane is near its usage limit.',
      action: usageLane.failure.admissionImpact === 'degrade'
        ? usageLane.failure.action
        : 'Prefer lower-priority deferral or route new work to a lane with more remaining capacity.'
    });
  }
  return issues;
}

function applyUsageLaneBackoffPolicy(backoff, usageLane, generatedAt) {
  if (!usageLane.configured || usageLane.delayMs <= 0) return backoff;
  const delayMs = Math.max(backoff.delayMs, usageLane.delayMs);
  return {
    delayMs,
    nextRetryAt: new Date(new Date(generatedAt).getTime() + delayMs).toISOString(),
    source: delayMs > backoff.delayMs ? `usage-lane-${usageLane.resumeReason}` : backoff.source
  };
}

function normalizeFailure(input) {
  const failure = input.lastFailure && typeof input.lastFailure === 'object' ? input.lastFailure : {};
  const attempts = Math.max(0, Math.trunc(asFiniteNumber(input.retryAttempts, asFiniteNumber(failure.attempts, 0))));
  const retryable = failure.retryable !== false && input.retryable !== false;
  return {
    present: Boolean(failure.code || failure.message || attempts > 0),
    code: failure.code || null,
    message: failure.message || null,
    retryable,
    attempts
  };
}

function normalizeScope(input) {
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : {};
  const route = input.route && typeof input.route === 'object' ? input.route : {};
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  return {
    tenantId: String(input.tenantId || scope.tenantId || route.tenantId || 'anonymous'),
    workspaceId: String(input.workspaceId || scope.workspaceId || workspace.id || workspace.workspaceId || 'default'),
    routeId: String(input.routeId || scope.routeId || route.id || 'default'),
    queue: String(input.queue || scope.queue || route.queue || 'kernel'),
    priority: String(input.priority || scope.priority || 'normal')
  };
}

function normalizeTenantBoundary(input, scope) {
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const authz = input.authz && typeof input.authz === 'object' ? input.authz : {};
  const permissions = normalizeStringList(input.permissions || actor.permissions || authz.permissions);
  const roles = normalizeStringList(input.roles || actor.roles || authz.roles);
  const allowedTenantIds = normalizeStringList(input.allowedTenantIds || actor.allowedTenantIds || authz.allowedTenantIds);
  const requiredPermissions = normalizeStringList(input.requiredPermissions || authz.requiredPermissions);
  const effectiveRequiredPermissions = requiredPermissions.length > 0
    ? requiredPermissions
    : ['scheduler:usage:admit'];
  const workspaceTenantId = firstString(input.workspaceTenantId, workspace.tenantId, workspace.ownerTenantId) || scope.tenantId;
  const actorTenantId = firstString(input.actorTenantId, actor.tenantId, authz.tenantId) || scope.tenantId;
  const missingPermissions = effectiveRequiredPermissions.filter((permission) => !permissions.includes(permission) && !roles.includes('scheduler-admin'));
  const tenantAllowed = allowedTenantIds.length === 0 || allowedTenantIds.includes(scope.tenantId) || roles.includes('scheduler-admin');
  const workspaceTenantMatches = workspaceTenantId === scope.tenantId;
  const actorTenantMatches = actorTenantId === scope.tenantId || roles.includes('scheduler-admin');
  const isolationKey = [
    scope.tenantId,
    scope.workspaceId,
    scope.routeId,
    scope.queue
  ].map((part) => encodeURIComponent(part)).join('/');

  return {
    schema: 'aios.scheduler.usageBackoff.tenantBoundary.v1',
    enforced: authz.enforced !== false && input.enforceTenantBoundary !== false,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    workspaceTenantId,
    actor: {
      id: firstString(input.actorId, actor.id, actor.actorId, authz.actorId) || 'anonymous-actor',
      tenantId: actorTenantId,
      roles,
      permissions
    },
    requiredPermissions: effectiveRequiredPermissions,
    allowedTenantIds,
    isolationKey,
    checks: {
      tenantAllowed,
      workspaceTenantMatches,
      actorTenantMatches,
      permissionsSatisfied: missingPermissions.length === 0
    },
    missingPermissions
  };
}

function buildTenantBoundaryValidation(boundary) {
  if (!boundary.enforced) return [];
  const issues = [];
  if (!boundary.checks.tenantAllowed) {
    issues.push({
      code: 'tenant_boundary_denied',
      severity: 'error',
      message: 'Actor authorization does not include the scheduler tenant being evaluated.',
      action: 'Add the tenant to authz.allowedTenantIds or route the request to the correct tenant scope.'
    });
  }
  if (!boundary.checks.workspaceTenantMatches) {
    issues.push({
      code: 'workspace_tenant_mismatch',
      severity: 'error',
      message: 'Workspace ownership does not match the scheduler tenant scope.',
      action: 'Use a workspace owned by the tenant or switch scheduler scope to the workspace tenant.'
    });
  }
  if (!boundary.checks.actorTenantMatches) {
    issues.push({
      code: 'actor_tenant_mismatch',
      severity: 'error',
      message: 'Actor tenant does not match the scheduler tenant scope.',
      action: 'Re-authenticate under the tenant being scheduled or grant a scheduler-admin role for cross-tenant operations.'
    });
  }
  if (!boundary.checks.permissionsSatisfied) {
    issues.push({
      code: 'scheduler_permission_missing',
      severity: 'error',
      message: 'Actor lacks required scheduler usage admission permissions.',
      action: `Grant required permissions: ${boundary.missingPermissions.join(', ')}.`
    });
  }
  return issues;
}

function normalizeWorkspaceBoundary(input, scope, tenantBoundary, requestState) {
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const authz = input.authz && typeof input.authz === 'object' ? input.authz : {};
  const handoff = input.handoff && typeof input.handoff === 'object' ? input.handoff : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const workspaceAccess = input.workspaceAccess && typeof input.workspaceAccess === 'object'
    ? input.workspaceAccess
    : authz.workspaceAccess && typeof authz.workspaceAccess === 'object'
      ? authz.workspaceAccess
      : {};
  const allowedWorkspaceIds = normalizeStringList(
    input.allowedWorkspaceIds
      || workspaceAccess.allowedWorkspaceIds
      || actor.allowedWorkspaceIds
      || authz.allowedWorkspaceIds
  );
  const deniedWorkspaceIds = normalizeStringList(
    input.deniedWorkspaceIds
      || workspaceAccess.deniedWorkspaceIds
      || actor.deniedWorkspaceIds
      || authz.deniedWorkspaceIds
  );
  const workspaceRoles = normalizeStringList(
    input.workspaceRoles
      || workspaceAccess.roles
      || workspace.roles
      || actor.workspaceRoles
  );
  const requiredWorkspaceRoles = normalizeStringList(
    input.requiredWorkspaceRoles
      || workspaceAccess.requiredRoles
      || authz.requiredWorkspaceRoles
  );
  const effectiveRequiredWorkspaceRoles = requiredWorkspaceRoles.length > 0
    ? requiredWorkspaceRoles
    : ['scheduler-workspace-runner'];
  const requestedWorkspaceId = firstString(
    input.requestedWorkspaceId,
    request.workspaceId,
    request.workspace,
    workspaceAccess.requestedWorkspaceId,
    scope.workspaceId
  ) || scope.workspaceId;
  const handoffWorkspaceId = firstString(
    input.handoffWorkspaceId,
    handoff.workspaceId,
    handoff.targetWorkspaceId,
    request.handoffWorkspaceId
  ) || scope.workspaceId;
  const admin = tenantBoundary.actor.roles.includes('scheduler-admin');
  const workspaceAllowed = admin || allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(scope.workspaceId);
  const workspaceDenied = !admin && deniedWorkspaceIds.includes(scope.workspaceId);
  const requestedWorkspaceMatches = requestedWorkspaceId === scope.workspaceId;
  const handoffWorkspaceMatches = handoffWorkspaceId === scope.workspaceId;
  const workspaceRoleSatisfied = admin
    || tenantBoundary.actor.permissions.includes('scheduler:workspace:admit')
    || tenantBoundary.actor.permissions.includes('scheduler:usage:admit')
    || effectiveRequiredWorkspaceRoles.some((role) => workspaceRoles.includes(role));

  return {
    schema: 'aios.scheduler.usageBackoff.workspaceBoundary.v1',
    enforced: tenantBoundary.enforced && input.enforceWorkspaceBoundary !== false,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    requestedWorkspaceId,
    handoffWorkspaceId,
    allowedWorkspaceIds,
    deniedWorkspaceIds,
    requiredWorkspaceRoles: effectiveRequiredWorkspaceRoles,
    workspaceRoles,
    isolationKey: `${tenantBoundary.isolationKey}/workspace/${encodeURIComponent(scope.workspaceId)}`,
    stateStorePrefix: `scheduler/${encodeURIComponent(scope.tenantId)}/${encodeURIComponent(scope.workspaceId)}/`,
    checks: {
      workspaceAllowed,
      workspaceNotDenied: !workspaceDenied,
      requestedWorkspaceMatches,
      handoffWorkspaceMatches,
      workspaceRoleSatisfied
    },
    actor: {
      id: tenantBoundary.actor.id,
      tenantId: tenantBoundary.actor.tenantId
    },
    handoff: {
      requestId: requestState.requestId,
      target: requestState.workflow.handoffTarget,
      resumeTokenPresent: Boolean(requestState.workflow.resumeToken)
    }
  };
}

function buildWorkspaceBoundaryValidation(boundary) {
  if (!boundary.enforced) return [];
  const issues = [];
  if (!boundary.checks.workspaceAllowed) {
    issues.push({
      code: 'workspace_boundary_denied',
      severity: 'error',
      message: 'Actor authorization does not include the scheduler workspace being evaluated.',
      action: 'Add the workspace to authz.allowedWorkspaceIds or route the request to an authorized workspace.'
    });
  }
  if (!boundary.checks.workspaceNotDenied) {
    issues.push({
      code: 'workspace_explicitly_denied',
      severity: 'error',
      message: 'Actor authorization explicitly denies scheduler admission for this workspace.',
      action: 'Remove the workspace from deniedWorkspaceIds before attempting hosted-kernel admission.'
    });
  }
  if (!boundary.checks.requestedWorkspaceMatches) {
    issues.push({
      code: 'requested_workspace_mismatch',
      severity: 'error',
      message: 'The request workspace does not match the scheduler workspace scope.',
      action: 'Use the scoped workspace id for scheduler admission or evaluate a separate scheduler scope.'
    });
  }
  if (!boundary.checks.handoffWorkspaceMatches) {
    issues.push({
      code: 'handoff_workspace_mismatch',
      severity: 'error',
      message: 'The handoff target workspace does not match the scheduler workspace scope.',
      action: 'Keep workflow handoff, state persistence, and scheduler admission inside the same workspace boundary.'
    });
  }
  if (!boundary.checks.workspaceRoleSatisfied) {
    issues.push({
      code: 'workspace_scheduler_role_missing',
      severity: 'error',
      message: 'Actor lacks the workspace role or permission required for scheduler usage admission.',
      action: `Grant scheduler:workspace:admit or one workspace role: ${boundary.requiredWorkspaceRoles.join(', ')}.`
    });
  }
  return issues;
}

function firstString(...values) {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return value ? value.trim() : null;
}

function normalizeDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeRequestState(input, scope, now) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const workflow = input.workflow && typeof input.workflow === 'object' ? input.workflow : {};
  const headers = request.headers && typeof request.headers === 'object' ? request.headers : {};
  const timeoutMs = Math.max(0, asFiniteNumber(input.timeoutMs, asFiniteNumber(request.timeoutMs, asFiniteNumber(client.timeoutMs, 0))));
  const submittedAt = normalizeIso(input.submittedAt || request.submittedAt || request.startedAt || now);
  const requestedDeadline = normalizeDeadline(input.deadlineAt || request.deadlineAt || client.deadlineAt);
  const derivedDeadline = requestedDeadline || (timeoutMs > 0
    ? new Date(new Date(submittedAt).getTime() + timeoutMs).toISOString()
    : null);

  return {
    schema: 'aios.scheduler.usageBackoff.requestState.v1',
    requestId: firstString(input.requestId, request.id, request.requestId, headers['x-request-id']) || `${scope.tenantId}:${scope.routeId}:${submittedAt}`,
    traceId: firstString(input.traceId, request.traceId, headers.traceparent, headers['x-trace-id']),
    idempotencyKey: firstString(input.idempotencyKey, request.idempotencyKey, headers['idempotency-key']),
    submittedAt,
    deadlineAt: derivedDeadline,
    deadlineExpired: derivedDeadline ? new Date(derivedDeadline).getTime() <= new Date(now).getTime() : false,
    timeoutMs,
    operation: firstString(input.operation, request.operation, runtime.operation, workflow.operation) || 'scheduler-admission',
    channel: firstString(input.channel, client.channel, request.channel) || 'kernel-client',
    client: {
      id: firstString(input.clientId, client.id, client.clientId) || 'anonymous-client',
      kind: firstString(input.clientKind, client.kind, client.type) || 'unknown',
      runtime: firstString(input.runtimeId, runtime.id, runtime.name, client.runtime) || 'hosted-kernel',
      sdk: firstString(input.sdk, client.sdk, client.userAgent, headers['user-agent'])
    },
    workflow: {
      id: firstString(input.workflowId, workflow.id, request.workflowId),
      stepId: firstString(input.workflowStepId, workflow.stepId, workflow.currentStepId, request.workflowStepId),
      resumeToken: firstString(input.resumeToken, workflow.resumeToken, request.resumeToken),
      handoffTarget: firstString(input.handoffTarget, workflow.handoffTarget, request.handoffTarget) || 'client-runtime'
    }
  };
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeLifecycleSettings(input, now) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const lifecycle = input.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const command = firstString(input.command, lifecycle.command, settings.command, scheduler.command) || 'evaluate';
  const normalizedCommand = command.toLowerCase();
  const allowedCommands = ['evaluate', 'enable', 'disable', 'pause', 'resume', 'drain'];
  const commandAccepted = allowedCommands.includes(normalizedCommand);
  const rawPausedUntil = normalizeDeadline(input.pausedUntil || lifecycle.pausedUntil || settings.pausedUntil || scheduler.pausedUntil);
  const resumeDelayMs = Math.max(0, Math.trunc(asFiniteNumber(
    input.resumeDelayMs,
    asFiniteNumber(lifecycle.resumeDelayMs, asFiniteNumber(settings.resumeDelayMs, asFiniteNumber(scheduler.resumeDelayMs, 0)))
  )));
  const commandResumeAt = normalizedCommand === 'pause' && !rawPausedUntil && resumeDelayMs > 0
    ? new Date(new Date(now).getTime() + resumeDelayMs).toISOString()
    : null;
  const requestedPausedUntil = rawPausedUntil || commandResumeAt;
  const requestedPausedActive = Boolean(requestedPausedUntil && new Date(requestedPausedUntil).getTime() > new Date(now).getTime());
  const requestedEnabled = asBoolean(input.enabled, asBoolean(lifecycle.enabled, asBoolean(settings.enabled, asBoolean(scheduler.enabled, true))));
  const requestedSchedulingEnabled = asBoolean(
    input.schedulingEnabled,
    asBoolean(lifecycle.schedulingEnabled, asBoolean(settings.schedulingEnabled, asBoolean(scheduler.schedulingEnabled, requestedEnabled)))
  );
  const requestedDrainMode = asBoolean(input.drainMode, asBoolean(lifecycle.drainMode, asBoolean(settings.drainMode, normalizedCommand === 'drain')));
  const mutatesState = commandAccepted && normalizedCommand !== 'evaluate';
  const enabled = commandAccepted && ['enable', 'resume'].includes(normalizedCommand)
    ? true
    : commandAccepted && normalizedCommand === 'disable'
      ? false
      : requestedEnabled;
  const schedulingEnabled = commandAccepted && ['enable', 'resume'].includes(normalizedCommand)
    ? true
    : commandAccepted && ['disable', 'pause', 'drain'].includes(normalizedCommand)
      ? false
      : requestedSchedulingEnabled;
  const pausedUntil = commandAccepted && ['enable', 'resume', 'disable'].includes(normalizedCommand)
    ? null
    : requestedPausedUntil;
  const pausedActive = Boolean(pausedUntil && new Date(pausedUntil).getTime() > new Date(now).getTime());
  const drainMode = commandAccepted && normalizedCommand === 'drain'
    ? true
    : commandAccepted && ['enable', 'resume', 'disable'].includes(normalizedCommand)
      ? false
      : requestedDrainMode;
  const maxConcurrent = Math.max(0, Math.trunc(asFiniteNumber(
    input.maxConcurrent,
    asFiniteNumber(lifecycle.maxConcurrent, asFiniteNumber(settings.maxConcurrent, asFiniteNumber(scheduler.maxConcurrent, Number.POSITIVE_INFINITY)))
  )));
  const activeLeases = Math.max(0, Math.trunc(asFiniteNumber(
    input.activeLeases,
    asFiniteNumber(lifecycle.activeLeases, asFiniteNumber(settings.activeLeases, asFiniteNumber(scheduler.activeLeases, 0)))
  )));
  const retryFloorMs = Math.max(0, Math.trunc(asFiniteNumber(
    input.minRetryDelayMs,
    asFiniteNumber(lifecycle.minRetryDelayMs, asFiniteNumber(settings.minRetryDelayMs, 0))
  )));

  return {
    schema: 'aios.scheduler.usageBackoff.lifecycleSettings.v1',
    command: normalizedCommand,
    allowedCommands,
    commandAccepted,
    mutatesState,
    commandEffect: !commandAccepted
      ? 'invalid'
      : normalizedCommand === 'evaluate'
        ? 'read'
        : normalizedCommand,
    requested: {
      enabled: requestedEnabled,
      schedulingEnabled: requestedSchedulingEnabled,
      pausedUntil: requestedPausedUntil,
      pausedActive: requestedPausedActive,
      drainMode: requestedDrainMode,
      resumeDelayMs
    },
    effective: {
      enabled,
      schedulingEnabled,
      pausedUntil,
      pausedActive,
      drainMode,
      autoResumeAt: pausedActive ? pausedUntil : null,
      admitsNewWork: enabled && schedulingEnabled && !pausedActive && !drainMode
    },
    enabled,
    schedulingEnabled,
    pausedUntil,
    pausedActive,
    drainMode,
    concurrency: {
      max: Number.isFinite(maxConcurrent) ? maxConcurrent : null,
      active: activeLeases,
      remaining: Number.isFinite(maxConcurrent) ? Math.max(0, maxConcurrent - activeLeases) : null,
      exhausted: Number.isFinite(maxConcurrent) && activeLeases >= maxConcurrent
    },
    retryPolicy: {
      floorMs: retryFloorMs
    }
  };
}

function buildLifecycleValidation(settings) {
  const issues = [];
  if (!settings.commandAccepted) {
    issues.push({
      code: 'invalid_lifecycle_command',
      severity: 'error',
      message: 'Scheduler lifecycle command is not supported by the usage-backoff surface.',
      action: `Use one of: ${settings.allowedCommands.join(', ')}.`
    });
  }
  if (!settings.enabled) {
    issues.push({
      code: 'scheduler_disabled',
      severity: 'error',
      message: settings.command === 'disable'
        ? 'Disable command will stop scheduler usage admission for this hosted-kernel lifecycle.'
        : 'Scheduler usage admission is disabled for this hosted-kernel lifecycle.',
      action: settings.command === 'disable'
        ? 'Persist the disabled lifecycle state and reject or defer new hosted-kernel work.'
        : 'Enable scheduler usage admission before enqueueing new work.'
    });
  }
  if (!settings.schedulingEnabled) {
    issues.push({
      code: 'scheduling_paused',
      severity: 'warning',
      message: settings.pausedActive
        ? 'Scheduler usage admission is paused until the configured timestamp.'
        : 'Scheduler usage admission is paused without an active future resume timestamp.',
      action: settings.pausedUntil
        ? `Resume scheduling after ${settings.pausedUntil} or issue a resume command.`
        : 'Issue a resume command or configure pausedUntil for an auditable deferred resume.'
    });
  }
  if (settings.command === 'pause' && !settings.pausedUntil) {
    issues.push({
      code: 'pause_until_missing',
      severity: 'warning',
      message: 'Pause command did not include pausedUntil.',
      action: 'Attach pausedUntil so clients receive a deterministic resume time.'
    });
  }
  if (settings.command === 'resume' && settings.requested.pausedActive && settings.pausedActive) {
    issues.push({
      code: 'resume_command_not_projected',
      severity: 'error',
      message: 'Resume command did not clear the active scheduler pause.',
      action: 'Clear pausedUntil or use the lifecycle resume command path that projects schedulingEnabled to true.'
    });
  }
  if (settings.command === 'enable' && !settings.effective.admitsNewWork && !settings.drainMode && !settings.pausedActive) {
    issues.push({
      code: 'enable_command_not_scheduling',
      severity: 'warning',
      message: 'Enable command did not produce an immediately schedulable lifecycle state.',
      action: 'Set schedulingEnabled to true or issue a resume command to reopen scheduler admission.'
    });
  }
  if (settings.drainMode) {
    issues.push({
      code: 'scheduler_draining',
      severity: 'error',
      message: 'Scheduler is draining and cannot admit new usage-backed work.',
      action: 'Wait for active leases to finish or send a resume command after drain completes.'
    });
  }
  if (settings.concurrency.exhausted) {
    issues.push({
      code: 'scheduler_concurrency_exhausted',
      severity: 'error',
      message: 'Scheduler active leases reached the configured lifecycle concurrency limit.',
      action: 'Wait for an active lease to release or raise maxConcurrent for this scheduler lifecycle.'
    });
  }
  return issues;
}

function calculateBackoff(input, failure, generatedAt) {
  const baseMs = Math.max(1, asFiniteNumber(input.baseBackoffMs, DEFAULT_BASE_BACKOFF_MS));
  const maxMs = Math.max(baseMs, asFiniteNumber(input.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS));
  const retryAfterMs = input.retryAfterMs == null ? null : Math.max(0, asFiniteNumber(input.retryAfterMs, 0));
  const exponentialMs = Math.min(maxMs, baseMs * (2 ** Math.min(failure.attempts, 10)));
  const delayMs = failure.present && failure.retryable ? Math.max(retryAfterMs ?? 0, exponentialMs) : 0;
  const nextRetryAt = delayMs > 0 ? new Date(new Date(generatedAt).getTime() + delayMs).toISOString() : null;
  return {
    delayMs,
    nextRetryAt,
    source: retryAfterMs != null && retryAfterMs >= exponentialMs ? 'retry-after' : failure.present ? 'exponential' : 'none'
  };
}

function applyLifecycleBackoffPolicy(backoff, lifecycleSettings, generatedAt) {
  const pauseDelayMs = lifecycleSettings.pausedActive
    ? Math.max(0, new Date(lifecycleSettings.pausedUntil).getTime() - new Date(generatedAt).getTime())
    : 0;
  const floorMs = lifecycleSettings.retryPolicy.floorMs;
  const delayMs = Math.max(backoff.delayMs, pauseDelayMs, backoff.delayMs > 0 ? floorMs : 0);
  return {
    delayMs,
    nextRetryAt: delayMs > 0 ? new Date(new Date(generatedAt).getTime() + delayMs).toISOString() : null,
    source: pauseDelayMs > backoff.delayMs && pauseDelayMs >= floorMs
      ? 'lifecycle-pause'
      : delayMs > backoff.delayMs
        ? 'lifecycle-floor'
        : backoff.source
  };
}

function normalizeOperationalHealth(input, now, history, failure) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const health = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.health && typeof input.health === 'object'
      ? input.health
      : scheduler.health && typeof scheduler.health === 'object'
        ? scheduler.health
        : runtime.health && typeof runtime.health === 'object'
          ? runtime.health
          : {};
  const healthConfigured = Boolean(
    input.operationalHealth
    || scheduler.health
    || runtime.health
    || input.lastHeartbeatAt
    || input.telemetryAt
    || input.dependencyState
    || input.recentErrors
    || input.healthStaleAfterMs
    || input.errorBurstLimit
    || input.healthRetryAfterMs
    || input.degradedMode
    || input.failClosed
    || Object.keys(health).length > 0
  );
  const dependencyState = String(firstString(
    input.dependencyState,
    health.dependencyState,
    health.status,
    runtime.dependencyState,
    scheduler.dependencyState
  ) || 'ready').toLowerCase();
  const lastHeartbeatAt = normalizeDeadline(input.lastHeartbeatAt || health.lastHeartbeatAt || health.heartbeatAt || runtime.lastHeartbeatAt);
  const telemetryAt = normalizeDeadline(input.telemetryAt || health.telemetryAt || health.observedAt || health.generatedAt);
  const referenceAt = lastHeartbeatAt || telemetryAt;
  const staleAfterMs = Math.max(1, Math.trunc(asFiniteNumber(input.healthStaleAfterMs, asFiniteNumber(health.staleAfterMs, DEFAULT_HEALTH_STALE_AFTER_MS))));
  const ageMs = referenceAt ? Math.max(0, new Date(now).getTime() - new Date(referenceAt).getTime()) : null;
  const telemetryMissing = healthConfigured && !referenceAt;
  const telemetryStale = healthConfigured && ageMs != null ? ageMs > staleAfterMs : false;
  const failClosed = asBoolean(input.failClosed, asBoolean(health.failClosed, true));
  const degradedMode = asBoolean(input.degradedMode, asBoolean(health.degradedMode, dependencyState === 'degraded'));
  const dependencyDown = ['down', 'failed', 'failing', 'unavailable', 'disconnected', 'offline'].includes(dependencyState);
  const incidents = Array.isArray(health.incidents)
    ? health.incidents.filter((incident) => incident && typeof incident === 'object')
    : [];
  const activeIncidents = incidents.filter((incident) => {
    const state = String(firstString(incident.state, incident.status) || 'active').toLowerCase();
    return !['resolved', 'closed', 'mitigated'].includes(state);
  });
  const explicitErrors = Array.isArray(health.errors)
    ? health.errors.filter((entry) => entry && typeof entry === 'object')
    : Array.isArray(input.recentErrors)
      ? input.recentErrors.filter((entry) => entry && typeof entry === 'object')
      : [];
  const recentHistoryErrors = history.slice(-5).reduce((total, snapshot) => total + Math.max(0, snapshot.errorCount || 0), 0);
  const recentErrorCount = explicitErrors.length > 0
    ? explicitErrors.length
    : recentHistoryErrors + (failure.present ? 1 : 0);
  const errorBurstLimit = Math.max(1, Math.trunc(asFiniteNumber(input.errorBurstLimit, asFiniteNumber(health.errorBurstLimit, DEFAULT_ERROR_BURST_LIMIT))));
  const errorBurst = healthConfigured && recentErrorCount >= errorBurstLimit;
  const retryAfterMs = Math.max(0, Math.trunc(asFiniteNumber(input.healthRetryAfterMs, asFiniteNumber(health.retryAfterMs, 0))));
  const blocking = dependencyDown || (failClosed && (telemetryMissing || telemetryStale || errorBurst || activeIncidents.length > 0));
  const degraded = !blocking && healthConfigured && (degradedMode || telemetryMissing || telemetryStale || errorBurst || activeIncidents.length > 0);
  const issueCodes = [
    ...(dependencyDown ? ['operational_dependency_down'] : []),
    ...(telemetryMissing ? ['operational_telemetry_missing'] : []),
    ...(telemetryStale ? ['operational_telemetry_stale'] : []),
    ...(errorBurst ? ['operational_error_burst'] : []),
    ...(activeIncidents.length > 0 ? ['operational_incident_active'] : []),
    ...(degradedMode ? ['operational_degraded_mode'] : [])
  ];

  return {
    schema: 'aios.scheduler.usageBackoff.operationalHealth.v1',
    generatedAt: now,
    configured: healthConfigured,
    status: blocking ? 'blocked' : degraded ? 'degraded' : 'healthy',
    admissionImpact: blocking ? 'block' : degraded ? 'degrade' : 'allow',
    failClosed,
    degradedMode,
    dependency: {
      state: dependencyState,
      down: dependencyDown
    },
    telemetry: {
      lastHeartbeatAt,
      telemetryAt,
      referenceAt,
      ageMs,
      staleAfterMs,
      missing: telemetryMissing,
      stale: telemetryStale
    },
    errors: {
      recentCount: recentErrorCount,
      burstLimit: errorBurstLimit,
      burst: errorBurst,
      codes: explicitErrors.map((entry) => firstString(entry.code, entry.type) || 'unknown_error')
    },
    incidents: activeIncidents.map((incident) => ({
      id: firstString(incident.id, incident.incidentId) || 'active-incident',
      severity: firstString(incident.severity, incident.level) || 'warning',
      summary: firstString(incident.summary, incident.message) || 'Active scheduler operational incident'
    })),
    retryAfterMs,
    issueCodes
  };
}

function applyOperationalHealthBackoffPolicy(backoff, operationalHealth, generatedAt) {
  if (operationalHealth.admissionImpact === 'allow' || operationalHealth.retryAfterMs <= 0) return backoff;
  const delayMs = Math.max(backoff.delayMs, operationalHealth.retryAfterMs);
  return {
    delayMs,
    nextRetryAt: new Date(new Date(generatedAt).getTime() + delayMs).toISOString(),
    source: delayMs > backoff.delayMs ? 'operational-health' : backoff.source
  };
}

function buildOperationalHealthValidation(operationalHealth) {
  const issues = [];
  if (operationalHealth.dependency.down) {
    issues.push({
      code: 'operational_dependency_down',
      severity: 'error',
      message: 'Scheduler dependency health is down for this hosted-kernel admission path.',
      action: 'Restore the scheduler dependency or route work to a healthy provider before admitting new usage-backed work.'
    });
  }
  if (operationalHealth.telemetry.missing) {
    issues.push({
      code: 'operational_telemetry_missing',
      severity: operationalHealth.failClosed ? 'error' : 'warning',
      message: 'Scheduler operational telemetry is missing for this evaluation.',
      action: 'Publish a current scheduler heartbeat or disable failClosed only for an explicitly degraded recovery path.'
    });
  } else if (operationalHealth.telemetry.stale) {
    issues.push({
      code: 'operational_telemetry_stale',
      severity: operationalHealth.failClosed ? 'error' : 'warning',
      message: 'Scheduler operational telemetry is older than the configured freshness window.',
      action: 'Refresh scheduler health telemetry before admitting hosted-kernel work.'
    });
  }
  if (operationalHealth.errors.burst) {
    issues.push({
      code: 'operational_error_burst',
      severity: operationalHealth.failClosed ? 'error' : 'warning',
      message: 'Recent scheduler errors exceeded the operational burst threshold.',
      action: 'Hold admission, inspect recent scheduler errors, and resume after the error burst clears.'
    });
  }
  if (operationalHealth.incidents.length > 0) {
    issues.push({
      code: 'operational_incident_active',
      severity: operationalHealth.failClosed ? 'error' : 'warning',
      message: 'Active scheduler operational incidents are attached to this admission path.',
      action: 'Resolve or explicitly mitigate active scheduler incidents before accepting new work.'
    });
  }
  if (operationalHealth.degradedMode && operationalHealth.admissionImpact !== 'block') {
    issues.push({
      code: 'operational_degraded_mode',
      severity: 'warning',
      message: 'Scheduler is running in degraded mode and should only admit work with reduced expectations.',
      action: 'Keep retry and handoff contracts active until scheduler health returns to healthy.'
    });
  }
  return issues;
}

function buildRequestValidation(requestState) {
  const issues = [];
  if (requestState.deadlineExpired) {
    issues.push({
      code: 'request_deadline_expired',
      severity: 'error',
      message: 'Scheduler admission cannot continue because the client request deadline has expired.',
      action: 'Start a new client request with a fresh deadline or extend the workflow timeout before retrying.'
    });
  }
  if (!requestState.idempotencyKey && requestState.workflow.resumeToken) {
    issues.push({
      code: 'resume_without_idempotency_key',
      severity: 'warning',
      message: 'A workflow resume token was supplied without an idempotency key.',
      action: 'Attach an idempotency key so deferred scheduler handoffs can be safely retried by the client runtime.'
    });
  }
  if (!requestState.traceId) {
    issues.push({
      code: 'request_trace_missing',
      severity: 'info',
      message: 'No trace id was supplied for this scheduler usage decision.',
      action: 'Pass request.traceId or x-trace-id to connect scheduler admission with hosted-kernel audit trails.'
    });
  }
  return issues;
}

function normalizeHistory(input) {
  const history = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : [];
  const limit = clamp(Math.trunc(asFiniteNumber(input.historyLimit, DEFAULT_HISTORY_LIMIT)), 1, 100);
  return history.slice(-limit).map((entry, index) => {
    const record = entry && typeof entry === 'object' ? entry : {};
    const limits = normalizeLimits(record);
    const mode = typeof record.mode === 'string'
      ? record.mode
      : record.blocked
        ? 'blocked'
        : record.degraded
          ? 'degraded'
          : limits.pressure >= DEFAULT_BLOCKED_AT
            ? 'blocked'
            : limits.pressure >= DEFAULT_DEGRADED_AT
              ? 'degraded'
              : 'healthy';
    const retryDelayMs = Math.max(0, asFiniteNumber(record.retryDelayMs, asFiniteNumber(record.delayMs, 0)));
    return {
      sequence: Math.max(0, Math.trunc(asFiniteNumber(record.sequence, index))),
      observedAt: normalizeIso(record.observedAt || record.generatedAt || record.at),
      mode,
      admitted: record.admitted == null ? mode !== 'blocked' && retryDelayMs === 0 : Boolean(record.admitted),
      pressure: limits.pressure,
      remaining: limits.remaining,
      retryDelayMs,
      errorCount: Math.max(0, Math.trunc(asFiniteNumber(record.errorCount, 0)))
    };
  });
}

function buildAnalytics(limits, failure, backoff, mode, admitted, errors, history) {
  const samples = [...history, {
    sequence: history.length,
    observedAt: null,
    mode,
    admitted,
    pressure: limits.pressure,
    remaining: limits.remaining,
    retryDelayMs: backoff.delayMs,
    errorCount: errors.length
  }];
  const counters = samples.reduce((acc, sample) => {
    acc.samples += 1;
    acc.byMode[sample.mode] = (acc.byMode[sample.mode] || 0) + 1;
    if (sample.admitted) acc.admitted += 1;
    if (sample.retryDelayMs > 0) acc.retryDelayed += 1;
    if (sample.errorCount > 0) acc.withErrors += 1;
    acc.totalRetryDelayMs += sample.retryDelayMs;
    acc.peakPressure = Math.max(acc.peakPressure, sample.pressure);
    acc.lowestRemaining = Math.min(acc.lowestRemaining, sample.remaining);
    return acc;
  }, {
    samples: 0,
    admitted: 0,
    retryDelayed: 0,
    withErrors: 0,
    totalRetryDelayMs: 0,
    peakPressure: 0,
    lowestRemaining: Number.POSITIVE_INFINITY,
    byMode: { healthy: 0, degraded: 0, blocked: 0 }
  });
  const averageRetryDelayMs = counters.samples > 0 ? Math.round(counters.totalRetryDelayMs / counters.samples) : 0;
  const consecutiveBlocked = [...samples].reverse().findIndex((sample) => sample.mode !== 'blocked');
  return {
    counters: {
      samples: counters.samples,
      admitted: counters.admitted,
      denied: counters.samples - counters.admitted,
      retryDelayed: counters.retryDelayed,
      withErrors: counters.withErrors,
      healthy: counters.byMode.healthy || 0,
      degraded: counters.byMode.degraded || 0,
      blocked: counters.byMode.blocked || 0,
      nonRetryableFailures: failure.present && !failure.retryable ? 1 : 0
    },
    gauges: {
      pressurePct: Math.round(limits.pressure * 100),
      peakPressurePct: Math.round(counters.peakPressure * 100),
      remainingWindowCapacity: limits.remaining,
      lowestRemainingWindowCapacity: Number.isFinite(counters.lowestRemaining) ? counters.lowestRemaining : limits.remaining,
      averageRetryDelayMs,
      currentRetryDelayMs: backoff.delayMs
    },
    streaks: {
      consecutiveBlocked: consecutiveBlocked === -1 ? samples.length : consecutiveBlocked,
      currentFailureAttempts: failure.attempts
    }
  };
}

function buildTimeline(now, history, limits, backoff, mode, admitted, errors) {
  const historicalEvents = history.map((snapshot) => ({
    at: snapshot.observedAt,
    type: 'history-snapshot',
    mode: snapshot.mode,
    admitted: snapshot.admitted,
    pressurePct: Math.round(snapshot.pressure * 100),
    retryDelayMs: snapshot.retryDelayMs,
    errorCount: snapshot.errorCount
  }));
  return [
    ...historicalEvents,
    {
      at: now,
      type: 'current-evaluation',
      mode,
      admitted,
      pressurePct: Math.round(limits.pressure * 100),
      remainingWindowCapacity: limits.remaining,
      retryDelayMs: backoff.delayMs,
      errorCount: errors.length
    }
  ];
}

function buildUsageLaneAnalytics(now, scope, usageLane, admissionCost, usageLaneResumeHandoff, mode, admitted) {
  const configured = usageLane.configured;
  const historySamples = configured ? usageLane.history.samples : [];
  const rejectedSamples = configured ? usageLane.history.rejectedSamples : [];
  const currentSnapshot = {
    sequence: historySamples.length,
    observedAt: now,
    laneId: configured ? usageLane.id : null,
    kind: configured ? usageLane.kind : null,
    exhausted: configured ? usageLane.exhausted : false,
    pressurePct: configured ? usageLane.pressurePct : null,
    remaining: configured ? usageLane.remaining : null,
    retryAfterMs: configured ? usageLane.retryAfterMs : 0,
    resetAt: configured ? usageLane.resetAt : null,
    resumeAt: configured ? usageLane.resumeAt : null,
    resumeReason: configured ? usageLane.resumeReason : 'none',
    admissionImpact: configured ? usageLane.admissionImpact : 'allow',
    admitted,
    mode
  };
  const snapshots = configured
    ? [...historySamples, currentSnapshot].map((sample, index) => ({
        sequence: sample.sequence == null ? index : sample.sequence,
        observedAt: sample.observedAt,
        laneId: sample.laneId || usageLane.id,
        kind: sample.kind || usageLane.kind,
        exhausted: Boolean(sample.exhausted),
        pressurePct: sample.pressurePct == null ? null : sample.pressurePct,
        remaining: sample.remaining == null ? null : sample.remaining,
        retryAfterMs: Math.max(0, Math.trunc(asFiniteNumber(sample.retryAfterMs, 0))),
        resetAt: sample.resetAt || null,
        resumeAt: sample.resumeAt || null,
        resumeReason: sample.resumeReason || (sample.resumeAt ? 'history-resume' : 'none'),
        admissionImpact: sample.admissionImpact || (sample.exhausted ? 'block' : 'allow'),
        admitted: sample.admitted == null ? !sample.exhausted : Boolean(sample.admitted),
        mode: sample.mode || (sample.exhausted ? 'blocked' : 'healthy')
      }))
    : [currentSnapshot];
  const counters = snapshots.reduce((acc, snapshot) => {
    acc.samples += 1;
    if (snapshot.exhausted) acc.exhausted += 1;
    if (snapshot.admissionImpact === 'block') acc.blocked += 1;
    if (snapshot.admissionImpact === 'degrade') acc.degraded += 1;
    if (snapshot.retryAfterMs > 0 || snapshot.resumeAt) acc.resumeScheduled += 1;
    if (snapshot.admitted) acc.admitted += 1;
    if (snapshot.pressurePct != null) acc.peakPressurePct = Math.max(acc.peakPressurePct, snapshot.pressurePct);
    if (snapshot.remaining != null) acc.lowestRemaining = Math.min(acc.lowestRemaining, snapshot.remaining);
    return acc;
  }, {
    samples: 0,
    exhausted: 0,
    blocked: 0,
    degraded: 0,
    resumeScheduled: 0,
    admitted: 0,
    peakPressurePct: 0,
    lowestRemaining: Number.POSITIVE_INFINITY
  });
  const transitions = snapshots.slice(1).map((snapshot, index) => {
    const prior = snapshots[index];
    return {
      at: snapshot.observedAt,
      from: prior.admissionImpact,
      to: snapshot.admissionImpact,
      changed: prior.admissionImpact !== snapshot.admissionImpact,
      pressureDeltaPct: snapshot.pressurePct != null && prior.pressurePct != null ? snapshot.pressurePct - prior.pressurePct : null,
      remainingDelta: snapshot.remaining != null && prior.remaining != null ? snapshot.remaining - prior.remaining : null
    };
  });
  const resumeCandidates = snapshots
    .filter((snapshot) => snapshot.resumeAt)
    .map((snapshot) => ({
      at: snapshot.resumeAt,
      source: snapshot.resumeReason,
      delayMs: Math.max(0, new Date(snapshot.resumeAt).getTime() - new Date(now).getTime()),
      sequence: snapshot.sequence
    }))
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  const timeline = [
    ...snapshots.map((snapshot) => ({
      at: snapshot.observedAt,
      type: snapshot.sequence === currentSnapshot.sequence ? 'usage-lane-current' : 'usage-lane-history',
      laneId: snapshot.laneId,
      admissionImpact: snapshot.admissionImpact,
      exhausted: snapshot.exhausted,
      pressurePct: snapshot.pressurePct,
      remaining: snapshot.remaining,
      resumeAt: snapshot.resumeAt
    })),
    ...rejectedSamples.map((sample) => ({
      at: sample.observedAt,
      type: 'usage-lane-history-rejected',
      laneId: sample.laneId,
      mismatchCodes: sample.mismatchCodes
    }))
  ].sort((left, right) => new Date(left.at || now).getTime() - new Date(right.at || now).getTime());

  return {
    schema: 'aios.scheduler.usageBackoff.usageLaneAnalytics.v1',
    generatedAt: now,
    scope,
    configured,
    laneId: configured ? usageLane.id : null,
    laneKind: configured ? usageLane.kind : null,
    current: currentSnapshot,
    counters: {
      samples: counters.samples,
      exhausted: counters.exhausted,
      blocked: counters.blocked,
      degraded: counters.degraded,
      resumeScheduled: counters.resumeScheduled,
      admitted: counters.admitted,
      peakPressurePct: counters.peakPressurePct,
      lowestRemaining: Number.isFinite(counters.lowestRemaining) ? counters.lowestRemaining : configured ? usageLane.remaining : null,
      rejectedSamples: rejectedSamples.length,
      nonRetryableFailures: configured && usageLane.failure.configured && !usageLane.failure.retryable ? 1 : 0,
      terminalFailures: configured && usageLane.failure.terminal ? 1 : 0,
      requestedLaneUnits: configured ? admissionCost.laneUnits : 0,
      laneCostDenied: configured && !admissionCost.laneFits ? 1 : 0,
      resumeEligible: usageLaneResumeHandoff.eligibleForResume ? 1 : 0
    },
    gauges: {
      pressurePct: configured ? usageLane.pressurePct : null,
      peakPressurePct: counters.peakPressurePct,
      remaining: configured ? usageLane.remaining : null,
      lowestRemaining: Number.isFinite(counters.lowestRemaining) ? counters.lowestRemaining : configured ? usageLane.remaining : null,
      consecutiveExhausted: configured ? usageLane.history.consecutiveExhausted : 0,
      rejectedSampleCount: rejectedSamples.length,
      nextResumeDelayMs: resumeCandidates[0]?.delayMs || 0
    },
    resume: {
      next: resumeCandidates[0] || null,
      candidates: resumeCandidates.slice(0, 5),
      handoffState: usageLaneResumeHandoff.state,
      eligibleForResume: usageLaneResumeHandoff.eligibleForResume,
      command: usageLaneResumeHandoff.routeContract.command
    },
    snapshots,
    exportRows: snapshots.map((snapshot) => ({
      generatedAt: now,
      observedAt: snapshot.observedAt,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      routeId: scope.routeId,
      queue: scope.queue,
      laneId: snapshot.laneId,
      laneKind: snapshot.kind,
      exhausted: snapshot.exhausted,
      admissionImpact: snapshot.admissionImpact,
      pressurePct: snapshot.pressurePct,
      remaining: snapshot.remaining,
      retryAfterMs: snapshot.retryAfterMs,
      resumeAt: snapshot.resumeAt,
      resumeReason: snapshot.resumeReason
    })),
    rejectedRows: rejectedSamples.map((sample) => ({
      generatedAt: now,
      observedAt: sample.observedAt,
      tenantId: sample.tenantId,
      workspaceId: sample.workspaceId,
      routeId: sample.routeId,
      laneId: sample.laneId,
      mismatchCodes: sample.mismatchCodes
    })),
    transitions,
    timeline
  };
}

function buildCurrentHistorySnapshot(now, scope, limits, failure, backoff, mode, admitted, errors) {
  return {
    schema: 'aios.scheduler.usageBackoff.historySnapshot.v1',
    sequence: null,
    observedAt: now,
    tenantId: scope.tenantId,
    routeId: scope.routeId,
    queue: scope.queue,
    priority: scope.priority,
    mode,
    admitted,
    pressure: limits.pressure,
    pressurePct: Math.round(limits.pressure * 100),
    remaining: limits.remaining,
    retryDelayMs: backoff.delayMs,
    retryable: failure.retryable,
    failureAttempts: failure.attempts,
    errorCount: errors.length,
    errorCodes: errors.map((issue) => issue.code)
  };
}

function buildReportingState(now, scope, history, currentSnapshot, analytics, timeline) {
  const snapshots = [...history, currentSnapshot].map((snapshot, index) => ({
    sequence: snapshot.sequence == null ? index : snapshot.sequence,
    observedAt: snapshot.observedAt,
    mode: snapshot.mode,
    admitted: snapshot.admitted,
    pressurePct: snapshot.pressurePct ?? Math.round(snapshot.pressure * 100),
    remaining: snapshot.remaining,
    retryDelayMs: snapshot.retryDelayMs,
    errorCount: snapshot.errorCount
  }));
  const latest = snapshots[snapshots.length - 1] || null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const transitions = snapshots.slice(1).map((snapshot, index) => {
    const prior = snapshots[index];
    return {
      at: snapshot.observedAt,
      from: prior.mode,
      to: snapshot.mode,
      changed: prior.mode !== snapshot.mode,
      pressureDeltaPct: snapshot.pressurePct - prior.pressurePct,
      remainingDelta: snapshot.remaining - prior.remaining,
      retryDelayDeltaMs: snapshot.retryDelayMs - prior.retryDelayMs
    };
  });
  const changedTransitions = transitions.filter((transition) => transition.changed);
  const pressureDeltaPct = previous && latest ? latest.pressurePct - previous.pressurePct : 0;
  const remainingDelta = previous && latest ? latest.remaining - previous.remaining : 0;
  const retryDelayDeltaMs = previous && latest ? latest.retryDelayMs - previous.retryDelayMs : 0;
  const alertLevel = latest?.mode === 'blocked' || analytics.counters.withErrors > 0
    ? 'page'
    : latest?.mode === 'degraded' || analytics.gauges.peakPressurePct >= 85
      ? 'watch'
      : 'normal';

  return {
    schema: 'aios.scheduler.usageBackoff.reporting.v1',
    generatedAt: now,
    scope,
    window: {
      firstObservedAt: snapshots[0]?.observedAt || now,
      lastObservedAt: latest?.observedAt || now,
      sampleCount: snapshots.length
    },
    trend: {
      pressureDeltaPct,
      remainingDelta,
      retryDelayDeltaMs,
      latestMode: latest?.mode || 'unknown',
      previousMode: previous?.mode || null,
      transitionCount: changedTransitions.length,
      lastTransition: changedTransitions[changedTransitions.length - 1] || null
    },
    alert: {
      level: alertLevel,
      reason: alertLevel === 'page'
        ? 'Scheduler usage is blocked or has actionable errors.'
        : alertLevel === 'watch'
          ? 'Scheduler usage is degraded or near the configured pressure ceiling.'
          : 'Scheduler usage is healthy for the observed window.'
    },
    exportRows: snapshots.map((snapshot) => ({
      generatedAt: now,
      observedAt: snapshot.observedAt,
      tenantId: scope.tenantId,
      routeId: scope.routeId,
      queue: scope.queue,
      priority: scope.priority,
      mode: snapshot.mode,
      admitted: snapshot.admitted,
      pressurePct: snapshot.pressurePct,
      remaining: snapshot.remaining,
      retryDelayMs: snapshot.retryDelayMs,
      errorCount: snapshot.errorCount
    })),
    transitions,
    timelineEventCount: timeline.length
  };
}

function buildValidationSummary(validation, errors) {
  const allIssues = [...validation, ...errors.filter((issue) => !validation.some((existing) => existing.code === issue.code))];
  const counts = allIssues.reduce((acc, issue) => {
    const severity = issue.severity || 'warning';
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, { error: 0, warning: 0, info: 0 });
  return {
    schema: 'aios.scheduler.usageBackoff.validationSummary.v1',
    valid: counts.error === 0,
    counts,
    issueCodes: allIssues.map((issue) => issue.code),
    blockingIssueCodes: allIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    warningIssueCodes: allIssues.filter((issue) => issue.severity !== 'error').map((issue) => issue.code)
  };
}

function buildAcceptanceContract(now, scope, tenantBoundary, workspaceBoundary, providerContract, operationalHealth, usageLane, admissionCost, limits, failure, backoff, mode, admitted, validationSummary) {
  const gates = [
    {
      id: 'quota-configured',
      label: 'Quota configured',
      passed: limits.limit > 0,
      reason: limits.limit > 0 ? 'A positive scheduler usage limit is available.' : 'No positive scheduler usage limit was supplied.'
    },
    {
      id: 'capacity-available',
      label: 'Capacity available',
      passed: admissionCost.quotaFits && limits.pressure < 1,
      reason: admissionCost.quotaFits
        ? `${limits.remaining} units remain in the active window for ${admissionCost.quotaUnits} requested units.`
        : `Requested ${admissionCost.quotaUnits} units but only ${limits.remaining} remain in the active scheduler usage window.`
    },
    {
      id: 'admission-cost',
      label: 'Admission cost',
      passed: admissionCost.fits,
      reason: admissionCost.fits
        ? `Requested scheduler cost fits quota${usageLane.configured ? ' and usage lane' : ''} capacity.`
        : usageLane.configured && !admissionCost.laneFits
          ? `Requested ${admissionCost.laneUnits} lane units but only ${usageLane.remaining} remain in usage lane ${usageLane.id}.`
          : `Requested ${admissionCost.quotaUnits} quota units but only ${limits.remaining} remain.`
    },
    {
      id: 'retry-window-clear',
      label: 'Retry window clear',
      passed: backoff.delayMs === 0,
      reason: backoff.delayMs === 0 ? 'No retry delay is currently active.' : `Retry is delayed for ${backoff.delayMs}ms.`
    },
    {
      id: 'failure-retryable',
      label: 'Failure retryable',
      passed: !failure.present || failure.retryable,
      reason: !failure.present ? 'No previous failure is constraining admission.' : failure.retryable ? 'The previous failure permits retry.' : 'The previous failure is marked non-retryable.'
    },
    {
      id: 'input-valid',
      label: 'Input valid',
      passed: validationSummary.valid,
      reason: validationSummary.valid ? 'No blocking validation issues were found.' : 'Blocking validation issues must be resolved before admission.'
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant boundary',
      passed: !tenantBoundary.enforced || Object.values(tenantBoundary.checks).every(Boolean),
      reason: !tenantBoundary.enforced
        ? 'Tenant boundary enforcement is disabled for this evaluation.'
        : Object.values(tenantBoundary.checks).every(Boolean)
          ? 'Workspace, actor, and permission checks match the scheduler tenant scope.'
          : 'Scheduler admission is outside the authorized tenant or workspace boundary.'
    },
    {
      id: 'workspace-boundary',
      label: 'Workspace boundary',
      passed: !workspaceBoundary.enforced || Object.values(workspaceBoundary.checks).every(Boolean),
      reason: !workspaceBoundary.enforced
        ? 'Workspace boundary enforcement is disabled for this evaluation.'
        : Object.values(workspaceBoundary.checks).every(Boolean)
          ? 'Request, handoff, and actor workspace grants match the scheduler workspace scope.'
          : 'Scheduler admission crosses an unauthorized or mismatched workspace boundary.'
    },
    {
      id: 'provider-contract',
      label: 'Provider contract',
      passed: providerContract.ready,
      reason: providerContract.ready
        ? `${providerContract.provider.id} accepted ${providerContract.negotiation.acceptedCapabilities.length} required scheduler capabilities.`
        : 'The scheduler provider contract is not ready for hosted-kernel admission.'
    },
    {
      id: 'operational-health',
      label: 'Operational health',
      passed: operationalHealth.admissionImpact !== 'block',
      reason: operationalHealth.admissionImpact === 'allow'
        ? 'Scheduler operational telemetry is healthy for hosted-kernel admission.'
        : operationalHealth.admissionImpact === 'degrade'
          ? 'Scheduler operational telemetry permits admission in degraded mode.'
          : 'Scheduler operational health is blocking hosted-kernel admission.'
    },
    {
      id: 'usage-lane',
      label: 'Usage lane',
      passed: !usageLane.configured || (usageLane.admissionImpact !== 'block' && admissionCost.laneFits),
      reason: !usageLane.configured
        ? 'No OAuth or message-metered scheduler lane is attached to this evaluation.'
        : !admissionCost.laneFits
          ? `Usage lane ${usageLane.id} has ${usageLane.remaining} units remaining for ${admissionCost.laneUnits} requested units.`
        : usageLane.admissionImpact === 'allow'
          ? `${usageLane.remaining} units remain in usage lane ${usageLane.id}.`
          : usageLane.admissionImpact === 'degrade'
            ? `Usage lane ${usageLane.id} is near its limit at ${usageLane.pressurePct}%.`
            : `Usage lane ${usageLane.id} is exhausted until ${usageLane.resumeAt || 'its next reset'}.`
    }
  ];
  const blockingGateIds = gates.filter((gate) => !gate.passed).map((gate) => gate.id);
  return {
    schema: 'aios.scheduler.usageBackoff.acceptance.v1',
    generatedAt: now,
    scope,
    accepted: admitted && blockingGateIds.length === 0,
    decision: admitted ? 'accept' : mode === 'blocked' ? 'reject' : 'defer',
    blockingGateIds,
    gates
  };
}

function buildReadinessContract(now, limits, backoff, mode, acceptance, validationSummary) {
  const pressureHeadroomPct = Math.max(0, 100 - Math.round(limits.pressure * 100));
  const ready = acceptance.accepted && mode === 'healthy';
  return {
    schema: 'aios.scheduler.usageBackoff.readiness.v1',
    generatedAt: now,
    ready,
    level: ready ? 'ready' : mode === 'blocked' ? 'blocked' : 'conditional',
    checks: {
      accepted: acceptance.accepted,
      validationValid: validationSummary.valid,
      retryClear: backoff.delayMs === 0,
      capacityRemaining: limits.remaining,
      pressureHeadroomPct
    },
    summary: ready
      ? 'Scheduler usage is ready for immediate hosted-kernel admission.'
      : mode === 'blocked'
        ? 'Scheduler usage is not ready; at least one blocking gate failed.'
        : 'Scheduler usage is conditionally ready after retry or pressure relief.'
  };
}

function buildLifecycleControls(now, scope, requestState, lifecycleSettings, mode, admitted, acceptance, backoff) {
  const canEnable = !lifecycleSettings.enabled || lifecycleSettings.command === 'disable';
  const canResume = lifecycleSettings.pausedActive || lifecycleSettings.command === 'pause' || lifecycleSettings.drainMode;
  const canPause = lifecycleSettings.enabled && lifecycleSettings.schedulingEnabled && !lifecycleSettings.pausedActive;
  const controlState = admitted
    ? 'admitting'
    : canEnable
      ? 'disabled'
      : lifecycleSettings.drainMode
        ? 'draining'
        : lifecycleSettings.pausedActive || lifecycleSettings.command === 'pause'
          ? 'paused'
          : lifecycleSettings.concurrency.exhausted
            ? 'saturated'
            : mode;
  const commands = [
    {
      id: 'enable-scheduler',
      enabled: canEnable,
      nextState: 'enabled',
      reason: canEnable ? 'Scheduler usage admission can be re-enabled.' : 'Scheduler usage admission is already enabled.'
    },
    {
      id: 'disable-scheduler',
      enabled: lifecycleSettings.enabled,
      nextState: 'disabled',
      reason: lifecycleSettings.enabled ? 'Disable admission for this hosted-kernel scheduler lifecycle.' : 'Scheduler usage admission is already disabled.'
    },
    {
      id: 'pause-scheduler',
      enabled: canPause,
      nextState: 'paused',
      reason: canPause ? 'Pause new admissions while preserving a resume path.' : 'Scheduler cannot be paused from its current lifecycle state.'
    },
    {
      id: 'resume-scheduler',
      enabled: canResume || lifecycleSettings.command === 'resume',
      nextState: 'enabled',
      reason: canResume ? 'Resume new admissions after pause or drain.' : 'Scheduler does not currently require a resume command.'
    },
    {
      id: 'drain-scheduler',
      enabled: lifecycleSettings.enabled && lifecycleSettings.concurrency.active > 0 && !lifecycleSettings.drainMode,
      nextState: 'draining',
      reason: lifecycleSettings.concurrency.active > 0 ? 'Drain active leases before lifecycle maintenance.' : 'No active leases are available to drain.'
    }
  ];
  const schedulingControl = {
    schema: 'aios.scheduler.usageBackoff.schedulingControl.v1',
    command: lifecycleSettings.command,
    commandAccepted: lifecycleSettings.commandAccepted,
    commandEffect: lifecycleSettings.commandEffect,
    mutatesState: lifecycleSettings.mutatesState,
    requested: lifecycleSettings.requested,
    effective: lifecycleSettings.effective,
    admissionHeld: !lifecycleSettings.effective.admitsNewWork,
    holdReason: !lifecycleSettings.commandAccepted
      ? 'invalid-command'
      : !lifecycleSettings.effective.enabled
        ? 'disabled'
        : lifecycleSettings.effective.drainMode
          ? 'draining'
          : lifecycleSettings.effective.pausedActive
            ? 'paused'
            : !lifecycleSettings.effective.schedulingEnabled
              ? 'scheduling-disabled'
              : lifecycleSettings.concurrency.exhausted
                ? 'concurrency-exhausted'
                : 'none',
    resume: {
      automatic: Boolean(lifecycleSettings.effective.autoResumeAt),
      at: lifecycleSettings.effective.autoResumeAt || backoff.nextRetryAt,
      source: lifecycleSettings.effective.autoResumeAt
        ? 'lifecycle-paused-until'
        : backoff.nextRetryAt
          ? 'scheduler-backoff'
          : 'none'
    },
    persistence: {
      required: lifecycleSettings.mutatesState,
      idempotencyKey: requestState.idempotencyKey || null,
      statePatch: {
        enabled: lifecycleSettings.effective.enabled,
        schedulingEnabled: lifecycleSettings.effective.schedulingEnabled,
        pausedUntil: lifecycleSettings.effective.pausedUntil,
        drainMode: lifecycleSettings.effective.drainMode,
        controlState
      }
    }
  };
  const nextCommand = commands.find((command) => command.enabled && (
    (controlState === 'disabled' && command.id === 'enable-scheduler')
    || (controlState === 'paused' && command.id === 'resume-scheduler')
    || (controlState === 'draining' && command.id === 'resume-scheduler')
    || (controlState === 'admitting' && command.id === 'pause-scheduler')
  )) || commands.find((command) => command.enabled) || null;

  return {
    schema: 'aios.scheduler.usageBackoff.lifecycleControls.v1',
    generatedAt: now,
    scope,
    requestId: requestState.requestId,
    controlState,
    desiredCommand: lifecycleSettings.command,
    effectiveAdmission: admitted ? 'admit' : acceptance.decision,
    resumeAt: lifecycleSettings.pausedUntil || backoff.nextRetryAt,
    concurrency: lifecycleSettings.concurrency,
    schedulingControl,
    commands,
    nextAction: nextCommand
      ? {
          ...nextCommand,
          blockedBy: schedulingControl.holdReason === 'none' ? [] : [schedulingControl.holdReason],
          runAfter: schedulingControl.resume.at,
          requiresPersistence: schedulingControl.persistence.required
        }
      : null
  };
}

function normalizePersistedSchedulerState(input, now, scope, requestState, lifecycleSettings, mode, admitted, backoff, usageLane, admissionCost) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.stateStore && typeof input.stateStore === 'object'
      ? input.stateStore
      : scheduler.persistedState && typeof scheduler.persistedState === 'object'
        ? scheduler.persistedState
        : {};
  const persistedScope = persisted.scope && typeof persisted.scope === 'object' ? persisted.scope : {};
  const persistedLifecycle = persisted.lifecycle && typeof persisted.lifecycle === 'object' ? persisted.lifecycle : {};
  const persistedRetry = persisted.retry && typeof persisted.retry === 'object' ? persisted.retry : {};
  const persistedStatus = persisted.status && typeof persisted.status === 'object' ? persisted.status : {};
  const appliedCommands = Array.isArray(persisted.appliedCommands)
    ? persisted.appliedCommands.filter((command) => command && typeof command === 'object')
    : [];
  const key = firstString(
    input.persistedStateKey,
    persisted.key,
    scheduler.persistedStateKey,
    `${scope.tenantId}/${scope.workspaceId}/${scope.routeId}/${scope.queue}`
  );
  const commandKey = [
    lifecycleSettings.command,
    requestState.idempotencyKey || requestState.requestId,
    scope.tenantId,
    scope.workspaceId,
    scope.routeId,
    scope.queue
  ].map((part) => encodeURIComponent(String(part))).join(':');
  const matchedCommand = appliedCommands.find((command) => command.key === commandKey || command.idempotencyKey === requestState.idempotencyKey);
  const persistedAt = normalizeDeadline(persisted.generatedAt || persisted.updatedAt || persisted.persistedAt);
  const recoveredAt = persistedAt && new Date(persistedAt).getTime() <= new Date(now).getTime() ? now : null;
  const persistedMode = firstString(persisted.mode, persistedStatus.mode, persisted.statusMode) || null;
  const persistedControlState = firstString(persisted.controlState, persistedStatus.controlState, persistedLifecycle.controlState) || null;
  const persistedResumeAt = normalizeDeadline(persisted.resumeAt || persistedRetry.nextRetryAt || persistedLifecycle.pausedUntil);
  const scopeMatches = (
    !persistedScope.tenantId || String(persistedScope.tenantId) === scope.tenantId
  ) && (
    !persistedScope.workspaceId || String(persistedScope.workspaceId) === scope.workspaceId
  ) && (
    !persistedScope.routeId || String(persistedScope.routeId) === scope.routeId
  ) && (
    !persistedScope.queue || String(persistedScope.queue) === scope.queue
  );
  const staleAfterMs = Math.max(1, asFiniteNumber(input.persistedStateStaleAfterMs, asFiniteNumber(persisted.staleAfterMs, DEFAULT_WINDOW_MS * 2)));
  const ageMs = persistedAt ? Math.max(0, new Date(now).getTime() - new Date(persistedAt).getTime()) : null;
  const stale = ageMs == null ? false : ageMs > staleAfterMs;
  const commandEffect = matchedCommand
    ? 'duplicate'
    : lifecycleSettings.commandEffect === 'read'
      ? 'read'
      : lifecycleSettings.commandAccepted
        ? 'apply'
        : 'invalid';
  const restartStatus = !persistedAt
    ? 'cold-start'
    : !scopeMatches
      ? 'scope-mismatch'
      : stale
        ? 'stale-recovered'
        : 'recovered';
  const effectiveStatus = {
    mode,
    admitted,
    controlState: admitted
      ? 'admitting'
      : lifecycleSettings.drainMode
        ? 'draining'
        : lifecycleSettings.pausedActive || lifecycleSettings.command === 'pause'
          ? 'paused'
          : lifecycleSettings.enabled
            ? mode
            : 'disabled',
    resumeAt: lifecycleSettings.pausedUntil || backoff.nextRetryAt || persistedResumeAt,
    source: commandEffect === 'duplicate' && persistedMode ? 'persisted-idempotent-replay' : 'current-evaluation'
  };

  return {
    schema: 'aios.scheduler.usageBackoff.persistedState.v1',
    generatedAt: now,
    key,
    present: Boolean(persistedAt || persistedMode || persistedControlState || appliedCommands.length > 0),
    restartStatus,
    stale,
    ageMs,
    staleAfterMs,
    recoveredAt,
    scopeMatches,
    persisted: {
      generatedAt: persistedAt,
      mode: persistedMode,
      controlState: persistedControlState,
      resumeAt: persistedResumeAt,
      generation: Math.max(0, Math.trunc(asFiniteNumber(persisted.generation, 0))),
      scope: {
        tenantId: firstString(persistedScope.tenantId) || null,
        workspaceId: firstString(persistedScope.workspaceId) || null,
        routeId: firstString(persistedScope.routeId) || null,
        queue: firstString(persistedScope.queue) || null
      }
    },
    commandReceipt: {
      key: commandKey,
      command: lifecycleSettings.command,
      effect: commandEffect,
      duplicate: Boolean(matchedCommand),
      firstAppliedAt: matchedCommand ? normalizeDeadline(matchedCommand.appliedAt || matchedCommand.generatedAt) : null,
      idempotencyKey: requestState.idempotencyKey || null,
      requestId: requestState.requestId
    },
    nextPersistedState: {
      schema: 'aios.scheduler.usageBackoff.persistedState.v1',
      key,
      generatedAt: now,
      generation: Math.max(0, Math.trunc(asFiniteNumber(persisted.generation, 0))) + (commandEffect === 'apply' ? 1 : 0),
      scope,
      mode: effectiveStatus.mode,
      admitted: effectiveStatus.admitted,
      controlState: effectiveStatus.controlState,
      resumeAt: effectiveStatus.resumeAt,
      lifecycle: {
        command: lifecycleSettings.command,
        commandEffect: lifecycleSettings.commandEffect,
        commandAccepted: lifecycleSettings.commandAccepted,
        enabled: lifecycleSettings.enabled,
        schedulingEnabled: lifecycleSettings.schedulingEnabled,
        pausedUntil: lifecycleSettings.pausedUntil,
        drainMode: lifecycleSettings.drainMode,
        requested: lifecycleSettings.requested,
        effective: lifecycleSettings.effective
      },
      retry: {
        delayMs: backoff.delayMs,
        nextRetryAt: backoff.nextRetryAt,
        source: backoff.source
      },
      admissionCost: {
        schema: admissionCost.schema,
        units: admissionCost.units,
        quotaUnits: admissionCost.quotaUnits,
        laneUnits: admissionCost.laneUnits,
        fits: admissionCost.fits,
        quotaFits: admissionCost.quotaFits,
        laneFits: admissionCost.laneFits,
        reservationKey: admissionCost.reservationKey,
        quotaRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
        laneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision
      },
      usageLane: {
        configured: usageLane.configured,
        id: usageLane.configured ? usageLane.id : null,
        kind: usageLane.configured ? usageLane.kind : null,
        stateKey: usageLane.configured ? usageLane.stateKey : null,
        pressurePct: usageLane.configured ? usageLane.pressurePct : null,
        remaining: usageLane.configured ? usageLane.remaining : null,
        exhausted: usageLane.configured ? usageLane.exhausted : false,
        scopeBoundary: usageLane.configured
          ? {
              enforced: usageLane.scopeBoundary.enforced,
              matches: usageLane.scopeBoundary.matches,
              mismatchCodes: usageLane.scopeBoundary.mismatchCodes,
              rejectedHistorySamples: usageLane.history.rejectedSampleCount
            }
          : null,
        historyBackoff: usageLane.configured ? usageLane.history.enforcedBackoff : false,
        consecutiveExhausted: usageLane.configured ? usageLane.history.consecutiveExhausted : 0,
        failure: usageLane.configured
          ? {
              configured: usageLane.failure.configured,
              code: usageLane.failure.code,
              retryable: usageLane.failure.retryable,
              attempts: usageLane.failure.attempts,
              terminal: usageLane.failure.terminal,
              admissionImpact: usageLane.failure.admissionImpact,
              resumeAt: usageLane.failure.resumeAt
            }
          : null,
        resetAt: usageLane.configured ? usageLane.resetAt : null,
        resumeAt: usageLane.configured ? usageLane.resumeAt : null,
        resumeReason: usageLane.configured ? usageLane.resumeReason : 'none'
      },
      appliedCommands: commandEffect === 'apply'
        ? [
            ...appliedCommands.slice(-19),
            {
              key: commandKey,
              command: lifecycleSettings.command,
              idempotencyKey: requestState.idempotencyKey || null,
              requestId: requestState.requestId,
              appliedAt: now
            }
          ]
        : appliedCommands.slice(-20)
    }
  };
}

function buildPersistenceValidation(persistedState) {
  const issues = [];
  if (persistedState.restartStatus === 'scope-mismatch') {
    issues.push({
      code: 'persisted_state_scope_mismatch',
      severity: 'error',
      message: 'Persisted scheduler state belongs to a different tenant, workspace, route, or queue.',
      action: 'Discard the persisted record for this evaluation or load state using the current scheduler isolation key.'
    });
  }
  if (persistedState.stale) {
    issues.push({
      code: 'persisted_state_stale',
      severity: 'warning',
      message: 'Persisted scheduler state is older than the configured recovery window.',
      action: 'Treat recovered status as advisory and refresh the scheduler state store after this evaluation.'
    });
  }
  if (persistedState.commandReceipt.effect === 'apply' && !persistedState.commandReceipt.idempotencyKey) {
    issues.push({
      code: 'lifecycle_command_without_idempotency',
      severity: 'warning',
      message: 'A mutating scheduler lifecycle command was issued without an idempotency key.',
      action: 'Attach an idempotency key so command replay after hosted-kernel restart is deterministic.'
    });
  }
  return issues;
}

function buildNextSteps(limits, failure, backoff, mode, acceptance, validationSummary, lifecycleSettings, tenantBoundary, workspaceBoundary, operationalHealth, usageLane, admissionCost) {
  const steps = [];
  if (validationSummary.blockingIssueCodes.includes('admission_cost_exceeds_quota')) {
    steps.push({
      id: 'reduce-admission-cost',
      kind: 'capacity',
      priority: 'high',
      label: 'Reduce admission cost',
      detail: `Requested ${admissionCost.quotaUnits} quota units but only ${admissionCost.quotaRemainingBeforeDecision} remain; split the work item or wait for quota recovery.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('admission_cost_exceeds_usage_lane')) {
    steps.push({
      id: 'wait-for-lane-capacity',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Wait for lane capacity',
      detail: usageLane.resumeAt
        ? `Requested ${admissionCost.laneUnits} lane units; retry usage lane ${usageLane.id} no earlier than ${usageLane.resumeAt}.`
        : `Requested ${admissionCost.laneUnits} lane units but only ${admissionCost.laneRemainingBeforeDecision} remain in usage lane ${usageLane.id}.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_lane_exhausted')) {
    steps.push({
      id: 'wait-for-usage-lane',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Wait for usage lane reset',
      detail: usageLane.resumeAt
        ? `${usageLane.kind} lane ${usageLane.id} can resume no earlier than ${usageLane.resumeAt}.`
        : `${usageLane.kind} lane ${usageLane.id} is exhausted; wait for the lane meter to reset.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_lane_history_backoff')) {
    steps.push({
      id: 'wait-for-lane-history-backoff',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Wait for lane backoff',
      detail: usageLane.resumeAt
        ? `${usageLane.kind} lane ${usageLane.id} recorded ${usageLane.history.consecutiveExhausted} consecutive exhausted samples; retry no earlier than ${usageLane.resumeAt}.`
        : `${usageLane.kind} lane ${usageLane.id} recorded repeated exhausted samples; wait for lane history backoff to clear.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_lane_failure_backoff')) {
    steps.push({
      id: 'wait-for-lane-failure-backoff',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Wait for lane provider recovery',
      detail: usageLane.failure.resumeAt
        ? `${usageLane.kind} lane ${usageLane.id} reported ${usageLane.failure.code || 'a retryable provider failure'}; retry no earlier than ${usageLane.failure.resumeAt}.`
        : `${usageLane.kind} lane ${usageLane.id} reported ${usageLane.failure.code || 'a retryable provider failure'}; wait for provider metering recovery.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_lane_failure_terminal')) {
    steps.push({
      id: 'repair-lane-provider-failure',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Repair lane provider failure',
      detail: usageLane.failure.message
        ? `${usageLane.kind} lane ${usageLane.id} failed with ${usageLane.failure.code || 'terminal_error'}: ${usageLane.failure.message}`
        : `${usageLane.kind} lane ${usageLane.id} requires reauthorization or provider repair before scheduler admission resumes.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_lane_scope_mismatch') || validationSummary.blockingIssueCodes.includes('usage_lane_scope_backoff')) {
    steps.push({
      id: 'repair-usage-lane-scope',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Repair usage lane scope',
      detail: `Lane ${usageLane.id} metadata does not match ${usageLane.scopeBoundary.tenantId}/${usageLane.scopeBoundary.workspaceId}/${usageLane.scopeBoundary.routeId}; load the scoped meter before admission.`
    });
  }
  if (validationSummary.issueCodes.includes('usage_lane_history_scope_filtered')) {
    steps.push({
      id: 'refresh-usage-lane-history',
      kind: 'usage-lane',
      priority: 'medium',
      label: 'Refresh lane history',
      detail: `${usageLane.history.rejectedSampleCount} lane history samples were ignored because they belonged to another tenant, workspace, route, or lane.`
    });
  }
  if (validationSummary.issueCodes.includes('usage_lane_near_limit')) {
    steps.push({
      id: 'throttle-usage-lane',
      kind: 'usage-lane',
      priority: 'medium',
      label: 'Throttle usage lane',
      detail: `${usageLane.kind} lane ${usageLane.id} is at ${usageLane.pressurePct}% pressure with ${usageLane.remaining} units remaining.`
    });
  }
  if (validationSummary.issueCodes.includes('usage_lane_failure_degraded')) {
    steps.push({
      id: 'monitor-lane-provider-degraded',
      kind: 'usage-lane',
      priority: 'medium',
      label: 'Monitor lane provider',
      detail: `${usageLane.kind} lane ${usageLane.id} is degraded by ${usageLane.failure.code || 'provider failure'}; preserve retry and handoff metadata until recovery.`
    });
  }
  if (validationSummary.blockingIssueCodes.some((code) => [
    'operational_dependency_down',
    'operational_telemetry_missing',
    'operational_telemetry_stale',
    'operational_error_burst',
    'operational_incident_active'
  ].includes(code))) {
    steps.push({
      id: 'restore-operational-health',
      kind: 'operational-health',
      priority: 'high',
      label: 'Restore scheduler health',
      detail: operationalHealth.dependency.down
        ? `Scheduler dependency state is ${operationalHealth.dependency.state}; restore the dependency or route to a healthy provider.`
        : operationalHealth.telemetry.missing || operationalHealth.telemetry.stale
          ? 'Publish a fresh scheduler heartbeat before retrying hosted-kernel admission.'
          : operationalHealth.errors.burst
            ? `Recent scheduler errors reached ${operationalHealth.errors.recentCount}/${operationalHealth.errors.burstLimit}; wait for recovery or inspect failed workers.`
            : 'Resolve active scheduler operational incidents before admitting new work.'
    });
  }
  if (validationSummary.issueCodes.includes('operational_degraded_mode')) {
    steps.push({
      id: 'monitor-degraded-scheduler',
      kind: 'operational-health',
      priority: 'medium',
      label: 'Monitor degraded scheduler',
      detail: 'Scheduler is in degraded mode; keep client handoff and retry controls active until health returns to normal.'
    });
  }
  if (validationSummary.blockingIssueCodes.some((code) => [
    'tenant_boundary_denied',
    'workspace_tenant_mismatch',
    'actor_tenant_mismatch',
    'scheduler_permission_missing'
  ].includes(code))) {
    steps.push({
      id: 'repair-tenant-boundary',
      kind: 'authorization',
      priority: 'high',
      label: 'Repair tenant boundary',
      detail: tenantBoundary.missingPermissions.length > 0
        ? `Grant ${tenantBoundary.missingPermissions.join(', ')} or route the request to an actor with scheduler-admin role.`
        : 'Align actor, workspace, and allowed tenant ids before admitting hosted-kernel scheduler work.'
    });
  }
  if (validationSummary.blockingIssueCodes.some((code) => [
    'workspace_boundary_denied',
    'workspace_explicitly_denied',
    'requested_workspace_mismatch',
    'handoff_workspace_mismatch',
    'workspace_scheduler_role_missing'
  ].includes(code))) {
    steps.push({
      id: 'repair-workspace-boundary',
      kind: 'authorization',
      priority: 'high',
      label: 'Repair workspace boundary',
      detail: workspaceBoundary.checks.workspaceRoleSatisfied
        ? 'Align requested workspace and handoff workspace with the scheduler workspace before admitting hosted-kernel work.'
        : `Grant scheduler:workspace:admit or one workspace role: ${workspaceBoundary.requiredWorkspaceRoles.join(', ')}.`
    });
  }
  if (validationSummary.blockingIssueCodes.includes('scheduler_disabled')) {
    steps.push({
      id: 'enable-scheduler',
      kind: 'lifecycle',
      priority: 'high',
      label: 'Enable scheduler admission',
      detail: 'Scheduler usage admission is disabled; issue an enable command before accepting new hosted-kernel work.'
    });
  }
  if (validationSummary.issueCodes.includes('scheduling_paused')) {
    steps.push({
      id: 'resume-scheduler',
      kind: 'lifecycle',
      priority: lifecycleSettings.pausedActive ? 'medium' : 'high',
      label: 'Resume scheduler admission',
      detail: lifecycleSettings.pausedUntil
        ? `Admission can resume after ${lifecycleSettings.pausedUntil} or immediately with a resume command.`
        : 'Issue a resume command or provide pausedUntil for deterministic scheduling controls.'
    });
  }
  if (validationSummary.blockingIssueCodes.includes('scheduler_draining')) {
    steps.push({
      id: 'finish-drain',
      kind: 'lifecycle',
      priority: 'high',
      label: 'Finish scheduler drain',
      detail: 'Wait for active leases to complete, then resume scheduler admission.'
    });
  }
  if (validationSummary.blockingIssueCodes.includes('scheduler_concurrency_exhausted')) {
    steps.push({
      id: 'release-lease-capacity',
      kind: 'lifecycle',
      priority: 'high',
      label: 'Release scheduler lease capacity',
      detail: 'Active scheduler leases reached maxConcurrent; wait for a lease release or raise the lifecycle concurrency limit.'
    });
  }
  if (validationSummary.blockingIssueCodes.includes('usage_limit_missing') || validationSummary.blockingIssueCodes.includes('admission_unconfigured')) {
    steps.push({
      id: 'configure-quota',
      kind: 'configuration',
      priority: 'high',
      label: 'Configure scheduler quota',
      detail: 'Set limits.limit or quota.limit for the tenant or route before admitting work.'
    });
  }
  if (limits.limit > 0 && limits.remaining <= 0) {
    steps.push({
      id: 'wait-for-capacity',
      kind: 'capacity',
      priority: 'high',
      label: 'Wait for usage window capacity',
      detail: 'Retry after the active usage window resets or reduce reserved scheduler work.'
    });
  }
  if (backoff.delayMs > 0) {
    steps.push({
      id: 'honor-backoff',
      kind: 'retry',
      priority: mode === 'blocked' ? 'high' : 'medium',
      label: 'Honor retry backoff',
      detail: backoff.nextRetryAt ? `Retry no earlier than ${backoff.nextRetryAt}.` : `Wait ${backoff.delayMs}ms before retrying.`
    });
  }
  if (failure.present && !failure.retryable) {
    steps.push({
      id: 'surface-failure',
      kind: 'operator-action',
      priority: 'high',
      label: 'Surface non-retryable failure',
      detail: failure.message || 'Send the non-retryable scheduler failure to the caller for remediation.'
    });
  }
  if (steps.length === 0 && !acceptance.accepted) {
    steps.push({
      id: 'review-blocking-gates',
      kind: 'inspection',
      priority: 'medium',
      label: 'Review failed acceptance gates',
      detail: `Failed gates: ${acceptance.blockingGateIds.join(', ') || 'none reported'}.`
    });
  }
  if (steps.length === 0) {
    steps.push({
      id: 'admit-work',
      kind: 'admission',
      priority: 'low',
      label: 'Admit scheduler work',
      detail: 'The hosted-kernel scheduler can admit this work item now.'
    });
  }
  return {
    schema: 'aios.scheduler.usageBackoff.nextSteps.v1',
    recommendedActionId: steps[0].id,
    steps
  };
}

function buildUsageLaneResumeHandoff(now, scope, requestState, runtimeProfile, providerContract, usageLane, admissionCost, backoff, acceptance, readiness, validationSummary, nextSteps) {
  const configured = usageLane.configured;
  const resumeAt = configured
    ? usageLane.resumeAt || providerContract.handoff.resumeAt || backoff.nextRetryAt
    : backoff.nextRetryAt;
  const delayMs = resumeAt ? Math.max(0, new Date(resumeAt).getTime() - new Date(now).getTime()) : 0;
  const capacityBlocked = configured && (!admissionCost.laneFits || usageLane.exhausted || usageLane.history.enforcedBackoff || usageLane.failure.admissionImpact === 'block');
  const providerReady = providerContract.ready && providerContract.laneSync.state !== 'future-watermark';
  const runtimeCanResume = runtimeProfile.supports.resumeToken && Boolean(requestState.workflow.resumeToken || requestState.idempotencyKey);
  const continuationDeadlineMs = runtimeProfile.continuation.deadlineAt
    ? new Date(runtimeProfile.continuation.deadlineAt).getTime()
    : null;
  const resumeMs = resumeAt ? new Date(resumeAt).getTime() : null;
  const resumeWithinContinuation = resumeMs == null
    ? false
    : continuationDeadlineMs == null
      ? true
      : resumeMs <= continuationDeadlineMs;
  const runtimeCanPark = runtimeCanResume
    && runtimeProfile.continuation.canParkPastResponse
    && !runtimeProfile.continuation.expired
    && resumeWithinContinuation;
  const validationAllowsResume = validationSummary.blockingIssueCodes.every((code) => [
    'admission_cost_exceeds_usage_lane',
    'usage_lane_exhausted',
    'usage_lane_history_backoff',
    'usage_lane_failure_backoff',
    'quota_exhausted'
  ].includes(code));
  const eligible = configured
    && capacityBlocked
    && providerReady
    && runtimeCanPark
    && validationAllowsResume
    && Boolean(resumeAt)
    && !acceptance.accepted;
  let state = 'ready';
  if (!configured) {
    state = 'not-configured';
  } else if (acceptance.accepted) {
    state = 'accepted-inline';
  } else if (!providerReady) {
    state = 'awaiting-provider';
  } else if (!runtimeCanResume) {
    state = 'awaiting-resume-token';
  } else if (runtimeProfile.continuation.expired) {
    state = 'continuation-expired';
  } else if (!runtimeProfile.continuation.canParkPastResponse) {
    state = 'continuation-not-persistable';
  } else if (!resumeWithinContinuation) {
    state = 'resume-after-continuation-deadline';
  } else if (eligible) {
    state = 'parked-for-lane-resume';
  } else if (capacityBlocked) {
    state = 'blocked-without-resume';
  }
  const reasonCodes = [
    ...(configured && !admissionCost.laneFits ? ['lane-cost-exceeds-remaining'] : []),
    ...(configured && usageLane.scopeBoundary.enforced && !usageLane.scopeBoundary.matches ? ['lane-scope-mismatch'] : []),
    ...(configured && usageLane.history.rejectedSampleCount > 0 ? ['lane-history-scope-filtered'] : []),
    ...(configured && usageLane.exhausted ? ['lane-exhausted'] : []),
    ...(configured && usageLane.history.enforcedBackoff ? ['lane-history-backoff'] : []),
    ...(configured && usageLane.failure.configured ? [`lane-failure-${usageLane.failure.issueCode}`] : []),
    ...(configured && !providerReady ? ['provider-contract-not-ready'] : []),
    ...(configured && !runtimeCanResume ? ['runtime-resume-token-missing'] : []),
    ...(configured && runtimeCanResume && runtimeProfile.continuation.expired ? ['runtime-continuation-expired'] : []),
    ...(configured && runtimeCanResume && !runtimeProfile.continuation.canParkPastResponse ? ['runtime-continuation-not-persistable'] : []),
    ...(configured && runtimeCanResume && !resumeWithinContinuation ? ['resume-after-continuation-deadline'] : []),
    ...(configured && !validationAllowsResume ? ['non-capacity-validation-blocker'] : [])
  ];

  return {
    schema: 'aios.scheduler.usageBackoff.usageLaneResumeHandoff.v1',
    generatedAt: now,
    scope,
    configured,
    state,
    accepted: acceptance.accepted,
    eligibleForResume: eligible,
    lane: {
      id: configured ? usageLane.id : null,
      kind: configured ? usageLane.kind : null,
      tokenSubject: configured ? usageLane.tokenSubject : null,
      stateKey: configured ? usageLane.stateKey : null,
      scopeBoundary: configured
        ? {
            enforced: usageLane.scopeBoundary.enforced,
            matches: usageLane.scopeBoundary.matches,
            mismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            rejectedHistorySamples: usageLane.history.rejectedSampleCount
          }
        : null,
      remaining: configured ? usageLane.remaining : null,
      requestedUnits: configured ? admissionCost.laneUnits : 0,
      pressurePct: configured ? usageLane.pressurePct : null,
      resetAt: configured ? usageLane.resetAt : null,
      resumeAt: configured ? usageLane.resumeAt : null,
      resumeReason: configured ? usageLane.resumeReason : 'none',
      consecutiveExhausted: configured ? usageLane.history.consecutiveExhausted : 0,
      failure: configured
        ? {
            configured: usageLane.failure.configured,
            code: usageLane.failure.code,
            retryable: usageLane.failure.retryable,
            terminal: usageLane.failure.terminal,
            admissionImpact: usageLane.failure.admissionImpact,
            resumeAt: usageLane.failure.resumeAt
          }
        : null
    },
    readiness: {
      level: readiness.level,
      capacityAvailable: configured ? admissionCost.laneFits && !usageLane.exhausted : true,
      providerReady,
      runtimeCanResume: runtimeCanPark,
      resumeWithinContinuation,
      validationAllowsResume,
      backoffClear: backoff.delayMs === 0
    },
    continuation: {
      schema: runtimeProfile.continuation.schema,
      deadlineAt: runtimeProfile.continuation.deadlineAt,
      windowMs: runtimeProfile.continuation.windowMs,
      expired: runtimeProfile.continuation.expired,
      canParkPastResponse: runtimeProfile.continuation.canParkPastResponse,
      tokenSource: runtimeProfile.continuation.tokenSource,
      resumeWithinDeadline: resumeWithinContinuation,
      overflowMs: resumeMs != null && continuationDeadlineMs != null
        ? Math.max(0, resumeMs - continuationDeadlineMs)
        : 0
    },
    resume: {
      at: resumeAt,
      delayMs,
      retryAfterSeconds: delayMs > 0 ? Math.ceil(delayMs / 1000) : 0,
      source: configured && usageLane.resumeAt
        ? `usage-lane-${usageLane.resumeReason}`
        : providerContract.handoff.resumeAt
          ? 'provider-handoff'
          : backoff.nextRetryAt
            ? backoff.source
            : 'none',
      token: requestState.workflow.resumeToken || requestState.idempotencyKey || null
    },
    routeContract: {
      command: eligible ? 'park' : acceptance.accepted ? 'admit' : 'reject',
      target: providerContract.handoff.target,
      deliveryMode: providerContract.handoff.deliveryMode,
      commandTopic: providerContract.handoff.commandTopic,
      callbackUrl: providerContract.handoff.callbackUrl,
      continuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
      statePatch: configured
        ? {
            schedulerUsageLaneId: usageLane.id,
            schedulerUsageLaneKind: usageLane.kind,
            schedulerUsageLaneResumeAt: resumeAt,
            schedulerUsageLaneResumeReason: usageLane.resumeReason,
            schedulerUsageLaneScopeMatches: usageLane.scopeBoundary.matches,
            schedulerUsageLaneScopeMismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            schedulerUsageLaneRejectedHistorySamples: usageLane.history.rejectedSampleCount,
            schedulerUsageLaneFailureCode: usageLane.failure.code,
            schedulerUsageLaneFailureTerminal: usageLane.failure.terminal,
            schedulerUsageLaneFailureImpact: usageLane.failure.admissionImpact,
            schedulerUsageLaneFailureResumeAt: usageLane.failure.resumeAt,
            schedulerUsageLaneRemaining: usageLane.remaining,
            schedulerUsageLaneRequestedUnits: admissionCost.laneUnits,
            schedulerUsageLaneState: state,
            schedulerContinuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
            schedulerContinuationOverflowMs: resumeMs != null && continuationDeadlineMs != null
              ? Math.max(0, resumeMs - continuationDeadlineMs)
              : 0
          }
        : null
    },
    reasonCodes,
    nextStep: eligible ? {
      id: 'park-usage-lane-resume',
      kind: 'usage-lane',
      priority: 'high',
      label: 'Park until usage lane resumes',
      detail: `Persist this scheduler handoff and resume usage lane ${usageLane.id} no earlier than ${resumeAt}.`
    } : nextSteps.steps[0]
  };
}

function buildPreviewContract(now, scope, limits, failure, backoff, mode, admitted, acceptance, readiness, nextSteps, usageLane, admissionCost, usageLaneResumeHandoff) {
  return {
    schema: 'aios.scheduler.usageBackoff.preview.v1',
    generatedAt: now,
    scope,
    decision: acceptance.decision,
    status: mode,
    userVisibleSummary: admitted
      ? 'Work can be admitted now.'
      : backoff.delayMs > 0
        ? `Work is delayed by scheduler backoff for ${backoff.delayMs}ms.`
        : mode === 'blocked'
          ? 'Work is blocked by scheduler usage policy.'
          : 'Work is waiting for scheduler pressure to recover.',
    quota: {
      pressurePct: Math.round(limits.pressure * 100),
      remaining: limits.remaining,
      windowMs: limits.windowMs
    },
    admissionCost: {
      units: admissionCost.units,
      quotaUnits: admissionCost.quotaUnits,
      laneUnits: admissionCost.laneUnits,
      fits: admissionCost.fits,
      quotaRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
      laneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision,
      pressureAfterDecisionPct: admissionCost.pressureAfterDecisionPct,
      lanePressureAfterDecisionPct: admissionCost.lanePressureAfterDecisionPct
    },
    retry: {
      retryable: failure.retryable,
      delayMs: backoff.delayMs,
      nextRetryAt: backoff.nextRetryAt
    },
    usageLane: {
      configured: usageLane.configured,
      id: usageLane.configured ? usageLane.id : null,
      kind: usageLane.configured ? usageLane.kind : null,
      pressurePct: usageLane.configured ? usageLane.pressurePct : null,
      remaining: usageLane.configured ? usageLane.remaining : null,
      resumeAt: usageLane.configured ? usageLane.resumeAt : null,
      resumeReason: usageLane.configured ? usageLane.resumeReason : 'none',
      failure: usageLane.configured
        ? {
            configured: usageLane.failure.configured,
            code: usageLane.failure.code,
            retryable: usageLane.failure.retryable,
            terminal: usageLane.failure.terminal,
            admissionImpact: usageLane.failure.admissionImpact,
            resumeAt: usageLane.failure.resumeAt
          }
        : null,
      scopeBoundary: usageLane.configured
        ? {
            enforced: usageLane.scopeBoundary.enforced,
            matches: usageLane.scopeBoundary.matches,
            mismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            rejectedHistorySamples: usageLane.history.rejectedSampleCount
          }
        : null,
      historyBackoff: usageLane.configured ? usageLane.history.enforcedBackoff : false,
      consecutiveExhausted: usageLane.configured ? usageLane.history.consecutiveExhausted : 0
    },
    usageLaneResumeHandoff: {
      schema: usageLaneResumeHandoff.schema,
      state: usageLaneResumeHandoff.state,
      eligibleForResume: usageLaneResumeHandoff.eligibleForResume,
      resumeAt: usageLaneResumeHandoff.resume.at,
      retryAfterSeconds: usageLaneResumeHandoff.resume.retryAfterSeconds,
      command: usageLaneResumeHandoff.routeContract.command,
      reasonCodes: usageLaneResumeHandoff.reasonCodes
    },
    readinessLevel: readiness.level,
    primaryNextStep: nextSteps.steps[0]
  };
}

function normalizeLeasePolicy(input, now, requestState, limits, backoff, admitted) {
  const lease = input.lease && typeof input.lease === 'object' ? input.lease : {};
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const defaultTtlMs = admitted
    ? Math.min(limits.windowMs, 30_000)
    : Math.max(backoff.delayMs, Math.min(limits.windowMs, 5_000));
  const ttlMs = clamp(
    Math.trunc(asFiniteNumber(input.leaseTtlMs, asFiniteNumber(lease.ttlMs, asFiniteNumber(scheduler.leaseTtlMs, defaultTtlMs)))),
    1,
    Math.max(1, limits.windowMs)
  );
  const heartbeatMs = clamp(
    Math.trunc(asFiniteNumber(input.leaseHeartbeatMs, asFiniteNumber(lease.heartbeatMs, Math.ceil(ttlMs / 2)))),
    1,
    ttlMs
  );
  const acquiredAt = normalizeIso(lease.acquiredAt || now);
  const expiresAt = normalizeDeadline(lease.expiresAt) || new Date(new Date(acquiredAt).getTime() + ttlMs).toISOString();
  const deadlineMs = requestState.deadlineAt ? new Date(requestState.deadlineAt).getTime() : null;
  const leaseExpiresAfterDeadline = deadlineMs != null && new Date(expiresAt).getTime() > deadlineMs;

  return {
    schema: 'aios.scheduler.usageBackoff.leasePolicy.v1',
    key: firstString(input.leaseKey, lease.key, scheduler.leaseKey)
      || `${requestState.requestId}:${requestState.idempotencyKey || 'single-shot'}`,
    owner: firstString(input.leaseOwner, lease.owner, scheduler.owner, scheduler.workerId) || 'hosted-kernel-scheduler',
    acquiredAt,
    ttlMs,
    heartbeatMs,
    expiresAt,
    releaseOnReject: lease.releaseOnReject !== false,
    deadlineBounded: !leaseExpiresAfterDeadline,
    deadlineViolation: leaseExpiresAfterDeadline
      ? {
          code: 'lease_exceeds_request_deadline',
          severity: 'warning',
          message: 'The scheduler lease expires after the client request deadline.',
          action: 'Shorten leaseTtlMs or extend the client deadline so hosted-kernel workers cannot continue stale work.'
        }
      : null
  };
}

function buildKernelRuntimeContract(now, scope, tenantBoundary, workspaceBoundary, providerContract, requestState, limits, failure, backoff, mode, admitted, acceptance, readiness, nextSteps, clientHandoff, usageLane, admissionCost, usageLaneResumeHandoff, input) {
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const lease = normalizeLeasePolicy(input, now, requestState, limits, backoff, admitted);
  const command = admitted
    ? 'enqueue'
    : clientHandoff.resume.allowed
      ? 'defer'
      : 'reject';
  const executionState = command === 'enqueue'
    ? 'leased-for-execution'
    : command === 'defer'
      ? 'parked-for-resume'
      : 'closed';
  const targetQueue = firstString(scheduler.queue, scheduler.targetQueue, scope.queue) || scope.queue;
  const proofSeed = [
    surfaceId,
    now,
    requestState.requestId,
    scope.tenantId,
    scope.routeId,
    command,
    String(limits.used),
    String(limits.reserved),
    String(limits.limit),
    String(admissionCost.quotaUnits),
    String(admissionCost.laneUnits),
    String(backoff.delayMs),
    tenantBoundary.isolationKey,
    workspaceBoundary.isolationKey
  ].join('|');

  return {
    schema: 'aios.scheduler.usageBackoff.kernelRuntime.v1',
    generatedAt: now,
    integration: {
      route: 'hosted-kernel.scheduler.usage-backoff',
      targetQueue,
      workerPool: firstString(scheduler.workerPool, scheduler.pool) || 'kernel-default',
      providerId: providerContract.provider.id,
      serviceId: providerContract.service.id,
      serviceEndpoint: providerContract.service.endpoint,
      command,
      executionState,
      idempotencyKey: requestState.idempotencyKey || lease.key,
      resumeToken: requestState.workflow.resumeToken || clientHandoff.resume.token,
      traceId: requestState.traceId,
      isolationKey: tenantBoundary.isolationKey,
      workspaceIsolationKey: workspaceBoundary.isolationKey,
      stateStorePrefix: workspaceBoundary.stateStorePrefix
    },
    providerContract,
    schedulerCommand: {
      kind: `scheduler.usageBackoff.${command}`,
      requestId: requestState.requestId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      routeId: scope.routeId,
      queue: targetQueue,
      priority: scope.priority,
      providerId: providerContract.provider.id,
      serviceId: providerContract.service.id,
      operation: requestState.operation,
      runAfter: command === 'defer' ? clientHandoff.resume.at : now,
      leaseKey: lease.key,
      retryDelayMs: backoff.delayMs,
      admissionUnits: admissionCost.units,
      quotaUnits: admissionCost.quotaUnits,
      laneUnits: admissionCost.laneUnits,
      usageLaneId: usageLane.configured ? usageLane.id : null,
      usageLaneResumeAt: usageLane.configured ? usageLane.resumeAt : null,
      reasonCode: acceptance.blockingGateIds[0] || nextSteps.recommendedActionId
    },
    lease,
    tenantBoundary: {
      schema: tenantBoundary.schema,
      enforced: tenantBoundary.enforced,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      actorId: tenantBoundary.actor.id,
      actorTenantId: tenantBoundary.actor.tenantId,
      isolationKey: tenantBoundary.isolationKey,
      checks: tenantBoundary.checks,
      missingPermissions: tenantBoundary.missingPermissions
    },
    workspaceBoundary: {
      schema: workspaceBoundary.schema,
      enforced: workspaceBoundary.enforced,
      workspaceId: workspaceBoundary.workspaceId,
      requestedWorkspaceId: workspaceBoundary.requestedWorkspaceId,
      handoffWorkspaceId: workspaceBoundary.handoffWorkspaceId,
      isolationKey: workspaceBoundary.isolationKey,
      stateStorePrefix: workspaceBoundary.stateStorePrefix,
      checks: workspaceBoundary.checks,
      requiredWorkspaceRoles: workspaceBoundary.requiredWorkspaceRoles
    },
    meteringPatch: {
      schema: 'aios.scheduler.usageBackoff.meteringPatch.v1',
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      routeId: scope.routeId,
      requestId: requestState.requestId,
      reserveDelta: admitted ? admissionCost.quotaUnits : 0,
      releaseDelta: command === 'reject' && lease.releaseOnReject ? 1 : 0,
      pressurePct: Math.round(limits.pressure * 100),
      requestedUnits: admissionCost.units,
      quotaUnits: admissionCost.quotaUnits,
      reservationKey: admissionCost.reservationKey,
      remainingAfterDecision: admitted ? admissionCost.quotaRemainingAfterDecision : limits.remaining,
      pressureAfterDecisionPct: admitted ? admissionCost.pressureAfterDecisionPct : Math.round(limits.pressure * 100),
      windowMs: limits.windowMs,
      usageLane: {
        configured: usageLane.configured,
        id: usageLane.configured ? usageLane.id : null,
        kind: usageLane.configured ? usageLane.kind : null,
        stateKey: usageLane.configured ? usageLane.stateKey : null,
        reserveDelta: admitted && usageLane.configured ? admissionCost.laneUnits : 0,
        requestedUnits: usageLane.configured ? admissionCost.laneUnits : 0,
        remainingAfterDecision: usageLane.configured
          ? admitted ? admissionCost.laneRemainingAfterDecision : usageLane.remaining
          : null,
        pressurePct: usageLane.configured ? usageLane.pressurePct : null,
        pressureAfterDecisionPct: usageLane.configured
          ? admitted ? admissionCost.lanePressureAfterDecisionPct : usageLane.pressurePct
          : null,
        resetAt: usageLane.configured ? usageLane.resetAt : null,
        resumeAt: usageLane.configured ? usageLane.resumeAt : null,
        failureCode: usageLane.configured ? usageLane.failure.code : null,
        failureTerminal: usageLane.configured ? usageLane.failure.terminal : false,
        failureImpact: usageLane.configured ? usageLane.failure.admissionImpact : 'allow',
        failureResumeAt: usageLane.configured ? usageLane.failure.resumeAt : null,
        scopeMatches: usageLane.configured ? usageLane.scopeBoundary.matches : true,
        scopeMismatchCodes: usageLane.configured ? usageLane.scopeBoundary.mismatchCodes : [],
        rejectedHistorySamples: usageLane.configured ? usageLane.history.rejectedSampleCount : 0
      }
    },
    externalHandoff: {
      schema: 'aios.scheduler.usageBackoff.externalHandoff.v1',
      enabled: providerContract.handoff.required,
      state: providerContract.handoff.state,
      target: providerContract.handoff.target,
      callbackUrl: providerContract.handoff.callbackUrl,
      syncCursor: providerContract.sync.cursor,
      watermark: providerContract.sync.watermark,
      commandTopic: providerContract.handoff.commandTopic,
      deliveryMode: providerContract.handoff.deliveryMode,
      laneState: providerContract.handoff.laneState,
      laneResumeAt: providerContract.handoff.resumeAt,
      laneSyncCursor: providerContract.laneSync.cursor,
      laneSyncWatermark: providerContract.laneSync.watermark,
      statePatch: providerContract.handoff.statePatch,
      usageLaneResumeHandoff: {
        schema: usageLaneResumeHandoff.schema,
        state: usageLaneResumeHandoff.state,
        eligibleForResume: usageLaneResumeHandoff.eligibleForResume,
        command: usageLaneResumeHandoff.routeContract.command,
        runAfter: usageLaneResumeHandoff.resume.at,
        retryAfterSeconds: usageLaneResumeHandoff.resume.retryAfterSeconds,
        reasonCodes: usageLaneResumeHandoff.reasonCodes,
        statePatch: usageLaneResumeHandoff.routeContract.statePatch
      }
    },
    auditProof: {
      schema: 'aios.scheduler.usageBackoff.auditProof.v1',
      subject: `${scope.tenantId}/${scope.routeId}/${requestState.requestId}`,
      decision: acceptance.decision,
      command,
      readinessLevel: readiness.level,
      proofKey: proofSeed,
      isolationKey: tenantBoundary.isolationKey,
      workspaceIsolationKey: workspaceBoundary.isolationKey,
      actorId: tenantBoundary.actor.id,
      workspaceId: scope.workspaceId,
      proofFields: ['surfaceId', 'generatedAt', 'requestId', 'tenantId', 'routeId', 'command', 'used', 'reserved', 'limit', 'quotaUnits', 'laneUnits', 'retryDelayMs', 'isolationKey', 'workspaceIsolationKey']
    },
    integrationWarnings: [
      ...providerContract.warnings,
      ...(lease.deadlineViolation ? [lease.deadlineViolation] : []),
      ...(command === 'enqueue' && requestState.deadlineExpired ? [{
        code: 'enqueue_after_deadline',
        severity: 'error',
        message: 'The runtime command would enqueue work after the request deadline.',
        action: 'Reject the request or issue a fresh deadline before enqueueing hosted-kernel work.'
      }] : [])
    ]
  };
}

function buildExportSummary(now, scope, tenantBoundary, workspaceBoundary, providerContract, operationalHealth, usageLane, admissionCost, usageLaneResumeHandoff, usageLaneAnalytics, limits, failure, backoff, mode, admitted, errors, analytics, acceptance, readiness, reporting, kernelRuntime, runtimeProfile, workflowHandoffEnvelope, lifecycleSettings, lifecycleControls, persistedState) {
  return {
    schema: 'aios.scheduler.usageBackoff.export.v1',
    generatedAt: now,
    surfaceId,
    scope,
    status: mode,
    admitted,
    quota: {
      limit: limits.limit,
      used: limits.used,
      reserved: limits.reserved,
      remaining: limits.remaining,
      pressurePct: Math.round(limits.pressure * 100),
      windowMs: limits.windowMs
    },
    admissionCost: {
      units: admissionCost.units,
      quotaUnits: admissionCost.quotaUnits,
      laneUnits: admissionCost.laneUnits,
      fits: admissionCost.fits,
      quotaFits: admissionCost.quotaFits,
      laneFits: admissionCost.laneFits,
      reservationKey: admissionCost.reservationKey,
      quotaRemainingBeforeDecision: admissionCost.quotaRemainingBeforeDecision,
      quotaRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
      laneRemainingBeforeDecision: admissionCost.laneRemainingBeforeDecision,
      laneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision,
      pressureAfterDecisionPct: admissionCost.pressureAfterDecisionPct,
      lanePressureAfterDecisionPct: admissionCost.lanePressureAfterDecisionPct
    },
    usageLane: {
      configured: usageLane.configured,
      id: usageLane.configured ? usageLane.id : null,
      kind: usageLane.configured ? usageLane.kind : null,
      tokenSubject: usageLane.configured ? usageLane.tokenSubject : null,
      limit: usageLane.configured ? usageLane.limit : null,
      used: usageLane.configured ? usageLane.used : null,
      reserved: usageLane.configured ? usageLane.reserved : null,
      remaining: usageLane.configured ? usageLane.remaining : null,
      pressurePct: usageLane.configured ? usageLane.pressurePct : null,
      exhausted: usageLane.configured ? usageLane.exhausted : false,
      resetAt: usageLane.configured ? usageLane.resetAt : null,
      resumeAt: usageLane.configured ? usageLane.resumeAt : null,
      resumeReason: usageLane.configured ? usageLane.resumeReason : 'none',
      failure: usageLane.configured
        ? {
            configured: usageLane.failure.configured,
            code: usageLane.failure.code,
            message: usageLane.failure.message,
            retryable: usageLane.failure.retryable,
            attempts: usageLane.failure.attempts,
            terminal: usageLane.failure.terminal,
            admissionImpact: usageLane.failure.admissionImpact,
            resumeAt: usageLane.failure.resumeAt,
            action: usageLane.failure.action
          }
        : null,
      scopeBoundary: usageLane.configured
        ? {
            enforced: usageLane.scopeBoundary.enforced,
            scoped: usageLane.scopeBoundary.scoped,
            matches: usageLane.scopeBoundary.matches,
            mismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            tenant: usageLane.scopeBoundary.comparisons.tenant,
            workspace: usageLane.scopeBoundary.comparisons.workspace,
            route: usageLane.scopeBoundary.comparisons.route
          }
        : null,
      history: usageLane.configured
        ? {
            sampleCount: usageLane.history.sampleCount,
            rejectedSampleCount: usageLane.history.rejectedSampleCount,
            consecutiveExhausted: usageLane.history.consecutiveExhausted,
            strikeLimit: usageLane.history.strikeLimit,
            enforcedBackoff: usageLane.history.enforcedBackoff,
            delayMs: usageLane.history.delayMs,
            resumeAt: usageLane.history.resumeAt,
            resumeReason: usageLane.history.resumeReason,
            lastSample: usageLane.history.lastSample
          }
        : null,
      stateKey: usageLane.configured ? usageLane.stateKey : null
    },
    usageLaneResumeHandoff: {
      schema: usageLaneResumeHandoff.schema,
      state: usageLaneResumeHandoff.state,
      eligibleForResume: usageLaneResumeHandoff.eligibleForResume,
      accepted: usageLaneResumeHandoff.accepted,
      resumeAt: usageLaneResumeHandoff.resume.at,
      retryAfterSeconds: usageLaneResumeHandoff.resume.retryAfterSeconds,
      command: usageLaneResumeHandoff.routeContract.command,
      target: usageLaneResumeHandoff.routeContract.target,
      deliveryMode: usageLaneResumeHandoff.routeContract.deliveryMode,
      continuationDeadlineAt: usageLaneResumeHandoff.continuation.deadlineAt,
      continuationExpired: usageLaneResumeHandoff.continuation.expired,
      resumeWithinContinuation: usageLaneResumeHandoff.continuation.resumeWithinDeadline,
      continuationOverflowMs: usageLaneResumeHandoff.continuation.overflowMs,
      reasonCodes: usageLaneResumeHandoff.reasonCodes,
      nextStepId: usageLaneResumeHandoff.nextStep?.id || null
    },
    usageLaneAnalytics: {
      schema: usageLaneAnalytics.schema,
      configured: usageLaneAnalytics.configured,
      laneId: usageLaneAnalytics.laneId,
      laneKind: usageLaneAnalytics.laneKind,
      counters: usageLaneAnalytics.counters,
      gauges: usageLaneAnalytics.gauges,
      nextResumeAt: usageLaneAnalytics.resume.next?.at || null,
      nextResumeSource: usageLaneAnalytics.resume.next?.source || 'none',
      resumeEligible: usageLaneAnalytics.resume.eligibleForResume,
      exportRowCount: usageLaneAnalytics.exportRows.length,
      rejectedRowCount: usageLaneAnalytics.rejectedRows.length,
      transitionCount: usageLaneAnalytics.transitions.filter((transition) => transition.changed).length,
      timelineEventCount: usageLaneAnalytics.timeline.length
    },
    retry: {
      retryable: failure.retryable,
      attempts: failure.attempts,
      delayMs: backoff.delayMs,
      nextRetryAt: backoff.nextRetryAt
    },
    counters: analytics.counters,
    gauges: analytics.gauges,
    acceptance: {
      accepted: acceptance.accepted,
      decision: acceptance.decision,
      blockingGateIds: acceptance.blockingGateIds
    },
    readiness: {
      ready: readiness.ready,
      level: readiness.level
    },
    reporting: {
      alertLevel: reporting.alert.level,
      pressureDeltaPct: reporting.trend.pressureDeltaPct,
      remainingDelta: reporting.trend.remainingDelta,
      retryDelayDeltaMs: reporting.trend.retryDelayDeltaMs,
      transitionCount: reporting.trend.transitionCount,
      exportRowCount: reporting.exportRows.length
    },
    runtime: {
      command: kernelRuntime.integration.command,
      executionState: kernelRuntime.integration.executionState,
      targetQueue: kernelRuntime.integration.targetQueue,
      providerId: kernelRuntime.integration.providerId,
      serviceId: kernelRuntime.integration.serviceId,
      isolationKey: kernelRuntime.integration.isolationKey,
      workspaceIsolationKey: kernelRuntime.integration.workspaceIsolationKey,
      stateStorePrefix: kernelRuntime.integration.stateStorePrefix,
      leaseKey: kernelRuntime.lease.key,
      leaseExpiresAt: kernelRuntime.lease.expiresAt,
      meteringReserveDelta: kernelRuntime.meteringPatch.reserveDelta,
      requestedUnits: kernelRuntime.meteringPatch.requestedUnits,
      quotaUnits: kernelRuntime.meteringPatch.quotaUnits,
      remainingAfterDecision: kernelRuntime.meteringPatch.remainingAfterDecision,
      pressureAfterDecisionPct: kernelRuntime.meteringPatch.pressureAfterDecisionPct,
      usageLaneId: kernelRuntime.schedulerCommand.usageLaneId,
      usageLaneResumeAt: kernelRuntime.schedulerCommand.usageLaneResumeAt,
      usageLaneReserveDelta: kernelRuntime.meteringPatch.usageLane.reserveDelta,
      usageLaneRemainingAfterDecision: kernelRuntime.meteringPatch.usageLane.remainingAfterDecision,
      warningCodes: kernelRuntime.integrationWarnings.map((warning) => warning.code)
    },
    handoff: {
      target: runtimeProfile.target,
      delivery: workflowHandoffEnvelope.delivery,
      responseStatusCode: workflowHandoffEnvelope.response.statusCode,
      contentType: workflowHandoffEnvelope.response.contentType,
      persisted: workflowHandoffEnvelope.persistence.enabled,
      stateStoreKey: workflowHandoffEnvelope.persistence.key,
      resumeCommandType: workflowHandoffEnvelope.resumeCommand?.type || null,
      acceptedContracts: runtimeProfile.acceptedContracts,
      continuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
      continuationWindowMs: runtimeProfile.continuation.windowMs,
      continuationExpired: runtimeProfile.continuation.expired,
      continuationTokenSource: runtimeProfile.continuation.tokenSource
    },
    lifecycle: {
      command: lifecycleSettings.command,
      commandAccepted: lifecycleSettings.commandAccepted,
      commandEffect: lifecycleSettings.commandEffect,
      controlState: lifecycleControls.controlState,
      enabled: lifecycleSettings.enabled,
      schedulingEnabled: lifecycleSettings.schedulingEnabled,
      pausedUntil: lifecycleSettings.pausedUntil,
      drainMode: lifecycleSettings.drainMode,
      maxConcurrent: lifecycleSettings.concurrency.max,
      activeLeases: lifecycleSettings.concurrency.active,
      requestedEnabled: lifecycleSettings.requested.enabled,
      requestedSchedulingEnabled: lifecycleSettings.requested.schedulingEnabled,
      effectiveAdmitsNewWork: lifecycleSettings.effective.admitsNewWork,
      schedulingHoldReason: lifecycleControls.schedulingControl.holdReason,
      autoResumeAt: lifecycleControls.schedulingControl.resume.at,
      autoResumeSource: lifecycleControls.schedulingControl.resume.source,
      nextActionId: lifecycleControls.nextAction?.id || null
    },
    persistedState: {
      key: persistedState.key,
      present: persistedState.present,
      restartStatus: persistedState.restartStatus,
      stale: persistedState.stale,
      generation: persistedState.nextPersistedState.generation,
      commandEffect: persistedState.commandReceipt.effect,
      duplicateCommand: persistedState.commandReceipt.duplicate,
      nextControlState: persistedState.nextPersistedState.controlState,
      nextResumeAt: persistedState.nextPersistedState.resumeAt
    },
    provider: {
      id: providerContract.provider.id,
      serviceId: providerContract.service.id,
      ready: providerContract.ready,
      syncState: providerContract.sync.state,
      syncCursor: providerContract.sync.cursor,
      watermark: providerContract.sync.watermark,
      laneSyncState: providerContract.laneSync.state,
      laneSyncCursor: providerContract.laneSync.cursor,
      laneSyncWatermark: providerContract.laneSync.watermark,
      handoffState: providerContract.handoff.state,
      laneHandoffState: providerContract.handoff.laneState,
      laneResumeAt: providerContract.handoff.resumeAt,
      missingCapabilities: providerContract.negotiation.missingCapabilities
    },
    operationalHealth: {
      configured: operationalHealth.configured,
      status: operationalHealth.status,
      admissionImpact: operationalHealth.admissionImpact,
      failClosed: operationalHealth.failClosed,
      dependencyState: operationalHealth.dependency.state,
      telemetryAgeMs: operationalHealth.telemetry.ageMs,
      telemetryStale: operationalHealth.telemetry.stale,
      recentErrorCount: operationalHealth.errors.recentCount,
      activeIncidentCount: operationalHealth.incidents.length,
      retryAfterMs: operationalHealth.retryAfterMs,
      issueCodes: operationalHealth.issueCodes
    },
    boundary: {
      enforced: tenantBoundary.enforced,
      workspaceId: tenantBoundary.workspaceId,
      actorId: tenantBoundary.actor.id,
      actorTenantId: tenantBoundary.actor.tenantId,
      isolationKey: tenantBoundary.isolationKey,
      checks: tenantBoundary.checks,
      missingPermissions: tenantBoundary.missingPermissions
    },
    workspaceBoundary: {
      enforced: workspaceBoundary.enforced,
      workspaceId: workspaceBoundary.workspaceId,
      requestedWorkspaceId: workspaceBoundary.requestedWorkspaceId,
      handoffWorkspaceId: workspaceBoundary.handoffWorkspaceId,
      isolationKey: workspaceBoundary.isolationKey,
      stateStorePrefix: workspaceBoundary.stateStorePrefix,
      checks: workspaceBoundary.checks,
      requiredWorkspaceRoles: workspaceBoundary.requiredWorkspaceRoles
    },
    errorCodes: errors.map((issue) => issue.code)
  };
}

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list
    .map((item) => (typeof item === 'string' ? item.trim() : null))
    .filter(Boolean))];
}

function normalizeClientRuntimeProfile(input, requestState, now) {
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const workflow = input.workflow && typeof input.workflow === 'object' ? input.workflow : {};
  const handoff = input.handoff && typeof input.handoff === 'object' ? input.handoff : {};
  const capabilities = normalizeStringList(input.capabilities || client.capabilities || runtime.capabilities || handoff.capabilities);
  const contracts = normalizeStringList(input.acceptContracts || client.acceptContracts || runtime.acceptContracts || handoff.acceptContracts);
  const supports = (name, fallback = false) => capabilities.includes(name) || asBoolean(handoff[name], asBoolean(runtime[name], asBoolean(client[name], fallback)));
  const delivery = firstString(input.handoffDelivery, handoff.delivery, workflow.handoffDelivery) || 'response';
  const continuationWindowMs = clamp(Math.trunc(asFiniteNumber(
    input.continuationWindowMs,
    asFiniteNumber(
      handoff.continuationWindowMs,
      asFiniteNumber(runtime.continuationWindowMs, asFiniteNumber(client.continuationWindowMs, DEFAULT_CONTINUATION_WINDOW_MS))
    )
  )), 0, DEFAULT_MAX_CONTINUATION_WINDOW_MS);
  const continuationDeadlineAt = normalizeDeadline(
    input.continuationDeadlineAt
      || handoff.continuationDeadlineAt
      || workflow.continuationDeadlineAt
      || runtime.continuationDeadlineAt
      || client.continuationDeadlineAt
  );
  const continuationWindowDeadlineAt = continuationWindowMs > 0
    ? new Date(new Date(now).getTime() + continuationWindowMs).toISOString()
    : null;
  const deadlineCandidates = [
    continuationDeadlineAt,
    continuationWindowDeadlineAt,
    requestState.deadlineAt
  ].filter(Boolean).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  const effectiveContinuationDeadlineAt = deadlineCandidates[0] || null;
  const continuationExpired = effectiveContinuationDeadlineAt
    ? new Date(effectiveContinuationDeadlineAt).getTime() <= new Date(now).getTime()
    : false;

  return {
    schema: 'aios.scheduler.usageBackoff.clientRuntimeProfile.v1',
    clientId: requestState.client.id,
    runtime: requestState.client.runtime,
    target: requestState.workflow.handoffTarget,
    delivery,
    callbackUrl: firstString(input.callbackUrl, handoff.callbackUrl, workflow.callbackUrl),
    stateStoreKey: firstString(input.stateStoreKey, handoff.stateStoreKey, workflow.stateStoreKey)
      || `${requestState.requestId}:scheduler-usage`,
    acceptedContracts: contracts.length > 0 ? contracts : ['aios.scheduler.usageBackoff.clientHandoff.v1'],
    capabilities,
    continuation: {
      schema: 'aios.scheduler.usageBackoff.runtimeContinuation.v1',
      windowMs: continuationWindowMs,
      deadlineAt: effectiveContinuationDeadlineAt,
      requestedDeadlineAt: continuationDeadlineAt,
      windowDeadlineAt: continuationWindowDeadlineAt,
      requestDeadlineAt: requestState.deadlineAt,
      expired: continuationExpired,
      canParkPastResponse: delivery !== 'response' || supports('state-patch', true),
      tokenSource: requestState.workflow.resumeToken
        ? 'workflow-resume-token'
        : requestState.idempotencyKey
          ? 'idempotency-key'
          : 'none'
    },
    supports: {
      retryAfterHeader: supports('retry-after-header', true),
      statePatch: supports('state-patch', true),
      workflowEvent: supports('workflow-event', true),
      problemJson: supports('problem-json', true),
      resumeToken: supports('resume-token', Boolean(requestState.workflow.resumeToken || requestState.idempotencyKey))
    }
  };
}

function normalizeProviderContract(input, now, scope, requestState, usageLane = null, admissionCost = null) {
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const service = input.service && typeof input.service === 'object' ? input.service : {};
  const integration = input.integration && typeof input.integration === 'object' ? input.integration : {};
  const laneContract = provider.usageLane && typeof provider.usageLane === 'object'
    ? provider.usageLane
    : service.usageLane && typeof service.usageLane === 'object'
      ? service.usageLane
      : integration.usageLane && typeof integration.usageLane === 'object'
        ? integration.usageLane
        : {};
  const handoff = provider.handoff && typeof provider.handoff === 'object'
    ? provider.handoff
    : integration.handoff && typeof integration.handoff === 'object'
      ? integration.handoff
      : {};
  const sync = provider.sync && typeof provider.sync === 'object'
    ? provider.sync
    : service.sync && typeof service.sync === 'object'
      ? service.sync
      : integration.sync && typeof integration.sync === 'object'
        ? integration.sync
        : {};
  const laneSync = laneContract.sync && typeof laneContract.sync === 'object'
    ? laneContract.sync
    : sync.usageLane && typeof sync.usageLane === 'object'
      ? sync.usageLane
      : {};
  const laneConfigured = Boolean(usageLane && usageLane.configured);
  const laneKind = laneConfigured ? usageLane.kind : null;
  const laneRequiredCapabilities = laneConfigured
    ? laneKind === 'oauth'
      ? ['oauth-meter-sync', 'token-subject-handoff']
      : laneKind === 'message-metered'
        ? ['message-meter-sync', 'meter-reservation']
        : ['custom-meter-sync']
    : [];
  const rawAdvertisedCapabilities = normalizeStringList(
    input.providerCapabilities
      || provider.capabilities
      || service.capabilities
      || integration.capabilities
  );
  const requiredCapabilities = normalizeStringList(
    input.requiredProviderCapabilities
      || provider.requiredCapabilities
      || service.requiredCapabilities
      || integration.requiredCapabilities
  );
  const baseRequiredCapabilities = requiredCapabilities.length > 0
    ? requiredCapabilities
    : ['usage-metering', 'retry-backoff', 'lease-handoff'];
  const effectiveRequiredCapabilities = [...new Set([...baseRequiredCapabilities, ...laneRequiredCapabilities])];
  const advertisedCapabilities = rawAdvertisedCapabilities.length > 0
    ? rawAdvertisedCapabilities
    : baseRequiredCapabilities;
  const missingCapabilities = effectiveRequiredCapabilities.filter((capability) => !advertisedCapabilities.includes(capability));
  const acceptedCapabilities = effectiveRequiredCapabilities.filter((capability) => advertisedCapabilities.includes(capability));
  const providerId = firstString(input.providerId, provider.id, provider.providerId, integration.providerId) || 'hosted-kernel-provider';
  const serviceId = firstString(input.serviceId, service.id, service.serviceId, provider.serviceId, integration.serviceId) || `${providerId}:scheduler`;
  const endpoint = firstString(input.serviceEndpoint, service.endpoint, provider.endpoint, integration.endpoint);
  const syncCursor = firstString(input.syncCursor, sync.cursor, sync.offset, service.syncCursor);
  const syncWatermark = normalizeDeadline(input.syncWatermark || sync.watermark || sync.watermarkAt || service.watermarkAt);
  const laneHistoryCursor = laneConfigured && usageLane.history.lastSample?.sequence != null
    ? `sample:${usageLane.history.lastSample.sequence}`
    : null;
  const laneSyncCursor = firstString(
    input.laneSyncCursor,
    laneSync.cursor,
    laneSync.offset,
    laneContract.syncCursor,
    laneHistoryCursor
  );
  const laneSyncWatermark = normalizeDeadline(
    input.laneSyncWatermark
      || laneSync.watermark
      || laneSync.watermarkAt
      || laneContract.watermarkAt
      || (laneConfigured ? usageLane.history.lastSample?.observedAt : null)
  );
  const laneSyncState = !laneConfigured
    ? 'not-configured'
    : !laneSyncCursor && !laneSyncWatermark
      ? 'missing'
      : laneSyncWatermark && new Date(laneSyncWatermark).getTime() > new Date(now).getTime()
        ? 'future-watermark'
        : 'ready';
  const handoffRequired = asBoolean(
    input.externalHandoffRequired,
    asBoolean(handoff.required, asBoolean(provider.externalHandoffRequired, laneConfigured && usageLane.exhausted))
  );
  const callbackUrl = firstString(input.externalCallbackUrl, handoff.callbackUrl, handoff.endpoint, integration.callbackUrl);
  const commandTopic = firstString(input.commandTopic, handoff.commandTopic, integration.commandTopic)
    || `scheduler.usage-backoff.${scope.tenantId}.${scope.routeId}`;
  const deliveryMode = firstString(input.providerDeliveryMode, handoff.deliveryMode, handoff.delivery, integration.deliveryMode) || 'inline';
  const syncState = !syncCursor && !syncWatermark
    ? 'uninitialized'
    : syncWatermark && new Date(syncWatermark).getTime() > new Date(now).getTime()
      ? 'future-watermark'
      : 'ready';
  const ready = missingCapabilities.length === 0
    && (!handoffRequired || Boolean(callbackUrl || commandTopic))
    && syncState !== 'future-watermark'
    && laneSyncState !== 'future-watermark';
  const laneResumeAt = laneConfigured ? usageLane.resumeAt : null;
  const laneHandoffState = !laneConfigured
    ? 'not-configured'
    : ready && usageLane.exhausted
      ? 'parked-until-resume'
      : ready && admissionCost && !admissionCost.laneFits
        ? 'awaiting-capacity'
        : ready
          ? 'ready'
          : 'awaiting-provider-contract';

  return {
    schema: 'aios.scheduler.usageBackoff.providerContract.v1',
    generatedAt: now,
    ready,
    provider: {
      id: providerId,
      kind: firstString(input.providerKind, provider.kind, provider.type) || 'hosted-kernel',
      region: firstString(input.providerRegion, provider.region, service.region, integration.region) || 'local',
      capabilities: advertisedCapabilities
    },
    service: {
      id: serviceId,
      name: firstString(input.serviceName, service.name, provider.serviceName) || 'scheduler-usage-backoff',
      version: firstString(input.serviceVersion, service.version, provider.version, integration.version) || 'v1',
      endpoint
    },
    negotiation: {
      requiredCapabilities: effectiveRequiredCapabilities,
      baseRequiredCapabilities,
      laneRequiredCapabilities,
      acceptedCapabilities,
      missingCapabilities,
      acceptedContracts: normalizeStringList(provider.acceptContracts || service.acceptContracts || integration.acceptContracts)
    },
    sync: {
      state: syncState,
      cursor: syncCursor,
      watermark: syncWatermark,
      metadata: {
        requestId: requestState.requestId,
        traceId: requestState.traceId,
        isolationKey: `${scope.tenantId}/${scope.workspaceId}/${serviceId}`
      }
    },
    laneSync: {
      schema: 'aios.scheduler.usageBackoff.providerLaneSync.v1',
      configured: laneConfigured,
      state: laneSyncState,
      laneId: laneConfigured ? usageLane.id : null,
      laneKind,
      tokenSubject: laneConfigured ? usageLane.tokenSubject : null,
      cursor: laneSyncCursor,
      watermark: laneSyncWatermark,
      resetAt: laneConfigured ? usageLane.resetAt : null,
      resumeAt: laneResumeAt,
      resumeReason: laneConfigured ? usageLane.resumeReason : 'none',
      pressurePct: laneConfigured ? usageLane.pressurePct : null,
      remaining: laneConfigured ? usageLane.remaining : null,
      reservationDelta: laneConfigured && admissionCost ? admissionCost.laneUnits : 0,
      stateKey: laneConfigured ? usageLane.stateKey : null
    },
    handoff: {
      required: handoffRequired,
      state: laneConfigured && usageLane.exhausted ? laneHandoffState : ready ? 'ready' : handoffRequired ? 'awaiting-provider' : 'inline-only',
      target: firstString(input.externalHandoffTarget, handoff.target, integration.target) || serviceId,
      callbackUrl,
      commandTopic,
      deliveryMode,
      laneState: laneHandoffState,
      resumeAt: laneResumeAt,
      statePatch: laneConfigured
        ? {
            usageLaneId: usageLane.id,
            usageLaneKind: usageLane.kind,
            usageLaneResumeAt: laneResumeAt,
            usageLaneResumeReason: usageLane.resumeReason,
            usageLaneRemaining: usageLane.remaining,
            usageLanePressurePct: usageLane.pressurePct,
            usageLaneFailureCode: usageLane.failure.code,
            usageLaneFailureTerminal: usageLane.failure.terminal,
            usageLaneFailureImpact: usageLane.failure.admissionImpact,
            usageLaneFailureResumeAt: usageLane.failure.resumeAt,
            usageLaneScopeMatches: usageLane.scopeBoundary.matches,
            usageLaneScopeMismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            usageLaneRejectedHistorySamples: usageLane.history.rejectedSampleCount,
            laneSyncCursor,
            laneSyncWatermark
          }
        : null
    },
    warnings: []
  };
}

function buildProviderContractValidation(providerContract) {
  const issues = [];
  if (providerContract.negotiation.missingCapabilities.length > 0) {
    issues.push({
      code: 'provider_capability_missing',
      severity: 'error',
      message: 'Scheduler provider did not advertise all capabilities required for usage-backed admission.',
      action: `Add provider capabilities: ${providerContract.negotiation.missingCapabilities.join(', ')}.`
    });
  }
  if (providerContract.sync.state === 'future-watermark') {
    issues.push({
      code: 'provider_sync_watermark_future',
      severity: 'error',
      message: 'Provider sync watermark is in the future and cannot be used as an auditable scheduler handoff point.',
      action: 'Refresh provider sync metadata with a watermark observed at or before the scheduler evaluation time.'
    });
  }
  if (providerContract.sync.state === 'uninitialized') {
    issues.push({
      code: 'provider_sync_metadata_missing',
      severity: 'warning',
      message: 'Provider sync cursor and watermark are missing for this scheduler usage decision.',
      action: 'Attach provider.sync.cursor or provider.sync.watermark so external handoffs can resume from a known point.'
    });
  }
  if (providerContract.laneSync.state === 'missing') {
    issues.push({
      code: 'provider_lane_sync_metadata_missing',
      severity: 'warning',
      message: 'Provider lane sync cursor and watermark are missing for this OAuth or message-metered scheduler lane.',
      action: 'Attach provider.usageLane.sync.cursor or provider.usageLane.sync.watermark so lane handoffs can resume from a known meter snapshot.'
    });
  }
  if (providerContract.laneSync.state === 'future-watermark') {
    issues.push({
      code: 'provider_lane_sync_watermark_future',
      severity: 'error',
      message: 'Provider lane sync watermark is in the future and cannot anchor OAuth or message-metered lane recovery.',
      action: 'Refresh provider lane sync metadata with a watermark observed at or before the scheduler evaluation time.'
    });
  }
  if (providerContract.handoff.required && !providerContract.handoff.callbackUrl && providerContract.handoff.deliveryMode !== 'topic') {
    issues.push({
      code: 'provider_handoff_target_missing',
      severity: 'error',
      message: 'External provider handoff requires a callback URL or topic delivery mode.',
      action: 'Provide provider.handoff.callbackUrl or set provider.handoff.deliveryMode to topic.'
    });
  }
  if (!providerContract.service.endpoint) {
    issues.push({
      code: 'provider_service_endpoint_missing',
      severity: 'info',
      message: 'Provider service endpoint is not set; runtime integration will rely on the local hosted-kernel queue.',
      action: 'Set service.endpoint when scheduler commands must be handed to an external provider service.'
    });
  }
  providerContract.warnings.push(...issues.filter((issue) => issue.severity !== 'error'));
  return issues;
}

function buildRuntimeAdoptionValidation(runtimeProfile, requestState) {
  const issues = [];
  if (runtimeProfile.delivery !== 'response' && !runtimeProfile.callbackUrl) {
    issues.push({
      code: 'handoff_callback_missing',
      severity: 'warning',
      message: 'Client runtime requested an out-of-band scheduler handoff without a callback URL.',
      action: 'Provide handoff.callbackUrl or switch handoff.delivery to response.'
    });
  }
  if (!runtimeProfile.supports.resumeToken && requestState.workflow.resumeToken) {
    issues.push({
      code: 'runtime_resume_token_unsupported',
      severity: 'warning',
      message: 'Workflow supplied a resume token but the client runtime did not advertise resume-token support.',
      action: 'Enable resume-token support or provide an idempotency key for deferred scheduler handoffs.'
    });
  }
  if (!runtimeProfile.acceptedContracts.includes('aios.scheduler.usageBackoff.clientHandoff.v1')) {
    issues.push({
      code: 'client_handoff_contract_not_accepted',
      severity: 'info',
      message: 'Client runtime did not explicitly accept the scheduler client handoff contract.',
      action: 'Advertise aios.scheduler.usageBackoff.clientHandoff.v1 in accepted contracts for deterministic handoff parsing.'
    });
  }
  if (runtimeProfile.continuation.expired) {
    issues.push({
      code: 'runtime_continuation_window_expired',
      severity: 'error',
      message: 'Client runtime continuation window expired before scheduler usage admission completed.',
      action: 'Start a new workflow continuation with a fresh deadline before parking usage-lane work.'
    });
  }
  if (runtimeProfile.supports.resumeToken && !runtimeProfile.continuation.deadlineAt) {
    issues.push({
      code: 'runtime_continuation_deadline_missing',
      severity: 'warning',
      message: 'Client runtime can resume deferred work but did not provide a bounded continuation deadline.',
      action: 'Provide continuationDeadlineAt or continuationWindowMs so scheduler lane handoffs expire deterministically.'
    });
  }
  if (requestState.deadlineAt && runtimeProfile.continuation.requestedDeadlineAt && new Date(runtimeProfile.continuation.requestedDeadlineAt).getTime() > new Date(requestState.deadlineAt).getTime()) {
    issues.push({
      code: 'runtime_continuation_exceeds_request_deadline',
      severity: 'warning',
      message: 'Client runtime continuation deadline extends past the request deadline.',
      action: 'Use a continuation deadline no later than the request deadline or refresh the request before resuming.'
    });
  }
  return issues;
}

function buildClientHandoff(now, scope, tenantBoundary, workspaceBoundary, requestState, runtimeProfile, limits, failure, backoff, mode, acceptance, readiness, nextSteps, validationSummary, usageLane, admissionCost) {
  const retryAfterSeconds = backoff.delayMs > 0 ? Math.ceil(backoff.delayMs / 1000) : 0;
  const handoffState = acceptance.accepted
    ? 'admit'
    : backoff.delayMs > 0
      ? 'defer'
      : mode === 'blocked'
        ? 'block'
        : 'review';
  const quotaResumeAt = !admissionCost.quotaFits && limits.windowMs > 0
    ? new Date(new Date(now).getTime() + limits.windowMs).toISOString()
    : null;
  const resumeAt = backoff.nextRetryAt || usageLane.resumeAt || quotaResumeAt;
  const resumeMs = resumeAt ? new Date(resumeAt).getTime() : null;
  const continuationDeadlineMs = runtimeProfile.continuation.deadlineAt
    ? new Date(runtimeProfile.continuation.deadlineAt).getTime()
    : null;
  const resumeWithinContinuation = resumeMs == null
    ? true
    : continuationDeadlineMs == null
      ? true
      : resumeMs <= continuationDeadlineMs;
  const continuationAllowsResume = !runtimeProfile.continuation.expired
    && runtimeProfile.continuation.canParkPastResponse
    && resumeWithinContinuation;
  const onlyCapacityBlocked = acceptance.blockingGateIds.every((gateId) => ['capacity-available', 'admission-cost', 'usage-lane', 'input-valid'].includes(gateId));
  const onlyCapacityIssues = validationSummary.blockingIssueCodes.every((code) => [
    'admission_cost_exceeds_quota',
    'admission_cost_exceeds_usage_lane',
    'usage_lane_exhausted',
    'usage_lane_history_backoff',
    'usage_lane_failure_backoff',
    'quota_exhausted'
  ].includes(code));
  const canResumeAfterCapacity = handoffState === 'block'
    && onlyCapacityBlocked
    && onlyCapacityIssues
    && failure.retryable
    && Boolean(resumeAt)
    && continuationAllowsResume;
  const clientStatePatch = {
    schedulerUsageMode: mode,
    schedulerAdmission: handoffState,
    schedulerPressurePct: Math.round(limits.pressure * 100),
    schedulerRemainingCapacity: limits.remaining,
    schedulerUsageLaneId: usageLane.configured ? usageLane.id : null,
    schedulerUsageLaneKind: usageLane.configured ? usageLane.kind : null,
    schedulerUsageLanePressurePct: usageLane.configured ? usageLane.pressurePct : null,
    schedulerUsageLaneResumeAt: usageLane.configured ? usageLane.resumeAt : null,
    schedulerUsageLaneBackoffReason: usageLane.configured ? usageLane.resumeReason : 'none',
    schedulerUsageLaneConsecutiveExhausted: usageLane.configured ? usageLane.history.consecutiveExhausted : 0,
    schedulerUsageLaneFailureCode: usageLane.configured ? usageLane.failure.code : null,
    schedulerUsageLaneFailureTerminal: usageLane.configured ? usageLane.failure.terminal : false,
    schedulerUsageLaneFailureImpact: usageLane.configured ? usageLane.failure.admissionImpact : 'allow',
    schedulerUsageLaneFailureResumeAt: usageLane.configured ? usageLane.failure.resumeAt : null,
    schedulerUsageLaneScopeMatches: usageLane.configured ? usageLane.scopeBoundary.matches : true,
    schedulerUsageLaneScopeMismatchCodes: usageLane.configured ? usageLane.scopeBoundary.mismatchCodes : [],
    schedulerUsageLaneRejectedHistorySamples: usageLane.configured ? usageLane.history.rejectedSampleCount : 0,
    schedulerAdmissionUnits: admissionCost.units,
    schedulerQuotaUnits: admissionCost.quotaUnits,
    schedulerLaneUnits: admissionCost.laneUnits,
    schedulerAdmissionCostFits: admissionCost.fits,
    schedulerRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
    schedulerLaneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision,
    schedulerWorkspaceId: scope.workspaceId,
    schedulerIsolationKey: tenantBoundary.isolationKey,
    schedulerWorkspaceIsolationKey: workspaceBoundary.isolationKey,
    schedulerStateStorePrefix: workspaceBoundary.stateStorePrefix,
    schedulerContinuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
    schedulerContinuationWindowMs: runtimeProfile.continuation.windowMs,
    schedulerContinuationExpired: runtimeProfile.continuation.expired,
    schedulerContinuationResumeWithinDeadline: resumeWithinContinuation,
    nextSchedulerRetryAt: resumeAt,
    schedulerRecommendedActionId: nextSteps.recommendedActionId
  };

  return {
    schema: 'aios.scheduler.usageBackoff.clientHandoff.v1',
    generatedAt: now,
    target: requestState.workflow.handoffTarget,
    requestId: requestState.requestId,
    traceId: requestState.traceId,
    scope,
    handoffState,
    userVisibleStatus: handoffState === 'admit'
      ? 'Scheduler accepted the request.'
      : handoffState === 'defer'
        ? 'Scheduler paused the request until the retry window opens.'
        : handoffState === 'block'
          ? 'Scheduler blocked the request until usage or validation issues are resolved.'
          : 'Scheduler requires review before continuing the request.',
    resume: {
      allowed: continuationAllowsResume && (handoffState === 'defer' || canResumeAfterCapacity || (handoffState === 'block' && failure.retryable && validationSummary.valid)),
      at: resumeAt,
      token: requestState.workflow.resumeToken || requestState.idempotencyKey,
      retryAfterMs: backoff.delayMs,
      retryAfterSeconds,
      continuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
      withinContinuationDeadline: resumeWithinContinuation
    },
    usageLane: {
      configured: usageLane.configured,
      id: usageLane.configured ? usageLane.id : null,
      kind: usageLane.configured ? usageLane.kind : null,
      exhausted: usageLane.configured ? usageLane.exhausted : false,
      pressurePct: usageLane.configured ? usageLane.pressurePct : null,
      remaining: usageLane.configured ? usageLane.remaining : null,
      resetAt: usageLane.configured ? usageLane.resetAt : null,
      resumeAt: usageLane.configured ? usageLane.resumeAt : null,
      resumeReason: usageLane.configured ? usageLane.resumeReason : 'none',
      failure: usageLane.configured
        ? {
            configured: usageLane.failure.configured,
            code: usageLane.failure.code,
            retryable: usageLane.failure.retryable,
            terminal: usageLane.failure.terminal,
            admissionImpact: usageLane.failure.admissionImpact,
            resumeAt: usageLane.failure.resumeAt
          }
        : null,
      scopeBoundary: usageLane.configured
        ? {
            enforced: usageLane.scopeBoundary.enforced,
            matches: usageLane.scopeBoundary.matches,
            mismatchCodes: usageLane.scopeBoundary.mismatchCodes,
            rejectedHistorySamples: usageLane.history.rejectedSampleCount
          }
        : null,
      historyBackoff: usageLane.configured ? usageLane.history.enforcedBackoff : false,
      consecutiveExhausted: usageLane.configured ? usageLane.history.consecutiveExhausted : 0
    },
    admissionCost: {
      schema: admissionCost.schema,
      units: admissionCost.units,
      quotaUnits: admissionCost.quotaUnits,
      laneUnits: admissionCost.laneUnits,
      fits: admissionCost.fits,
      quotaFits: admissionCost.quotaFits,
      laneFits: admissionCost.laneFits,
      quotaRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
      laneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision,
      reservationKey: admissionCost.reservationKey
    },
    clientStatePatch,
    responseHints: {
      statusCode: handoffState === 'admit' ? 202 : handoffState === 'defer' ? 429 : 423,
      contentType: runtimeProfile.supports.problemJson && handoffState !== 'admit'
        ? 'application/problem+json'
        : 'application/json',
      headers: {
        ...(runtimeProfile.supports.retryAfterHeader && retryAfterSeconds > 0 ? { 'retry-after': String(retryAfterSeconds) } : {}),
        'x-aios-scheduler-mode': mode,
        'x-aios-scheduler-action': nextSteps.recommendedActionId,
        'x-aios-workspace-id': scope.workspaceId,
        ...(usageLane.configured ? { 'x-aios-usage-lane': usageLane.id } : {}),
        ...(usageLane.resumeAt ? { 'x-aios-usage-lane-resume-at': usageLane.resumeAt } : {}),
        ...(runtimeProfile.continuation.deadlineAt ? { 'x-aios-continuation-deadline-at': runtimeProfile.continuation.deadlineAt } : {}),
        ...(requestState.traceId ? { 'x-aios-trace-id': requestState.traceId } : {})
      }
    },
    workflowEvent: {
      type: `scheduler.usageBackoff.${handoffState}`,
      workflowId: requestState.workflow.id,
      stepId: requestState.workflow.stepId,
      emittedAt: now,
      operation: requestState.operation,
      nextStep: nextSteps.steps[0],
      blockingGateIds: acceptance.blockingGateIds
    },
    boundary: {
      enforced: tenantBoundary.enforced,
      isolationKey: tenantBoundary.isolationKey,
      checks: tenantBoundary.checks,
      missingPermissions: tenantBoundary.missingPermissions
    },
    workspaceBoundary: {
      enforced: workspaceBoundary.enforced,
      isolationKey: workspaceBoundary.isolationKey,
      checks: workspaceBoundary.checks,
      requestedWorkspaceId: workspaceBoundary.requestedWorkspaceId,
      handoffWorkspaceId: workspaceBoundary.handoffWorkspaceId,
      requiredWorkspaceRoles: workspaceBoundary.requiredWorkspaceRoles
    },
    runtimeDelivery: {
      schema: 'aios.scheduler.usageBackoff.runtimeDelivery.v1',
      delivery: runtimeProfile.delivery,
      callbackUrl: runtimeProfile.callbackUrl,
      stateStoreKey: runtimeProfile.stateStoreKey,
      applyStatePatch: runtimeProfile.supports.statePatch,
      emitWorkflowEvent: runtimeProfile.supports.workflowEvent,
      acceptedContracts: runtimeProfile.acceptedContracts,
      continuationDeadlineAt: runtimeProfile.continuation.deadlineAt,
      continuationExpired: runtimeProfile.continuation.expired
    },
    readinessLevel: readiness.level
  };
}

function buildWorkflowHandoffEnvelope(now, scope, requestState, runtimeProfile, clientHandoff, kernelRuntime, adoptionWarnings) {
  const shouldPersist = clientHandoff.handoffState !== 'admit' && runtimeProfile.supports.statePatch;
  const resumeCommand = clientHandoff.resume.allowed
    ? {
        type: 'scheduler.usageBackoff.resume',
        token: clientHandoff.resume.token,
        runAfter: clientHandoff.resume.at || now,
        requestId: requestState.requestId,
        idempotencyKey: requestState.idempotencyKey || kernelRuntime.integration.idempotencyKey
      }
    : null;

  return {
    schema: 'aios.scheduler.usageBackoff.workflowHandoffEnvelope.v1',
    generatedAt: now,
    scope,
    requestId: requestState.requestId,
    target: runtimeProfile.target,
    delivery: runtimeProfile.delivery,
    command: kernelRuntime.integration.command,
    executionState: kernelRuntime.integration.executionState,
    userVisibleStatus: clientHandoff.userVisibleStatus,
    response: {
      statusCode: clientHandoff.responseHints.statusCode,
      contentType: clientHandoff.responseHints.contentType,
      headers: clientHandoff.responseHints.headers,
      bodySchema: clientHandoff.schema,
      problemType: clientHandoff.handoffState === 'admit'
        ? null
        : `urn:aios:scheduler:usage-backoff:${clientHandoff.handoffState}`
    },
    persistence: {
      enabled: shouldPersist,
      key: shouldPersist ? runtimeProfile.stateStoreKey : null,
      patch: shouldPersist ? clientHandoff.clientStatePatch : null
    },
    workflowEvent: runtimeProfile.supports.workflowEvent ? clientHandoff.workflowEvent : null,
    resumeCommand,
    audit: {
      proofSubject: kernelRuntime.auditProof.subject,
      proofKey: kernelRuntime.auditProof.proofKey,
      warningCodes: adoptionWarnings.map((warning) => warning.code)
    }
  };
}

function buildActionableErrors(validation, limits, failure, mode) {
  const errors = [...validation];
  const quotaBlocked = limits.limit <= 0 || limits.remaining <= 0 || limits.pressure >= 1;
  if (mode === 'blocked' && quotaBlocked) {
    errors.push({
      code: limits.limit <= 0 ? 'admission_unconfigured' : 'quota_exhausted',
      severity: 'error',
      message: limits.limit <= 0 ? 'Scheduler usage admission is blocked because quota is not configured.' : 'Scheduler usage admission is blocked because the quota window is exhausted.',
      action: limits.limit <= 0 ? 'Configure quota limits for this hosted-kernel tenant or route.' : 'Wait for the quota window to reset, lower concurrency, or request a quota increase.'
    });
  }
  if (failure.present && !failure.retryable) {
    errors.push({
      code: 'non_retryable_failure',
      severity: 'error',
      message: failure.message || 'The last scheduler failure is marked non-retryable.',
      action: 'Do not enqueue an automatic retry; surface the failure to the caller for remediation.'
    });
  }
  return errors;
}

export function describeUsageBackoffSurface(input = {}) {
  const now = normalizeIso(input.now);
  const scope = normalizeScope(input);
  const tenantBoundary = normalizeTenantBoundary(input, scope);
  const requestState = normalizeRequestState(input, scope, now);
  const workspaceBoundary = normalizeWorkspaceBoundary(input, scope, tenantBoundary, requestState);
  const runtimeProfile = normalizeClientRuntimeProfile(input, requestState, now);
  const limits = normalizeLimits(input);
  const usageLane = normalizeUsageLane(input, now, scope, limits);
  const admissionCost = normalizeAdmissionCost(input, limits, usageLane);
  const providerContract = normalizeProviderContract(input, now, scope, requestState, usageLane, admissionCost);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const failure = normalizeFailure(input);
  const history = normalizeHistory(input);
  const operationalHealth = normalizeOperationalHealth(input, now, history, failure);
  const baseValidation = [
    ...buildValidation(input, limits),
    ...buildTenantBoundaryValidation(tenantBoundary),
    ...buildWorkspaceBoundaryValidation(workspaceBoundary),
    ...buildRequestValidation(requestState),
    ...buildRuntimeAdoptionValidation(runtimeProfile, requestState),
    ...buildProviderContractValidation(providerContract),
    ...buildLifecycleValidation(lifecycleSettings),
    ...buildOperationalHealthValidation(operationalHealth),
    ...buildUsageLaneValidation(usageLane),
    ...buildAdmissionCostValidation(admissionCost, usageLane)
  ];
  const backoff = applyUsageLaneBackoffPolicy(
    applyOperationalHealthBackoffPolicy(
      applyLifecycleBackoffPolicy(calculateBackoff(input, failure, now), lifecycleSettings, now),
      operationalHealth,
      now
    ),
    usageLane,
    now
  );
  const degradedAt = clamp(asFiniteNumber(input.degradedAt, DEFAULT_DEGRADED_AT), 0, 1);
  const blockedAt = clamp(asFiniteNumber(input.blockedAt, DEFAULT_BLOCKED_AT), degradedAt, 1);
  const lifecycleAdmissionHeld = !lifecycleSettings.schedulingEnabled || lifecycleSettings.pausedActive || lifecycleSettings.command === 'pause';
  const initialHasError = baseValidation.some((issue) => issue.severity === 'error');
  const operationalAdmissionBlocked = operationalHealth.admissionImpact === 'block';
  const operationalAdmissionDegraded = operationalHealth.admissionImpact === 'degrade';
  const usageLaneAdmissionBlocked = usageLane.admissionImpact === 'block';
  const usageLaneAdmissionDegraded = usageLane.admissionImpact === 'degrade';
  const costAdmissionBlocked = !admissionCost.fits;
  const initialMode = initialHasError || operationalAdmissionBlocked || usageLaneAdmissionBlocked || costAdmissionBlocked || limits.pressure >= blockedAt || (failure.present && !failure.retryable)
    ? 'blocked'
    : operationalAdmissionDegraded || usageLaneAdmissionDegraded || lifecycleAdmissionHeld || limits.pressure >= degradedAt || backoff.delayMs > 0
      ? 'degraded'
      : 'healthy';
  const initialAdmitted = initialMode !== 'blocked' && !lifecycleAdmissionHeld && backoff.delayMs === 0;
  let persistedState = normalizePersistedSchedulerState(input, now, scope, requestState, lifecycleSettings, initialMode, initialAdmitted, backoff, usageLane, admissionCost);
  const persistenceValidation = buildPersistenceValidation(persistedState);
  const validation = [...baseValidation, ...persistenceValidation];
  const hasError = validation.some((issue) => issue.severity === 'error');
  const mode = hasError || operationalAdmissionBlocked || usageLaneAdmissionBlocked || costAdmissionBlocked || limits.pressure >= blockedAt || (failure.present && !failure.retryable)
    ? 'blocked'
    : operationalAdmissionDegraded || usageLaneAdmissionDegraded || lifecycleAdmissionHeld || limits.pressure >= degradedAt || backoff.delayMs > 0
      ? 'degraded'
      : 'healthy';
  const admitted = mode !== 'blocked' && !lifecycleAdmissionHeld && backoff.delayMs === 0;
  if (mode !== initialMode || admitted !== initialAdmitted) {
    persistedState = normalizePersistedSchedulerState(input, now, scope, requestState, lifecycleSettings, mode, admitted, backoff, usageLane, admissionCost);
  }
  const errors = buildActionableErrors(validation, limits, failure, mode);
  const analytics = buildAnalytics(limits, failure, backoff, mode, admitted, errors, history);
  const timeline = buildTimeline(now, history, limits, backoff, mode, admitted, errors);
  const historySnapshot = buildCurrentHistorySnapshot(now, scope, limits, failure, backoff, mode, admitted, errors);
  const reporting = buildReportingState(now, scope, history, historySnapshot, analytics, timeline);
  const validationSummary = buildValidationSummary(validation, errors);
  const acceptance = buildAcceptanceContract(now, scope, tenantBoundary, workspaceBoundary, providerContract, operationalHealth, usageLane, admissionCost, limits, failure, backoff, mode, admitted, validationSummary);
  const readiness = buildReadinessContract(now, limits, backoff, mode, acceptance, validationSummary);
  const nextSteps = buildNextSteps(limits, failure, backoff, mode, acceptance, validationSummary, lifecycleSettings, tenantBoundary, workspaceBoundary, operationalHealth, usageLane, admissionCost);
  const lifecycleControls = buildLifecycleControls(now, scope, requestState, lifecycleSettings, mode, admitted, acceptance, backoff);
  const usageLaneResumeHandoff = buildUsageLaneResumeHandoff(now, scope, requestState, runtimeProfile, providerContract, usageLane, admissionCost, backoff, acceptance, readiness, validationSummary, nextSteps);
  const usageLaneAnalytics = buildUsageLaneAnalytics(now, scope, usageLane, admissionCost, usageLaneResumeHandoff, mode, admitted);
  const preview = buildPreviewContract(now, scope, limits, failure, backoff, mode, admitted, acceptance, readiness, nextSteps, usageLane, admissionCost, usageLaneResumeHandoff);
  const clientHandoff = buildClientHandoff(now, scope, tenantBoundary, workspaceBoundary, requestState, runtimeProfile, limits, failure, backoff, mode, acceptance, readiness, nextSteps, validationSummary, usageLane, admissionCost);
  const kernelRuntime = buildKernelRuntimeContract(now, scope, tenantBoundary, workspaceBoundary, providerContract, requestState, limits, failure, backoff, mode, admitted, acceptance, readiness, nextSteps, clientHandoff, usageLane, admissionCost, usageLaneResumeHandoff, input);
  const runtimeWarnings = kernelRuntime.integrationWarnings.filter((warning) => !errors.some((issue) => issue.code === warning.code));
  const workflowHandoffEnvelope = buildWorkflowHandoffEnvelope(now, scope, requestState, runtimeProfile, clientHandoff, kernelRuntime, runtimeWarnings);
  const outputErrors = [...errors, ...runtimeWarnings];
  const exportSummary = buildExportSummary(now, scope, tenantBoundary, workspaceBoundary, providerContract, operationalHealth, usageLane, admissionCost, usageLaneResumeHandoff, usageLaneAnalytics, limits, failure, backoff, mode, admitted, outputErrors, analytics, acceptance, readiness, reporting, kernelRuntime, runtimeProfile, workflowHandoffEnvelope, lifecycleSettings, lifecycleControls, persistedState);

  return {
    ok: admitted && !outputErrors.some((issue) => issue.severity === 'error'),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel scheduler usage admission and retry backoff health contract',
    scope,
    state: {
      mode,
      admitted,
      degraded: mode === 'degraded',
      blocked: mode === 'blocked'
    },
    request: requestState,
    tenantBoundary,
    workspaceBoundary,
    limits,
    retry: {
      retryable: failure.retryable,
      attempts: failure.attempts,
      delayMs: backoff.delayMs,
      nextRetryAt: backoff.nextRetryAt,
      backoffSource: backoff.source
    },
    failure,
    usageLane,
    admissionCost,
    lifecycleSettings,
    lifecycleControls,
    persistedState,
    providerContract,
    operationalHealth,
    health: {
      status: mode,
      operationalStatus: operationalHealth.status,
      admissionImpact: operationalHealth.admissionImpact,
      dependencyState: operationalHealth.dependency.state,
      telemetryStale: operationalHealth.telemetry.stale,
      recentErrorCount: operationalHealth.errors.recentCount,
      activeIncidentCount: operationalHealth.incidents.length,
      usageLaneConfigured: usageLane.configured,
      usageLanePressurePct: usageLane.configured ? usageLane.pressurePct : null,
      usageLaneResumeAt: usageLane.configured ? usageLane.resumeAt : null,
      usageLaneFailureCode: usageLane.configured ? usageLane.failure.code : null,
      usageLaneFailureImpact: usageLane.configured ? usageLane.failure.admissionImpact : 'allow',
      usageLaneAnalyticsSamples: usageLaneAnalytics.counters.samples,
      usageLaneRejectedAnalyticsSamples: usageLaneAnalytics.counters.rejectedSamples,
      usageLaneNextResumeAt: usageLaneAnalytics.resume.next?.at || null,
      pressurePct: Math.round(limits.pressure * 100),
      remainingWindowCapacity: limits.remaining,
      actionableErrorCount: outputErrors.length,
      sampleCount: analytics.counters.samples,
      peakPressurePct: analytics.gauges.peakPressurePct,
      consecutiveBlocked: analytics.streaks.consecutiveBlocked
    },
    analytics,
    usageLaneAnalytics,
    history,
    historySnapshot,
    timeline,
    reporting,
    preview,
    usageLaneResumeHandoff,
    acceptance,
    readiness,
    runtimeProfile,
    clientHandoff,
    workflowHandoffEnvelope,
    kernelRuntime,
    validationSummary,
    nextSteps,
    exportSummary,
    errors: outputErrors,
    evidence: [
      {
        type: 'usage-backoff-evaluation',
        generatedAt: now,
        mode,
        pressure: limits.pressure,
        retryDelayMs: backoff.delayMs,
        counters: analytics.counters
      },
      {
        type: 'usage-backoff-export-summary',
        generatedAt: now,
        schema: exportSummary.schema,
        status: exportSummary.status,
        admitted: exportSummary.admitted,
        pressurePct: exportSummary.quota.pressurePct,
        alertLevel: exportSummary.reporting.alertLevel,
        exportRowCount: exportSummary.reporting.exportRowCount,
        errorCodes: exportSummary.errorCodes
      },
      {
        type: 'usage-backoff-reporting-state',
        generatedAt: now,
        schema: reporting.schema,
        alertLevel: reporting.alert.level,
        latestMode: reporting.trend.latestMode,
        pressureDeltaPct: reporting.trend.pressureDeltaPct,
        transitionCount: reporting.trend.transitionCount,
        exportRows: reporting.exportRows.length
      },
      {
        type: 'usage-backoff-preview-contract',
        generatedAt: now,
        schema: preview.schema,
        decision: preview.decision,
        readinessLevel: preview.readinessLevel,
        recommendedActionId: nextSteps.recommendedActionId
      },
      {
        type: 'usage-backoff-usage-lane-resume-handoff',
        generatedAt: now,
        schema: usageLaneResumeHandoff.schema,
        state: usageLaneResumeHandoff.state,
        eligibleForResume: usageLaneResumeHandoff.eligibleForResume,
        command: usageLaneResumeHandoff.routeContract.command,
        resumeAt: usageLaneResumeHandoff.resume.at,
        retryAfterSeconds: usageLaneResumeHandoff.resume.retryAfterSeconds,
        continuationDeadlineAt: usageLaneResumeHandoff.continuation.deadlineAt,
        resumeWithinContinuation: usageLaneResumeHandoff.continuation.resumeWithinDeadline,
        continuationOverflowMs: usageLaneResumeHandoff.continuation.overflowMs,
        reasonCodes: usageLaneResumeHandoff.reasonCodes
      },
      {
        type: 'usage-backoff-client-handoff',
        generatedAt: now,
        schema: clientHandoff.schema,
        requestId: clientHandoff.requestId,
        handoffState: clientHandoff.handoffState,
        responseStatusCode: clientHandoff.responseHints.statusCode,
        resumeAt: clientHandoff.resume.at
      },
      {
        type: 'usage-backoff-workflow-handoff-envelope',
        generatedAt: now,
        schema: workflowHandoffEnvelope.schema,
        requestId: workflowHandoffEnvelope.requestId,
        delivery: workflowHandoffEnvelope.delivery,
        command: workflowHandoffEnvelope.command,
        responseStatusCode: workflowHandoffEnvelope.response.statusCode,
        persisted: workflowHandoffEnvelope.persistence.enabled,
        resumeCommandType: workflowHandoffEnvelope.resumeCommand?.type || null
      },
      {
        type: 'usage-backoff-kernel-runtime',
        generatedAt: now,
        schema: kernelRuntime.schema,
        command: kernelRuntime.integration.command,
        executionState: kernelRuntime.integration.executionState,
        targetQueue: kernelRuntime.integration.targetQueue,
        isolationKey: kernelRuntime.integration.isolationKey,
        leaseKey: kernelRuntime.lease.key,
        meteringReserveDelta: kernelRuntime.meteringPatch.reserveDelta,
        warningCodes: kernelRuntime.integrationWarnings.map((warning) => warning.code)
      },
      {
        type: 'usage-backoff-persisted-state',
        generatedAt: now,
        schema: persistedState.schema,
        key: persistedState.key,
        restartStatus: persistedState.restartStatus,
        commandEffect: persistedState.commandReceipt.effect,
        duplicateCommand: persistedState.commandReceipt.duplicate,
        nextGeneration: persistedState.nextPersistedState.generation,
        nextControlState: persistedState.nextPersistedState.controlState,
        stale: persistedState.stale
      },
      {
        type: 'usage-backoff-provider-contract',
        generatedAt: now,
        schema: providerContract.schema,
        providerId: providerContract.provider.id,
        serviceId: providerContract.service.id,
        ready: providerContract.ready,
        syncState: providerContract.sync.state,
        laneSyncState: providerContract.laneSync.state,
        laneSyncCursor: providerContract.laneSync.cursor,
        handoffState: providerContract.handoff.state,
        laneHandoffState: providerContract.handoff.laneState,
        laneResumeAt: providerContract.handoff.resumeAt,
        missingCapabilities: providerContract.negotiation.missingCapabilities
      },
      {
        type: 'usage-backoff-operational-health',
        generatedAt: now,
        schema: operationalHealth.schema,
        configured: operationalHealth.configured,
        status: operationalHealth.status,
        admissionImpact: operationalHealth.admissionImpact,
        dependencyState: operationalHealth.dependency.state,
        telemetryStale: operationalHealth.telemetry.stale,
        recentErrorCount: operationalHealth.errors.recentCount,
        activeIncidentCount: operationalHealth.incidents.length,
        retryAfterMs: operationalHealth.retryAfterMs,
        issueCodes: operationalHealth.issueCodes
      },
      {
        type: 'usage-backoff-usage-lane-analytics',
        generatedAt: now,
        schema: usageLaneAnalytics.schema,
        configured: usageLaneAnalytics.configured,
        laneId: usageLaneAnalytics.laneId,
        laneKind: usageLaneAnalytics.laneKind,
        sampleCount: usageLaneAnalytics.counters.samples,
        exhaustedCount: usageLaneAnalytics.counters.exhausted,
        rejectedSamples: usageLaneAnalytics.counters.rejectedSamples,
        peakPressurePct: usageLaneAnalytics.gauges.peakPressurePct,
        consecutiveExhausted: usageLaneAnalytics.gauges.consecutiveExhausted,
        nextResumeAt: usageLaneAnalytics.resume.next?.at || null,
        resumeEligible: usageLaneAnalytics.resume.eligibleForResume,
        exportRowCount: usageLaneAnalytics.exportRows.length,
        timelineEventCount: usageLaneAnalytics.timeline.length
      },
      {
        type: 'usage-backoff-usage-lane',
        generatedAt: now,
        schema: usageLane.schema,
        configured: usageLane.configured,
        laneId: usageLane.configured ? usageLane.id : null,
        kind: usageLane.configured ? usageLane.kind : null,
        pressurePct: usageLane.configured ? usageLane.pressurePct : null,
        remaining: usageLane.configured ? usageLane.remaining : null,
        exhausted: usageLane.configured ? usageLane.exhausted : false,
        resumeAt: usageLane.configured ? usageLane.resumeAt : null,
        resumeReason: usageLane.configured ? usageLane.resumeReason : 'none',
        failureCode: usageLane.configured ? usageLane.failure.code : null,
        failureImpact: usageLane.configured ? usageLane.failure.admissionImpact : 'allow',
        failureTerminal: usageLane.configured ? usageLane.failure.terminal : false,
        historySampleCount: usageLane.configured ? usageLane.history.sampleCount : 0,
        historyBackoff: usageLane.configured ? usageLane.history.enforcedBackoff : false,
        consecutiveExhausted: usageLane.configured ? usageLane.history.consecutiveExhausted : 0,
        admissionImpact: usageLane.admissionImpact
      },
      {
        type: 'usage-backoff-admission-cost',
        generatedAt: now,
        schema: admissionCost.schema,
        units: admissionCost.units,
        quotaUnits: admissionCost.quotaUnits,
        laneUnits: admissionCost.laneUnits,
        fits: admissionCost.fits,
        quotaFits: admissionCost.quotaFits,
        laneFits: admissionCost.laneFits,
        quotaRemainingAfterDecision: admissionCost.quotaRemainingAfterDecision,
        laneRemainingAfterDecision: admissionCost.laneRemainingAfterDecision,
        pressureAfterDecisionPct: admissionCost.pressureAfterDecisionPct,
        lanePressureAfterDecisionPct: admissionCost.lanePressureAfterDecisionPct,
        reservationKey: admissionCost.reservationKey
      },
      {
        type: 'usage-backoff-tenant-boundary',
        generatedAt: now,
        schema: tenantBoundary.schema,
        enforced: tenantBoundary.enforced,
        workspaceId: tenantBoundary.workspaceId,
        actorId: tenantBoundary.actor.id,
        isolationKey: tenantBoundary.isolationKey,
        checks: tenantBoundary.checks,
        missingPermissions: tenantBoundary.missingPermissions
      },
      {
        type: 'usage-backoff-workspace-boundary',
        generatedAt: now,
        schema: workspaceBoundary.schema,
        enforced: workspaceBoundary.enforced,
        workspaceId: workspaceBoundary.workspaceId,
        requestedWorkspaceId: workspaceBoundary.requestedWorkspaceId,
        handoffWorkspaceId: workspaceBoundary.handoffWorkspaceId,
        isolationKey: workspaceBoundary.isolationKey,
        stateStorePrefix: workspaceBoundary.stateStorePrefix,
        checks: workspaceBoundary.checks,
        requiredWorkspaceRoles: workspaceBoundary.requiredWorkspaceRoles
      },
      {
        type: 'usage-backoff-audit-proof',
        generatedAt: now,
        schema: kernelRuntime.auditProof.schema,
        subject: kernelRuntime.auditProof.subject,
        decision: kernelRuntime.auditProof.decision,
        command: kernelRuntime.auditProof.command,
        isolationKey: kernelRuntime.auditProof.isolationKey,
        workspaceIsolationKey: kernelRuntime.auditProof.workspaceIsolationKey,
        proofFields: kernelRuntime.auditProof.proofFields
      },
      ...(Array.isArray(input.evidence) ? input.evidence : [])
    ]
  };
}

export default describeUsageBackoffSurface;
