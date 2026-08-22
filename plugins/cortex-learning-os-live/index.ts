import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  TELEMETRY_SCHEMA,
  loadSignedRegistry,
  readRegistrySecret,
  renderLearningContext,
  selectLiveLessons,
} from './registry.mjs';
import {
  TRANSFER_TELEMETRY_SCHEMA,
  loadSignedTransferRegistry,
  readTransferRegistrySecret,
  renderTransferContext,
  selectQualifiedTransferEntries,
} from './transfer-registry.mjs';
import { routeMathTransfer } from './transfer.mjs';

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(asNumber(value, fallback))));
}

function latestUserTurnText(messages: unknown[]): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message: any = messages[index];
    if (!message || message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim();
    if (!Array.isArray(message.content)) return '';
    const text = message.content
      .map((part: any) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return text;
  }
  return '';
}

function isBypassedSession(sessionKey: string): boolean {
  const value = String(sessionKey || '').toLowerCase();
  return !value
    || value.includes(':cron:')
    || value.includes(':subagent:')
    || value.includes(':oracle:')
    || value.includes('math-foundations-')
    || value.includes('clos-');
}

function defaultTelemetry() {
  return {
    schemaVersion: TELEMETRY_SCHEMA,
    mode: 'content_free',
    updatedAt: null,
    counters: {
      observed: 0,
      eligible: 0,
      applied: 0,
      shadowSelected: 0,
      noMatch: 0,
      bypassed: 0,
      registryInvalid: 0,
    },
    records: [],
  };
}

function safeReadJson(filePath: string, fallback: any): any {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath: string, value: any): void {
  const target = path.resolve(filePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('learning OS telemetry path cannot be a symbolic link');
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  const descriptor = fs.openSync(temporary, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

function appendTelemetry(filePath: string, record: any, maximum: number): void {
  const state = safeReadJson(filePath, defaultTelemetry());
  if (state.schemaVersion !== TELEMETRY_SCHEMA) Object.assign(state, defaultTelemetry());
  state.mode = 'content_free';
  state.updatedAt = new Date().toISOString();
  state.counters = state.counters && typeof state.counters === 'object' ? state.counters : {};
  state.counters.observed = Number(state.counters.observed || 0) + 1;
  const outcome = String(record.outcome || 'noMatch');
  if (outcome === 'applied') state.counters.applied = Number(state.counters.applied || 0) + 1;
  else if (outcome === 'shadow_selected') state.counters.shadowSelected = Number(state.counters.shadowSelected || 0) + 1;
  else if (outcome === 'registry_invalid') state.counters.registryInvalid = Number(state.counters.registryInvalid || 0) + 1;
  else if (outcome === 'bypassed') state.counters.bypassed = Number(state.counters.bypassed || 0) + 1;
  else state.counters.noMatch = Number(state.counters.noMatch || 0) + 1;
  if (record.eligible) state.counters.eligible = Number(state.counters.eligible || 0) + 1;
  state.records = Array.isArray(state.records) ? state.records : [];
  state.records.push(record);
  state.records.splice(0, Math.max(0, state.records.length - maximum));
  atomicWriteJson(filePath, state);
}

function defaultTransferTelemetry() {
  return {
    schemaVersion: TRANSFER_TELEMETRY_SCHEMA,
    mode: 'content_free',
    updatedAt: null,
    counters: {
      observed: 0,
      applicable: 0,
      shadowSelected: 0,
      applied: 0,
      noMatch: 0,
      bypassed: 0,
      registryInvalid: 0,
      contextRejected: 0,
    },
    reasonCounts: {},
    records: [],
  };
}

function sanitizeCodeList(value: any, maximum = 32): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item: unknown) => typeof item === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(item as string))
    .slice(0, maximum))] as string[];
}

function sanitizeDigestList(value: any, maximum = 8): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item: unknown) => typeof item === 'string' && /^[0-9a-f]{64}$/.test(item as string))
    .slice(0, maximum))] as string[];
}

function sanitizeTransferRecord(value: any): any | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isFinite(Date.parse(String(value.recordedAt || '')))) return null;
  const outcome = ['applied', 'shadow_selected', 'registry_invalid', 'bypassed', 'context_rejected', 'no_match'].includes(value.outcome)
    ? value.outcome : 'no_match';
  const result: any = {
    recordedAt: value.recordedAt,
    transferMode: ['active', 'shadow'].includes(value.transferMode) ? value.transferMode : 'shadow',
    outcome,
    answerInfluence: value.answerInfluence === true && outcome === 'applied',
    applicable: value.applicable === true,
    reasonCodes: sanitizeCodeList(value.reasonCodes),
    profileIds: sanitizeCodeList(value.profileIds, 8),
    matcherIds: sanitizeCodeList(value.matcherIds, 8),
    observedAssumptionCodes: sanitizeCodeList(value.observedAssumptionCodes),
    negativeGateCodes: sanitizeCodeList(value.negativeGateCodes),
    evidenceDigests: sanitizeDigestList(value.evidenceDigests),
  };
  if (Number.isSafeInteger(value.transferRegistryRevision) && value.transferRegistryRevision >= 0) result.transferRegistryRevision = value.transferRegistryRevision;
  if (typeof value.transferRegistryKeyId === 'string' && /^[0-9a-f]{16}$/.test(value.transferRegistryKeyId)) result.transferRegistryKeyId = value.transferRegistryKeyId;
  return result;
}

function appendTransferTelemetry(filePath: string, record: any, maximum: number): void {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
        || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('transfer telemetry must be an owner-only regular file');
  }
  const loaded: any = safeReadJson(filePath, defaultTransferTelemetry());
  const state: any = defaultTransferTelemetry();
  state.mode = 'content_free';
  state.updatedAt = new Date().toISOString();
  if (loaded.schemaVersion === TRANSFER_TELEMETRY_SCHEMA && loaded.counters && typeof loaded.counters === 'object') {
    for (const key of Object.keys(state.counters)) {
      const count = Number(loaded.counters[key]);
      if (Number.isSafeInteger(count) && count >= 0) state.counters[key] = count;
    }
  }
  state.counters.observed = Number(state.counters.observed || 0) + 1;
  const outcome = String(record.outcome || 'no_match');
  const counter = {
    applied: 'applied',
    shadow_selected: 'shadowSelected',
    registry_invalid: 'registryInvalid',
    bypassed: 'bypassed',
    context_rejected: 'contextRejected',
  }[outcome] || 'noMatch';
  state.counters[counter] = Number(state.counters[counter] || 0) + 1;
  if (record.applicable) state.counters.applicable = Number(state.counters.applicable || 0) + 1;
  if (loaded.schemaVersion === TRANSFER_TELEMETRY_SCHEMA && loaded.reasonCounts && typeof loaded.reasonCounts === 'object' && !Array.isArray(loaded.reasonCounts)) {
    for (const [reason, countValue] of Object.entries(loaded.reasonCounts).slice(0, 64)) {
      const count = Number(countValue);
      if (/^[a-z0-9][a-z0-9._-]{0,127}$/.test(reason) && Number.isSafeInteger(count) && count >= 0) state.reasonCounts[reason] = count;
    }
  }
  const sanitized = sanitizeTransferRecord(record);
  if (!sanitized) throw new Error('invalid content-free transfer telemetry record');
  for (const reason of sanitized.reasonCodes) {
    if (/^[a-z0-9][a-z0-9._-]{0,127}$/.test(reason)) state.reasonCounts[reason] = Number(state.reasonCounts[reason] || 0) + 1;
  }
  state.records = loaded.schemaVersion === TRANSFER_TELEMETRY_SCHEMA && Array.isArray(loaded.records)
    ? loaded.records.map(sanitizeTransferRecord).filter(Boolean).slice(-maximum)
    : [];
  state.records.push(sanitized);
  state.records.splice(0, Math.max(0, state.records.length - maximum));
  atomicWriteJson(filePath, state);
}

export default function register(api: any) {
  const cfg = api.pluginConfig || api.config || {};
  if (!asBool(cfg.enabled, true)) return;

  const mode = typeof cfg.mode === 'string' ? cfg.mode : 'active';
  if (!['active', 'shadow'].includes(mode)) throw new Error('cortex-learning-os-live mode must be active or shadow');
  const killSwitch = asBool(cfg.killSwitch, false);
  const registryPath = typeof cfg.registryPath === 'string' && cfg.registryPath.trim()
    ? path.resolve(cfg.registryPath)
    : path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-learning-os', 'live-registry.json');
  const registryHmacSecretPath = typeof cfg.registryHmacSecretPath === 'string' && cfg.registryHmacSecretPath.trim()
    ? path.resolve(cfg.registryHmacSecretPath)
    : path.join(path.dirname(registryPath), 'registry.hmac');
  const telemetryPath = typeof cfg.telemetryPath === 'string' && cfg.telemetryPath.trim()
    ? path.resolve(cfg.telemetryPath)
    : path.join(path.dirname(registryPath), 'telemetry.json');
  const maxLessons = boundedNumber(cfg.maxLessons, 3, 1, 8);
  const maxContextChars = boundedNumber(cfg.maxContextChars, 3_000, 512, 8_000);
  const telemetryMaxRecords = boundedNumber(cfg.telemetryMaxRecords, 1_000, 10, 10_000);
  const transferEnabled = asBool(cfg.transferEnabled, true);
  const transferMode = typeof cfg.transferMode === 'string' ? cfg.transferMode : 'active';
  if (!['active', 'shadow'].includes(transferMode)) throw new Error('cortex-learning-os-live transferMode must be active or shadow');
  const transferKillSwitch = asBool(cfg.transferKillSwitch, false);
  const transferRegistryPath = typeof cfg.transferRegistryPath === 'string' && cfg.transferRegistryPath.trim()
    ? path.resolve(cfg.transferRegistryPath)
    : path.join(path.dirname(registryPath), 'transfer-registry.json');
  const transferRegistryHmacSecretPath = typeof cfg.transferRegistryHmacSecretPath === 'string' && cfg.transferRegistryHmacSecretPath.trim()
    ? path.resolve(cfg.transferRegistryHmacSecretPath)
    : path.join(path.dirname(transferRegistryPath), 'transfer-registry.hmac');
  const transferTelemetryPath = typeof cfg.transferTelemetryPath === 'string' && cfg.transferTelemetryPath.trim()
    ? path.resolve(cfg.transferTelemetryPath)
    : path.join(path.dirname(transferRegistryPath), 'transfer-telemetry.json');
  const transferTelemetryMaxRecords = boundedNumber(cfg.transferTelemetryMaxRecords, 1_000, 10, 10_000);
  const transferMaxContextChars = boundedNumber(cfg.transferMaxContextChars, 8_000, 1_024, 12_000);
  const allowedAgentIds = new Set(
    (Array.isArray(cfg.allowedAgentIds) ? cfg.allowedAgentIds : ['main'])
      .filter((value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value as string))
      .map((value: string) => value.trim()),
  );
  if (allowedAgentIds.size < 1) throw new Error('cortex-learning-os-live requires at least one allowedAgentId');

  // Capture the key once. Runtime mutation of caller-owned configuration or the
  // key path cannot silently change the trust root without a gateway restart.
  const registrySecret = readRegistrySecret(registryHmacSecretPath);
  let warnedRegistryError = false;
  let transferRegistrySecret: string | null = null;
  let transferTrustError: string | null = null;
  if (transferEnabled) {
    try {
      transferRegistrySecret = readTransferRegistrySecret(transferRegistryHmacSecretPath);
    } catch (error) {
      transferTrustError = String(error);
    }
  }
  let warnedTransferRegistryError = false;

  const lessonHandler = async (event: any, ctx: any) => {
    const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const agentId = String(ctx?.agentId || '').trim();
    const principalTag = crypto.createHmac('sha256', registrySecret)
      .update(`${agentId}\n${sessionKey}`, 'utf8')
      .digest('hex')
      .slice(0, 24);
    const recordedAt = new Date().toISOString();
    const baseRecord: any = {
      recordedAt,
      principalTag,
      mode,
      answerInfluence: false,
      eligible: false,
      profiles: [],
      selectedLessonIds: [],
    };

    if (killSwitch || !allowedAgentIds.has(agentId) || isBypassedSession(sessionKey)) {
      try { appendTelemetry(telemetryPath, { ...baseRecord, outcome: 'bypassed', reason: killSwitch ? 'kill_switch' : 'scope_bypass' }, telemetryMaxRecords); } catch {}
      return;
    }

    const structuredUserTurn = latestUserTurnText(Array.isArray(event?.messages) ? event.messages : []);
    const promptFallback = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
    const query = structuredUserTurn || promptFallback;
    const querySource = structuredUserTurn ? 'structured_user_turn' : promptFallback ? 'prompt_fallback' : 'none';
    if (!query || query.length > 16_384) {
      try { appendTelemetry(telemetryPath, { ...baseRecord, outcome: 'no_match', reason: query ? 'query_too_large' : 'no_user_turn', querySource }, telemetryMaxRecords); } catch {}
      return;
    }

    let registry;
    try {
      registry = loadSignedRegistry(registryPath, registrySecret, { allowExpiredLessons: true });
      warnedRegistryError = false;
    } catch (error) {
      if (!warnedRegistryError) {
        api.logger.warn?.(`cortex-learning-os-live: registry rejected; answer path remains unchanged: ${String(error)}`);
        warnedRegistryError = true;
      }
      try { appendTelemetry(telemetryPath, { ...baseRecord, outcome: 'registry_invalid', reason: 'verification_failed' }, telemetryMaxRecords); } catch {}
      return;
    }

    const selection = selectLiveLessons(registry, query, { maxLessons });
    const selectionRecord = {
      ...baseRecord,
      eligible: selection.eligible,
      profiles: selection.profiles,
      selectedLessonIds: selection.lessons.map((lesson: any) => lesson.lessonId),
      registryRevision: registry.revision,
      registryKeyId: registry.signature.keyId,
      querySource,
    };
    if (!selection.lessons.length) {
      try { appendTelemetry(telemetryPath, { ...selectionRecord, outcome: 'no_match', reason: selection.eligible ? 'no_active_matching_lesson' : 'not_math_profile' }, telemetryMaxRecords); } catch {}
      return;
    }

    if (mode === 'shadow') {
      try { appendTelemetry(telemetryPath, { ...selectionRecord, outcome: 'shadow_selected', reason: 'shadow_mode' }, telemetryMaxRecords); } catch {}
      return;
    }

    const context = renderLearningContext(selection, { maxChars: maxContextChars });
    if (!context) {
      try { appendTelemetry(telemetryPath, { ...selectionRecord, outcome: 'no_match', reason: 'context_bound_exceeded' }, telemetryMaxRecords); } catch {}
      return;
    }
    try {
      appendTelemetry(telemetryPath, { ...selectionRecord, outcome: 'applied', reason: 'verified_scoped_lesson', answerInfluence: true }, telemetryMaxRecords);
    } catch (error) {
      // Telemetry failure must not expose lesson content or break an otherwise
      // valid answer. Registry verification remains the trust boundary.
      api.logger.warn?.(`cortex-learning-os-live: content-free telemetry write failed: ${String(error)}`);
    }
    api.logger.info?.(`cortex-learning-os-live: applied ${selection.lessons.length} verified lesson(s) principal=${principalTag} profiles=${selection.profiles.join(',')}`);
    return { appendSystemContext: context };
  };

  const transferHandler = async (event: any, ctx: any) => {
    if (!transferEnabled) return;
    const recordedAt = new Date().toISOString();
    const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const agentId = String(ctx?.agentId || '').trim();
    const baseRecord: any = {
      recordedAt,
      transferMode,
      answerInfluence: false,
      applicable: false,
      reasonCodes: [],
      profileIds: [],
      matcherIds: [],
      observedAssumptionCodes: [],
      negativeGateCodes: [],
      evidenceDigests: [],
    };
    if (transferKillSwitch || !allowedAgentIds.has(agentId) || isBypassedSession(sessionKey)) {
      const reason = transferKillSwitch ? 'transfer-kill-switch' : 'transfer-scope-bypass';
      try { appendTransferTelemetry(transferTelemetryPath, { ...baseRecord, outcome: 'bypassed', reasonCodes: [reason] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    const structuredUserTurn = latestUserTurnText(Array.isArray(event?.messages) ? event.messages : []);
    const promptFallback = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
    const query = structuredUserTurn || promptFallback;
    if (!query || query.length > 16_384) {
      const reason = query ? 'query-too-large' : 'no-user-turn';
      try { appendTransferTelemetry(transferTelemetryPath, { ...baseRecord, outcome: 'no_match', reasonCodes: [reason] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    const route = routeMathTransfer(query, { selectionMode: transferMode, maxSelections: 3 });
    const evaluated = route.selections;
    const routeRecord = {
      ...baseRecord,
      applicable: route.applicable,
      reasonCodes: route.reasonCodes,
      profileIds: evaluated.map((row: any) => row.profileId),
      matcherIds: evaluated.map((row: any) => row.matcherId),
      observedAssumptionCodes: [...new Set(evaluated.flatMap((row: any) => row.observedAssumptionCodes))],
      negativeGateCodes: [...new Set(evaluated.flatMap((row: any) => row.negativeGateCodes))],
    };
    if (!route.applicable) {
      try { appendTransferTelemetry(transferTelemetryPath, { ...routeRecord, outcome: 'no_match' }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    if (!transferRegistrySecret) {
      if (!warnedTransferRegistryError) {
        api.logger.warn?.(`cortex-learning-os-live: transfer registry rejected independently; lesson path remains available: ${transferTrustError}`);
        warnedTransferRegistryError = true;
      }
      try { appendTransferTelemetry(transferTelemetryPath, { ...routeRecord, outcome: 'registry_invalid', reasonCodes: [...route.reasonCodes, 'transfer-trust-root-unavailable'] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    let transferRegistry;
    try {
      transferRegistry = loadSignedTransferRegistry(transferRegistryPath, transferRegistrySecret, { allowExpiredEntries: true });
      warnedTransferRegistryError = false;
    } catch (error) {
      if (!warnedTransferRegistryError) {
        api.logger.warn?.(`cortex-learning-os-live: transfer registry rejected independently; lesson path remains available: ${String(error)}`);
        warnedTransferRegistryError = true;
      }
      try { appendTransferTelemetry(transferTelemetryPath, { ...routeRecord, outcome: 'registry_invalid', reasonCodes: [...route.reasonCodes, 'transfer-registry-verification-failed'] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    const qualifiedEntries = selectQualifiedTransferEntries(transferRegistry, route, { agentId });
    const registryRecord = {
      ...routeRecord,
      transferRegistryRevision: transferRegistry.revision,
      transferRegistryKeyId: transferRegistry.signature.keyId,
      evidenceDigests: qualifiedEntries.map((entry: any) => entry.evidenceDigest),
    };
    if (transferMode === 'shadow') {
      try { appendTransferTelemetry(transferTelemetryPath, { ...registryRecord, outcome: 'shadow_selected', reasonCodes: [...route.reasonCodes, 'shadow-zero-answer-influence'] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    if (!qualifiedEntries.length) {
      try { appendTransferTelemetry(transferTelemetryPath, { ...registryRecord, outcome: 'no_match', reasonCodes: [...route.reasonCodes, 'no-active-qualified-entry'] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    const context = renderTransferContext(qualifiedEntries, route, { maxChars: transferMaxContextChars });
    if (!context) {
      try { appendTransferTelemetry(transferTelemetryPath, { ...registryRecord, outcome: 'context_rejected', reasonCodes: [...route.reasonCodes, 'transfer-context-bound-exceeded'] }, transferTelemetryMaxRecords); } catch {}
      return;
    }
    try {
      appendTransferTelemetry(transferTelemetryPath, {
        ...registryRecord,
        outcome: 'applied',
        reasonCodes: [...route.reasonCodes, 'active-signed-transfer-applied'],
        answerInfluence: true,
      }, transferTelemetryMaxRecords);
    } catch (error) {
      api.logger.warn?.(`cortex-learning-os-live: content-free transfer telemetry write failed: ${String(error)}`);
    }
    return { appendSystemContext: context };
  };

  api.on('before_prompt_build', async (event: any, ctx: any) => {
    let lessonResult;
    let transferResult;
    lessonResult = await lessonHandler(event, ctx);
    try {
      transferResult = await transferHandler(event, ctx);
    } catch (error) {
      api.logger.warn?.(`cortex-learning-os-live: transfer path failed closed independently: ${String(error)}`);
    }
    const contexts = [lessonResult?.appendSystemContext, transferResult?.appendSystemContext].filter(Boolean);
    return contexts.length ? { appendSystemContext: contexts.join('\n\n') } : undefined;
  });
}
