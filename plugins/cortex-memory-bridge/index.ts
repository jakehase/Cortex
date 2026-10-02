import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/memory-core';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertOwnerBoundFallbackIdentity, captureTrustedPrincipalContext, deriveCortexPrincipal, deriveCortexKnowledgePrincipal } from '../cortex-principal-identity.mjs';

type BridgeConfig = {
  baseUrl?: string;
  searchPath?: string;
  storePath?: string;
  assurancePath?: string;
  codecEventsPath?: string;
  timeoutMs?: number;
  retryCount?: number;
  retryBackoffMs?: number;
  enabledWriteThrough?: boolean;
  enabledCodecContinuity?: boolean;
  curatedBoost?: number;
  projectFactBoost?: number;
  durableCandidatePenalty?: number;
  noisyWhatsappPenalty?: number;
  noisyPatternPenalty?: number;
  minDurabilityScore?: number;
  writeTags?: string[];
  conflictPenalty?: number;
  recencyBoost?: number;
  explicitBoost?: number;
  corroborationBoost?: number;
  hardQueryCandidateCount?: number;
  maxResponseBytes?: number;
  lifecycleMaxInFlight?: number;
  lifecycleMaxPending?: number;
  lifecycleSpoolMaxRecords?: number;
  lifecycleReplayInitialDelayMs?: number;
  lifecycleReplayRetryMs?: number;
  lifecycleReplaySuccessDelayMs?: number;
  recentOutputMaxChars?: number;
  stateDir?: string;
  writeToken?: string;
  writeTokenHeader?: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  userId?: string;
  channelId?: string;
  sessionId?: string;
  scopeCredentialId?: string;
  scopeHmacSecret?: string;
  ownerSenderId?: string;
  allowUnsignedLocalDevelopment?: boolean;
  sessionIdentityHmacSecret?: string;
  lifecycleEncryptionKey?: string;
};

type TrustedPrincipalContext = {
  sessionKey: string;
  userId: string;
  senderId?: string;
  senderConflict?: boolean;
  channelId: string;
  agentId: string;
};

type MemoryCandidate = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: 'memory';
  citation?: string;
  metadata: Record<string, unknown>;
};

type QueryMode = 'fast' | 'reconcile' | 'investigate';
type CandidateSignals = {
  rawScore: number;
  recencyScore: number;
  explicitnessScore: number;
  sourceQualityScore: number;
  corroborationScore: number;
  lexicalOverlapScore: number;
  contradictionPenalty: number;
  supersededPenalty: number;
  reasons: string[];
  entity?: string;
  attribute?: string;
  valueSignature?: string;
};

type ReconcileResult = {
  mode: QueryMode;
  queryType: string[];
  results: MemoryCandidate[];
  resolvedFacts: Array<{ entity?: string; attribute?: string; bestPath: string; supportingPaths: string[] }>;
  conflicts: Array<{ entity?: string; attribute?: string; paths: string[]; values: string[] }>;
};

const LIFECYCLE_DEDUP_MAX_ENTRIES = 4096;
const LIFECYCLE_DEDUP_TTL_MS = 10 * 60 * 1000;
const LIFECYCLE_MAX_IN_FLIGHT = 2;
const LIFECYCLE_MAX_PENDING = 8;
const LIFECYCLE_SPOOL_MAX_RECORDS = 4096;
const LIFECYCLE_SPOOL_MAX_RECORD_BYTES = 256 * 1024;
const LIFECYCLE_NAMESPACE_INODE_BUDGET = 8;
const LIFECYCLE_ROOT_INODE_RESERVE = 16;
const LIFECYCLE_REPLAY_INITIAL_DELAY_MS = 30_000;
const LIFECYCLE_REPLAY_RETRY_MS = 60_000;
const LIFECYCLE_REPLAY_SUCCESS_DELAY_MS = 1_000;
const RECENT_OUTPUT_MAX_ENTRIES = 1024;
const RECENT_OUTPUT_TTL_MS = 10 * 60 * 1000;
const RECENT_OUTPUT_MAX_CHARS = 4096;

function lifecyclePersistenceKey(session: string, payload: string): string {
  const sessionBytes = Buffer.from(session, 'utf8');
  const payloadBytes = Buffer.from(payload, 'utf8');
  const encodedLength = (length: number) => {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigUInt64BE(BigInt(length));
    return buffer;
  };
  const digest = createHash('sha256')
    .update(encodedLength(sessionBytes.length))
    .update(sessionBytes)
    .update(encodedLength(payloadBytes.length))
    .update(payloadBytes)
    .digest('hex');
  return `${session}:${digest}`;
}

function lifecycleIdentity(event: any, ctx: any): string | undefined {
  for (const field of ['runId', 'run_id', 'completionId', 'completion_id']) {
    for (const source of [ctx, event]) {
      const value = source?.[field];
      if (typeof value === 'string' && value.trim()) {
        const digest = createHash('sha256').update(value.trim(), 'utf8').digest('hex');
        return `${field.replace('_', '').toLowerCase()}:${digest}`;
      }
    }
  }
  return undefined;
}

class ExpiringLruMap<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('ExpiringLruMap requires positive integer bounds');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): T | undefined {
    this.pruneExpired(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.pruneExpired(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: string): boolean { return this.entries.delete(key); }

  deletePrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (this.entries.delete(key)) deleted += 1;
    }
    return deleted;
  }

  clear(): void { this.entries.clear(); }

  get size(): number { return this.entries.size; }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

class ExpiringLruSet {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('ExpiringLruSet requires positive integer bounds');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  has(key: string, now = Date.now()): boolean {
    this.pruneExpired(now);
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    // Reinsert to make successful lookups the most-recently-used entries.
    this.entries.delete(key);
    this.entries.set(key, expiresAt);
    return true;
  }

  add(key: string, now = Date.now()): void {
    this.pruneExpired(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, now + this.ttlMs);
  }

  deletePrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (this.entries.delete(key)) deleted += 1;
    }
    return deleted;
  }

  clear(): void { this.entries.clear(); }

  private pruneExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

type LifecycleSealedPayload = {
  version: 1;
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  authTag: string;
  payloadSha256: string;
  aadSha256: string;
};

type LifecycleSealedReceipt = {
  version: 1;
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  authTag: string;
  receiptSha256: string;
  aadSha256: string;
};

type LifecycleSpoolRecord = {
  version: 2 | 3 | 4;
  key: string;
  createdAt: string;
  principal: LifecyclePrincipal;
  event: { result: string; messages: Array<{ role: 'user'; content: string }> };
  context: {
    sessionKey: string;
    sessionId: string;
    channelId: string;
    agentId: string;
    userId: string;
    senderId?: string;
    idempotencyKey: string;
  };
  fallbackText: string;
  assuranceReceipt?: string;
  sealedPayload?: LifecycleSealedPayload;
  sealedReceipt?: LifecycleSealedReceipt;
};

type LifecyclePrincipal = {
  version: 1;
  tenant_id: string;
  workspace_id: string;
  scope_credential_id: string;
  agent_id: string;
  user_id: string;
  channel_id: string;
  session_id: string;
};

type LifecycleWriterStatus = 'not_attempted' | 'disabled' | 'skipped' | 'succeeded' | 'failed';
type LifecyclePersistenceOutcome = {
  ok: boolean;
  status: 'persisted' | 'skipped' | 'already_persisted' | 'pending_retry' | 'disabled';
  retainedForRetry: boolean;
  writeThrough: LifecycleWriterStatus;
  codecContinuity: LifecycleWriterStatus;
  persistenceKeyHash: string;
  failure?: { type: string; code?: string; status?: number; detailHash: string };
};

const LIFECYCLE_PRINCIPAL_FIELDS: Array<keyof Omit<LifecyclePrincipal, 'version'>> = [
  'tenant_id',
  'workspace_id',
  'scope_credential_id',
  'agent_id',
  'user_id',
  'channel_id',
  'session_id',
];

function isLifecyclePrincipal(value: unknown): value is LifecyclePrincipal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const principal = value as Record<string, unknown>;
  return principal.version === 1
    && LIFECYCLE_PRINCIPAL_FIELDS.every((field) => {
      const entry = principal[field];
      return typeof entry === 'string' && entry.length > 0 && entry.length <= 2048;
    });
}

function isLifecycleSpoolRecord(value: unknown): value is LifecycleSpoolRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, any>;
  const event = record.event;
  const context = record.context;
  const sealed = record.sealedPayload;
  const sealedReceipt = record.sealedReceipt;
  const payloadMetadata = record.version === 4
    ? parseLifecyclePayloadMetadata(record as LifecycleSpoolRecord)
    : null;
  const sealedValid = record.version !== 4 || (
    sealed && typeof sealed === 'object'
    && sealed.version === 1 && sealed.algorithm === 'aes-256-gcm'
    && ['nonce', 'ciphertext', 'authTag', 'payloadSha256', 'aadSha256']
      .every((field) => typeof sealed[field] === 'string' && sealed[field].length > 0 && sealed[field].length <= 350_000)
    && /^[0-9a-f]{64}$/.test(sealed.payloadSha256)
    && /^[0-9a-f]{64}$/.test(sealed.aadSha256)
    && /^[A-Za-z0-9+/]{16}$/.test(sealed.nonce)
    && /^[A-Za-z0-9+/]{22}==$/.test(sealed.authTag)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(sealed.ciphertext)
  );
  const sealedReceiptValid = sealedReceipt === undefined || (
    record.version === 4
    && sealedReceipt && typeof sealedReceipt === 'object'
    && sealedReceipt.version === 1 && sealedReceipt.algorithm === 'aes-256-gcm'
    && ['nonce', 'ciphertext', 'authTag', 'receiptSha256', 'aadSha256']
      .every((field) => typeof sealedReceipt[field] === 'string'
        && sealedReceipt[field].length > 0 && sealedReceipt[field].length <= 64_000)
    && /^[0-9a-f]{64}$/.test(sealedReceipt.receiptSha256)
    && /^[0-9a-f]{64}$/.test(sealedReceipt.aadSha256)
    && /^[A-Za-z0-9+/]{16}$/.test(sealedReceipt.nonce)
    && /^[A-Za-z0-9+/]{22}==$/.test(sealedReceipt.authTag)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(sealedReceipt.ciphertext)
  );
  const sealedMetadataValid = record.version !== 4 || Boolean(
    payloadMetadata
    && setEquals(Object.keys(payloadMetadata), [
      'schemaVersion', 'result', 'user', 'userMessageCount',
      'fallback', 'replayEncrypted', 'payloadSha256',
    ])
    && payloadMetadata.replayEncrypted === true
    && payloadMetadata.payloadSha256 === sealed?.payloadSha256
    && Number.isInteger(payloadMetadata.userMessageCount)
    && Number(payloadMetadata.userMessageCount) >= 0
    && Number(payloadMetadata.userMessageCount) <= 1
    && isLifecycleContentMetadata(payloadMetadata.result, 65_536)
    && isLifecycleContentMetadata(payloadMetadata.user, 2_000)
    && isLifecycleContentMetadata(payloadMetadata.fallback, 65_536)
    && Array.isArray(record.event?.messages) && record.event.messages.length === 0
    && record.fallbackText === ''
  );
  return [2, 3, 4].includes(Number(record.version))
    && typeof record.key === 'string' && record.key.length > 0 && record.key.length <= 2048
    && typeof record.createdAt === 'string' && record.createdAt.length > 0
    && record.createdAt.length <= 64 && Number.isFinite(Date.parse(record.createdAt))
    && isLifecyclePrincipal(record.principal)
    && typeof record.fallbackText === 'string' && record.fallbackText.length <= 65_536
    && event && typeof event === 'object' && typeof event.result === 'string' && event.result.length <= 65_536
    && Array.isArray(event.messages) && event.messages.length <= 1
    && event.messages.every((message: any) => message?.role === 'user' && typeof message.content === 'string' && message.content.length <= 2000)
    && context && typeof context === 'object'
    && ['sessionKey', 'sessionId', 'channelId', 'agentId', 'userId', 'idempotencyKey']
      .every((field) => typeof context[field] === 'string'
        && context[field].length <= 2048
        && (record.version !== 4 || context[field].length > 0))
    && (record.assuranceReceipt === undefined
      || (typeof record.assuranceReceipt === 'string' && record.assuranceReceipt.length > 0 && record.assuranceReceipt.length <= 16_384))
    && (record.version !== 4 || record.assuranceReceipt === undefined)
    && sealedValid
    && sealedReceiptValid
    && sealedMetadataValid;
}

const LIFECYCLE_PAYLOAD_METADATA_VERSION = 'cortex.lifecycle-payload-metadata.v1';

function lifecycleContentMetadata(value: string): { bytes: number; sha256: string } {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function truncateUtf8Tail(value: unknown, maxBytes: number): string {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  if (bytes.length <= maxBytes) return bytes.toString('utf8');
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString('utf8');
}

function setEquals(values: string[], expected: string[]): boolean {
  return values.length === expected.length
    && values.every((value) => expected.includes(value));
}

function isLifecycleContentMetadata(value: unknown, maxBytes: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return setEquals(Object.keys(metadata), ['bytes', 'sha256'])
    && Number.isInteger(metadata.bytes)
    && Number(metadata.bytes) >= 0
    && Number(metadata.bytes) <= maxBytes
    && typeof metadata.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(metadata.sha256);
}

function parseLifecyclePayloadMetadata(record: LifecycleSpoolRecord): Record<string, unknown> | null {
  try {
    const value = JSON.parse(record.event.result);
    return value && typeof value === 'object' && !Array.isArray(value)
      && value.schemaVersion === LIFECYCLE_PAYLOAD_METADATA_VERSION ? value : null;
  } catch { return null; }
}

function sanitizeLifecycleSpoolRecord(record: LifecycleSpoolRecord): LifecycleSpoolRecord {
  if (record.version === 4 && record.sealedPayload) {
    const sealedRecord = { ...record };
    delete sealedRecord.assuranceReceipt;
    return {
      ...sealedRecord,
      version: 4,
      event: { result: record.event.result, messages: [] },
      context: {
        sessionKey: record.principal.session_id,
        sessionId: record.principal.session_id,
        channelId: record.principal.channel_id,
        agentId: record.principal.agent_id,
        userId: record.principal.user_id,
        idempotencyKey: record.key,
      },
      fallbackText: '',
    };
  }
  if (parseLifecyclePayloadMetadata(record)) {
    return {
      ...record,
      version: 3,
      event: { result: record.event.result, messages: [] },
      context: {
        sessionKey: record.principal.session_id,
        sessionId: record.principal.session_id,
        channelId: record.principal.channel_id,
        agentId: record.principal.agent_id,
        userId: record.principal.user_id,
        idempotencyKey: record.key,
      },
      fallbackText: '',
    };
  }
  const userMessages = record.event.messages.map((message) => message.content);
  const userText = userMessages.join('\n');
  const metadata = {
    schemaVersion: LIFECYCLE_PAYLOAD_METADATA_VERSION,
    result: lifecycleContentMetadata(record.event.result),
    user: lifecycleContentMetadata(userText),
    userMessageCount: userMessages.length,
    fallback: lifecycleContentMetadata(record.fallbackText),
    replayRequiresTrustedCallback: true,
  };
  return {
    ...record,
    version: 3,
    event: { result: JSON.stringify(metadata), messages: [] },
    context: {
      sessionKey: record.principal.session_id,
      sessionId: record.principal.session_id,
      channelId: record.principal.channel_id,
      agentId: record.principal.agent_id,
      userId: record.principal.user_id,
      idempotencyKey: record.key,
    },
    fallbackText: '',
  };
}

type LifecycleReplayPayload = {
  version: 1;
  event: {
    result: string;
    messages: Array<{
      role: 'user';
      content: string;
      provenance?: { kind: 'ineligible-direct-memory-source' };
    }>;
  };
  fallbackText: string;
};

function lifecycleEncryptionSecret(cfg: BridgeConfig): Buffer {
  const dedicated = String(cfg.lifecycleEncryptionKey || '');
  for (const [label, candidate] of [
    ['lifecycleEncryptionKey', dedicated],
    ['sessionIdentityHmacSecret', cfg.sessionIdentityHmacSecret],
    ['scopeHmacSecret', cfg.scopeHmacSecret],
  ] as const) {
    const value = String(candidate || '');
    if (!value.trim()) continue;
    if (Buffer.byteLength(value, 'utf8') < 32) {
      throw new Error(`${label} must contain at least 32 bytes for lifecycle encryption`);
    }
    return Buffer.from(value, 'utf8');
  }
  throw new Error('lifecycle replay requires a provisioned encryption secret');
}

function lifecycleEncryptionKey(cfg: BridgeConfig, principalNamespace: string): Buffer {
  return createHmac('sha256', lifecycleEncryptionSecret(cfg))
    .update(`cortex.lifecycle.outbox.aes256gcm.v1\0${principalNamespace}`, 'utf8')
    .digest();
}

function lifecyclePayloadAad(
  record: Pick<LifecycleSpoolRecord, 'key' | 'createdAt' | 'principal'>,
  principalNamespace: string,
  payloadSha256: string,
): Buffer {
  return Buffer.from(JSON.stringify([
    'cortex.lifecycle.outbox.aad.v1',
    principalNamespace,
    record.key,
    record.createdAt,
    record.principal,
    payloadSha256,
  ]), 'utf8');
}

function lifecycleReplayPayloadBytes(payload: LifecycleReplayPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function lifecycleReplayPayloadHash(payload: LifecycleReplayPayload): string {
  return createHash('sha256').update(lifecycleReplayPayloadBytes(payload)).digest('hex');
}

function sealLifecyclePayload(
  cfg: BridgeConfig,
  principalNamespace: string,
  record: Pick<LifecycleSpoolRecord, 'key' | 'createdAt' | 'principal'>,
  payload: LifecycleReplayPayload,
): LifecycleSealedPayload {
  const plaintext = lifecycleReplayPayloadBytes(payload);
  if (plaintext.length > LIFECYCLE_SPOOL_MAX_RECORD_BYTES - 16_384) {
    throw new Error('lifecycle replay payload exceeds its encrypted spool bound');
  }
  const payloadSha256 = createHash('sha256').update(plaintext).digest('hex');
  const aad = lifecyclePayloadAad(record, principalNamespace, payloadSha256);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', lifecycleEncryptionKey(cfg, principalNamespace), nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    payloadSha256,
    aadSha256: createHash('sha256').update(aad).digest('hex'),
  };
}

function unsealLifecyclePayload(
  cfg: BridgeConfig,
  principalNamespace: string,
  record: LifecycleSpoolRecord,
): LifecycleReplayPayload {
  const sealed = record.sealedPayload;
  if (record.version !== 4 || !sealed) throw new Error('lifecycle record has no replayable encrypted payload');
  const aad = lifecyclePayloadAad(record, principalNamespace, sealed.payloadSha256);
  const aadHash = createHash('sha256').update(aad).digest();
  const expectedAadHash = Buffer.from(sealed.aadSha256, 'hex');
  if (expectedAadHash.length !== aadHash.length || !timingSafeEqual(expectedAadHash, aadHash)) {
    throw new Error('lifecycle encrypted payload AAD binding is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    lifecycleEncryptionKey(cfg, principalNamespace),
    Buffer.from(sealed.nonce, 'base64'),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const payloadHash = createHash('sha256').update(plaintext).digest();
  const expectedPayloadHash = Buffer.from(sealed.payloadSha256, 'hex');
  if (expectedPayloadHash.length !== payloadHash.length || !timingSafeEqual(expectedPayloadHash, payloadHash)) {
    throw new Error('lifecycle encrypted payload hash is invalid');
  }
  const parsed = JSON.parse(plaintext.toString('utf8')) as LifecycleReplayPayload;
  if (!parsed || !setEquals(Object.keys(parsed), ['version', 'event', 'fallbackText'])
    || parsed.version !== 1 || !parsed.event
    || !setEquals(Object.keys(parsed.event), ['result', 'messages'])
    || typeof parsed.event.result !== 'string'
    || Buffer.byteLength(parsed.event.result, 'utf8') > 65_536 || !Array.isArray(parsed.event.messages)
    || parsed.event.messages.length > 1
    || !parsed.event.messages.every((message) => message?.role === 'user'
      && typeof message.content === 'string'
      && Buffer.byteLength(message.content, 'utf8') <= 2000
      && setEquals(
        Object.keys(message),
        message.provenance === undefined
          ? ['role', 'content']
          : ['role', 'content', 'provenance'],
      )
      && (message.provenance === undefined
        || (message.provenance?.kind === 'ineligible-direct-memory-source'
          && setEquals(Object.keys(message.provenance), ['kind']))))
    || typeof parsed.fallbackText !== 'string'
    || Buffer.byteLength(parsed.fallbackText, 'utf8') > 65_536) {
    throw new Error('lifecycle encrypted replay payload is invalid');
  }
  return parsed;
}

function lifecycleReceiptAad(
  record: Pick<LifecycleSpoolRecord, 'key' | 'createdAt' | 'principal' | 'sealedPayload'>,
  principalNamespace: string,
  receiptSha256: string,
): Buffer {
  const payloadSha256 = String(record.sealedPayload?.payloadSha256 || '');
  if (!/^[0-9a-f]{64}$/.test(payloadSha256)) {
    throw new Error('lifecycle receipt requires a bound encrypted payload hash');
  }
  return Buffer.from(JSON.stringify([
    'cortex.lifecycle.receipt.aad.v1',
    principalNamespace,
    record.key,
    record.createdAt,
    record.principal,
    payloadSha256,
    receiptSha256,
  ]), 'utf8');
}

function sealLifecycleReceipt(
  cfg: BridgeConfig,
  principalNamespace: string,
  record: LifecycleSpoolRecord,
  receiptValue: string,
): LifecycleSealedReceipt {
  const receipt = String(receiptValue || '').trim();
  if (!receipt || Buffer.byteLength(receipt, 'utf8') > 16_384) {
    throw new Error('invalid assurance receipt for lifecycle spool');
  }
  const plaintext = Buffer.from(receipt, 'utf8');
  const receiptSha256 = createHash('sha256').update(plaintext).digest('hex');
  const aad = lifecycleReceiptAad(record, principalNamespace, receiptSha256);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', lifecycleEncryptionKey(cfg, principalNamespace), nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    receiptSha256,
    aadSha256: createHash('sha256').update(aad).digest('hex'),
  };
}

function unsealLifecycleReceipt(
  cfg: BridgeConfig,
  principalNamespace: string,
  record: LifecycleSpoolRecord,
): string {
  const sealed = record.sealedReceipt;
  if (record.version !== 4 || !sealed) return '';
  const aad = lifecycleReceiptAad(record, principalNamespace, sealed.receiptSha256);
  const aadHash = createHash('sha256').update(aad).digest();
  const expectedAadHash = Buffer.from(sealed.aadSha256, 'hex');
  if (expectedAadHash.length !== aadHash.length || !timingSafeEqual(expectedAadHash, aadHash)) {
    throw new Error('lifecycle encrypted receipt AAD binding is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    lifecycleEncryptionKey(cfg, principalNamespace),
    Buffer.from(sealed.nonce, 'base64'),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const receiptHash = createHash('sha256').update(plaintext).digest();
  const expectedReceiptHash = Buffer.from(sealed.receiptSha256, 'hex');
  if (expectedReceiptHash.length !== receiptHash.length
    || !timingSafeEqual(expectedReceiptHash, receiptHash)) {
    throw new Error('lifecycle encrypted receipt hash is invalid');
  }
  const receipt = plaintext.toString('utf8').trim();
  if (!receipt || Buffer.byteLength(receipt, 'utf8') > 16_384) {
    throw new Error('lifecycle encrypted receipt is invalid');
  }
  return receipt;
}

type LifecycleLockOwner = {
  version: 1;
  pid: number;
  startIdentity: string;
  token: string;
  createdAt: string;
};
type LifecycleLockContender = LifecycleLockOwner & { ticket: number | null };
const LIFECYCLE_MALFORMED_LOCK_GRACE_MS = 30_000;

function fsyncLifecycleDirectory(directory: string): void {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function durableLifecycleMkdir(directory: string): void {
  const target = path.resolve(directory);
  const missing: string[] = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const child of missing.reverse()) {
    const parent = path.dirname(child);
    let created = false;
    try {
      fs.mkdirSync(child, { mode: 0o700 });
      created = true;
    } catch (error: any) {
      if (error?.code !== 'EEXIST' || !fs.statSync(child).isDirectory()) throw error;
    }
    try {
      fs.chmodSync(child, 0o700);
      if (created) fsyncLifecycleDirectory(parent);
    } catch (error) {
      // A failed parent fsync cannot be reported as durable.  Remove the
      // still-empty link where possible so retry must recreate and resync it.
      if (created) try { fs.rmdirSync(child); } catch {}
      throw error;
    }
  }
  if (!fs.statSync(target).isDirectory()) throw new Error(`lifecycle state path is not a directory: ${target}`);
  try { fs.chmodSync(target, 0o700); } catch {}
}

function boundedLifecycleDirectoryEntries(directory: string, maximum: number): fs.Dirent[] {
  const entries: fs.Dirent[] = [];
  const handle = fs.opendirSync(directory);
  try {
    while (true) {
      const entry = handle.readSync();
      if (!entry) break;
      if (entries.length >= maximum) {
        throw new Error(`Cortex lifecycle directory exceeds bounded enumeration limit ${maximum}: ${directory}`);
      }
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  return entries;
}

function lifecycleProcessStartIdentity(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    // /proc/<pid>/stat field 22 is process start time. The tail begins at
    // field 3, so zero-based tail index 19 is the stable boot-relative ID.
    return stat.slice(close + 2).split(' ')[19] || null;
  } catch { return null; }
}

function lifecycleProcessIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === 'EPERM'; }
}

function parseLifecycleLockOwner(text: string): LifecycleLockOwner | null {
  try {
    const owner = JSON.parse(text) as Record<string, unknown>;
    return owner?.version === 1
      && Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0
      && typeof owner.startIdentity === 'string' && owner.startIdentity.length > 0 && owner.startIdentity.length <= 256
      && typeof owner.token === 'string' && owner.token.length > 0 && owner.token.length <= 256
      && typeof owner.createdAt === 'string' && owner.createdAt.length > 0 && owner.createdAt.length <= 64
      ? owner as LifecycleLockOwner
      : null;
  } catch { return null; }
}

function lifecycleOwnerIsDefinitelyStale(owner: LifecycleLockOwner): boolean {
  if (!lifecycleProcessIsAlive(owner.pid)) return true;
  const observed = lifecycleProcessStartIdentity(owner.pid);
  return observed !== null && observed !== owner.startIdentity;
}

function unlinkLifecycleLockIfOwned(lockPath: string, token: string): boolean {
  try {
    const owner = parseLifecycleLockOwner(fs.readFileSync(lockPath, 'utf8'));
    if (!owner || owner.token !== token) return false;
    fs.unlinkSync(lockPath);
    fsyncLifecycleDirectory(path.dirname(lockPath));
    return true;
  } catch { return false; }
}

function lifecycleMalformedEntryIsStale(entry: string): boolean {
  try {
    const first = fs.statSync(entry);
    if (Date.now() - first.mtimeMs < LIFECYCLE_MALFORMED_LOCK_GRACE_MS) return false;
    const second = fs.statSync(entry);
    return first.dev === second.dev && first.ino === second.ino
      && first.size === second.size && first.mtimeMs === second.mtimeMs;
  } catch { return false; }
}

function createLifecycleLock(lockPath: string): { fd: number; owner: LifecycleLockOwner } {
  const owner: LifecycleLockOwner = {
    version: 1,
    pid: process.pid,
    startIdentity: lifecycleProcessStartIdentity(process.pid) || `runtime:${process.pid}`,
    token: randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  const temporary = `${lockPath}.${process.pid}.${owner.token}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(owner));
    fs.fsyncSync(fd);
    // A hard-link publish is exclusive and exposes only a complete owner.
    fs.linkSync(temporary, lockPath);
    try { fs.unlinkSync(temporary); } catch {}
    fsyncLifecycleDirectory(path.dirname(lockPath));
    return { fd, owner };
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function lifecycleLockSleep(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}

function publishLifecycleContender(guardPath: string, contender: LifecycleLockContender): string {
  const entry = path.join(guardPath, `${contender.pid}-${contender.token}`);
  const temporary = `${entry}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(contender));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, entry);
    fsyncLifecycleDirectory(guardPath);
    return entry;
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readLifecycleContenders(guardPath: string): Array<{
  path: string;
  owner: LifecycleLockContender | null;
  staleMalformed: boolean;
}> {
  const contenders = [];
  for (const name of fs.readdirSync(guardPath)) {
    if (name.endsWith('.tmp')) continue;
    const entry = path.join(guardPath, name);
    let text = '';
    try { text = fs.readFileSync(entry, 'utf8'); } catch { continue; }
    const parsed = parseLifecycleLockOwner(text);
    let ticket: unknown;
    try { ticket = (JSON.parse(text) as Record<string, unknown>).ticket; } catch {}
    const owner = parsed && (ticket === null || (Number.isSafeInteger(ticket) && Number(ticket) > 0))
      ? { ...parsed, ticket: ticket as number | null }
      : null;
    contenders.push({
      path: entry,
      owner,
      staleMalformed: !owner && lifecycleMalformedEntryIsStale(entry),
    });
  }
  return contenders;
}

function acquireLifecycleReclamationGuard(
  lockPath: string,
  deadline: number,
): { entry: string; owner: LifecycleLockContender } {
  const guardPath = `${lockPath}.guard`;
  durableLifecycleMkdir(guardPath);
  const base: LifecycleLockContender = {
    version: 1,
    pid: process.pid,
    startIdentity: lifecycleProcessStartIdentity(process.pid) || `runtime:${process.pid}`,
    token: randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    ticket: null,
  };
  const entry = publishLifecycleContender(guardPath, base);
  try {
    let maximumTicket = 0;
    for (const contender of readLifecycleContenders(guardPath)) {
      if (contender.path === entry) continue;
      if (contender.owner && lifecycleOwnerIsDefinitelyStale(contender.owner)) {
        unlinkLifecycleLockIfOwned(contender.path, contender.owner.token);
      } else if (!contender.owner && contender.staleMalformed) {
        try { fs.unlinkSync(contender.path); } catch {}
      } else if (contender.owner?.ticket) {
        maximumTicket = Math.max(maximumTicket, contender.owner.ticket);
      }
    }
    const owner = { ...base, ticket: maximumTicket + 1 };
    const replacement = `${entry}.ticket`;
    const replacementFd = fs.openSync(replacement, 'wx', 0o600);
    try {
      fs.writeFileSync(replacementFd, JSON.stringify(owner));
      fs.fsyncSync(replacementFd);
    } finally { fs.closeSync(replacementFd); }
    fs.renameSync(replacement, entry);
    fsyncLifecycleDirectory(guardPath);
    while (true) {
      let blocked = false;
      for (const contender of readLifecycleContenders(guardPath)) {
        if (contender.path === entry) continue;
        if (contender.owner && lifecycleOwnerIsDefinitelyStale(contender.owner)) {
          unlinkLifecycleLockIfOwned(contender.path, contender.owner.token);
          continue;
        }
        if (!contender.owner && contender.staleMalformed) {
          try { fs.unlinkSync(contender.path); } catch {}
          continue;
        }
        if (!contender.owner || contender.owner.ticket === null
          || contender.owner.ticket < owner.ticket
          || (contender.owner.ticket === owner.ticket && contender.owner.token < owner.token)) blocked = true;
      }
      if (!blocked) return { entry, owner };
      if (Date.now() >= deadline) throw new Error('timed out acquiring Cortex lifecycle spool reclamation guard');
      lifecycleLockSleep();
    }
  } catch (error) {
    unlinkLifecycleLockIfOwned(entry, base.token);
    throw error;
  }
}

function withLifecycleDirectoryLock<T>(lockPath: string, operation: () => T): T {
  const deadline = Date.now() + 10_000;
  const guard = acquireLifecycleReclamationGuard(lockPath, deadline);
  let lockFd: number | undefined;
  let owner: LifecycleLockOwner | undefined;
  try {
    while (lockFd === undefined) {
      try {
        ({ fd: lockFd, owner } = createLifecycleLock(lockPath));
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const existing = parseLifecycleLockOwner(fs.readFileSync(lockPath, 'utf8'));
          if (existing && lifecycleOwnerIsDefinitelyStale(existing)) {
            unlinkLifecycleLockIfOwned(lockPath, existing.token);
          } else if (!existing && lifecycleMalformedEntryIsStale(lockPath)) {
            const first = fs.statSync(lockPath);
            const second = fs.statSync(lockPath);
            if (first.dev === second.dev && first.ino === second.ino) fs.unlinkSync(lockPath);
          }
        } catch {}
        if (Date.now() >= deadline) throw new Error('timed out acquiring Cortex lifecycle spool lock');
        lifecycleLockSleep();
      }
    }
    return operation();
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (owner) unlinkLifecycleLockIfOwned(lockPath, owner.token);
    unlinkLifecycleLockIfOwned(guard.entry, guard.owner.token);
  }
}

class DurableLifecycleSpool {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly maxRecords: number;
  private readonly records = new Map<string, LifecycleSpoolRecord>();

  constructor(stateDir: string, maxRecords: number) {
    this.filePath = path.join(stateDir, 'lifecycle-spool.json');
    this.lockPath = path.join(stateDir, '.lifecycle-spool.lock');
    this.maxRecords = maxRecords;
    durableLifecycleMkdir(stateDir);
    this.withLock(() => this.reload());
  }

  entries(): LifecycleSpoolRecord[] {
    return this.withLock(() => {
      this.reload();
      return [...this.records.values()].map((record) => ({ ...record }));
    });
  }

  has(key: string): boolean { return this.withLock(() => { this.reload(); return this.records.has(key); }); }

  get size(): number { return this.withLock(() => { this.reload(); return this.records.size; }); }

  put(record: LifecycleSpoolRecord): LifecycleSpoolRecord {
    return this.withLock(() => {
      this.reload();
      const existing = this.records.get(record.key);
      if (existing) return { ...existing };
      if (this.records.size >= this.maxRecords) {
        throw new Error(`lifecycle spool exhausted at ${this.maxRecords} records`);
      }
      const persisted = sanitizeLifecycleSpoolRecord({ ...record } as LifecycleSpoolRecord);
      this.records.set(record.key, persisted);
      this.flush();
      return { ...persisted };
    });
  }

  retainReceipt(
    key: string,
    candidateReceipt: string,
    replaceReceipt: string,
    cfg: BridgeConfig,
    principalNamespace: string,
  ): string {
    return this.withLock(() => {
      this.reload();
      const record = this.records.get(key);
      if (!record) throw new Error('cannot retain an assurance receipt for a missing lifecycle record');
      const receipt = String(candidateReceipt || '').trim();
      if (!receipt || Buffer.byteLength(receipt, 'utf8') > 16_384) throw new Error('invalid assurance receipt for lifecycle spool');
      if (record.version === 4 && record.sealedPayload) {
        const candidateHash = createHash('sha256').update(receipt, 'utf8').digest('hex');
        const expectedReceipt = String(replaceReceipt || '').trim();
        const existingHash = String(record.sealedReceipt?.receiptSha256 || '');
        if (existingHash) {
          const expectedHash = expectedReceipt
            ? createHash('sha256').update(expectedReceipt, 'utf8').digest('hex')
            : candidateHash;
          if (existingHash !== expectedHash) {
            throw new Error('assurance receipt identity conflicts with encrypted lifecycle state');
          }
          if (!expectedReceipt) return receipt;
        }
        const sealedReceipt = sealLifecycleReceipt(
          cfg,
          principalNamespace,
          record,
          receipt,
        );
        const updatedRecord = { ...record, sealedReceipt };
        delete updatedRecord.assuranceReceipt;
        if (Buffer.byteLength(JSON.stringify(updatedRecord), 'utf8') > LIFECYCLE_SPOOL_MAX_RECORD_BYTES) {
          throw new Error(`lifecycle spool record exceeds ${LIFECYCLE_SPOOL_MAX_RECORD_BYTES} bytes`);
        }
        this.records.set(key, updatedRecord);
        this.flush();
        return receipt;
      }
      const existingReceipt = String(record.assuranceReceipt || '').trim();
      const expectedReceipt = String(replaceReceipt || '').trim();
      if (existingReceipt && (!expectedReceipt || existingReceipt !== expectedReceipt)) return existingReceipt;
      record.assuranceReceipt = receipt;
      this.records.set(key, record);
      this.flush();
      return receipt;
    });
  }

  ack(key: string): void {
    this.withLock(() => {
      this.reload();
      if (!this.records.delete(key)) return;
      this.flush();
    });
  }

  removeIfEmpty(): boolean {
    return this.withLock(() => {
      this.reload();
      if (this.records.size > 0) return false;
      try { fs.unlinkSync(this.filePath); } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      this.fsyncDirectory();
      // Keep the namespace directory as the stable lock namespace. Removing it
      // can let a concurrent process lock a different inode and lose records.
      return true;
    });
  }

  private withLock<T>(operation: () => T): T {
    return withLifecycleDirectoryLock(this.lockPath, operation);
  }

  private reload(): void {
    this.records.clear();
    if (!fs.existsSync(this.filePath)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch {
      throw new Error('invalid Cortex lifecycle spool JSON; refusing to discard pending persistence metadata');
    }
    if (!Array.isArray(parsed) || parsed.length > this.maxRecords || !parsed.every(isLifecycleSpoolRecord)) {
      throw new Error('invalid Cortex lifecycle spool; refusing to discard pending persistence records');
    }
    let sanitizedLegacy = false;
    for (const rawRecord of parsed) {
      const record = rawRecord as any;
      const sanitized = sanitizeLifecycleSpoolRecord({ ...record });
      if (JSON.stringify(sanitized) !== JSON.stringify(record)) sanitizedLegacy = true;
      this.records.set(sanitized.key, sanitized);
    }
    if (sanitizedLegacy) this.flush();
  }

  private fsyncDirectory(): void {
    fsyncLifecycleDirectory(path.dirname(this.filePath));
  }

  private flush(): void {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify([...this.records.values()]), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.filePath);
      this.fsyncDirectory();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
}

class DurableLifecycleQuota {
  private readonly root: string;
  private readonly maxRecords: number;
  private readonly maxNamespaces: number;
  private readonly maxInodes: number;
  private readonly maxBytes: number;
  private readonly lockPath: string;

  constructor(root: string, maxRecords: number) {
    this.root = root;
    this.maxRecords = maxRecords;
    this.maxNamespaces = Math.max(1, maxRecords);
    this.maxInodes = (this.maxNamespaces * LIFECYCLE_NAMESPACE_INODE_BUDGET)
      + LIFECYCLE_ROOT_INODE_RESERVE;
    this.maxBytes = Math.max(
      LIFECYCLE_SPOOL_MAX_RECORD_BYTES + 2,
      (maxRecords * (LIFECYCLE_SPOOL_MAX_RECORD_BYTES + 1)) + 2,
    );
    this.lockPath = path.join(root, '.lifecycle-spool-global.lock');
  }

  runExclusive<T>(operation: () => T): T {
    return withLifecycleDirectoryLock(this.lockPath, operation);
  }

  private usage(): { namespaces: number; inodes: number; records: number; bytes: number } {
    let namespaces = 0;
    let inodes = 0;
    let records = 0;
    let bytes = 0;
    const rootEntries = boundedLifecycleDirectoryEntries(
      this.root,
      this.maxNamespaces + LIFECYCLE_ROOT_INODE_RESERVE,
    );
    for (const entry of rootEntries) {
      const entryPath = path.join(this.root, entry.name);
      inodes += 1;
      if (entry.isFile()) {
        bytes += fs.statSync(entryPath).size;
        continue;
      }
      if (!entry.isDirectory()) continue;
      const principalNamespace = /^[0-9a-f]{64}$/.test(entry.name);
      if (principalNamespace) namespaces += 1;
      const pending = [{ directory: entryPath, maximum: principalNamespace
        ? LIFECYCLE_NAMESPACE_INODE_BUDGET
        : this.maxInodes }];
      while (pending.length > 0) {
        const { directory, maximum } = pending.pop()!;
        const children = boundedLifecycleDirectoryEntries(directory, maximum);
        for (const child of children) {
          const childPath = path.join(directory, child.name);
          inodes += 1;
          if (inodes > this.maxInodes) {
            throw new Error(`lifecycle spool exhausted across principals at ${this.maxInodes} inodes`);
          }
          if (child.isDirectory()) {
            pending.push({ directory: childPath, maximum });
          } else if (child.isFile()) {
            bytes += fs.statSync(childPath).size;
          }
        }
      }
      if (!principalNamespace) continue;
      const spoolFile = path.join(entryPath, 'lifecycle-spool.json');
      if (!fs.existsSync(spoolFile)) continue;
      const raw = fs.readFileSync(spoolFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isLifecycleSpoolRecord)) {
        throw new Error('invalid Cortex lifecycle spool during global quota reconciliation');
      }
      records += parsed.length;
    }
    if (namespaces > this.maxNamespaces) {
      throw new Error(`lifecycle spool exhausted across principals at ${this.maxNamespaces} namespaces`);
    }
    if (records > this.maxRecords) {
      throw new Error(`lifecycle spool exhausted across principals at ${this.maxRecords} records`);
    }
    if (bytes > this.maxBytes) {
      throw new Error(`lifecycle spool exhausted across principals at ${this.maxBytes} bytes`);
    }
    return { namespaces, inodes, records, bytes };
  }

  restartEntries(): fs.Dirent[] {
    this.usage();
    return boundedLifecycleDirectoryEntries(
      this.root,
      this.maxNamespaces + LIFECYCLE_ROOT_INODE_RESERVE,
    );
  }

  spoolForNamespace(namespace: string): DurableLifecycleSpool {
    if (!/^[0-9a-f]{64}$/.test(namespace)) throw new Error('invalid lifecycle principal namespace');
    return this.runExclusive(() => {
      const namespaceDir = path.join(this.root, namespace);
      if (fs.existsSync(namespaceDir)) {
        if (!fs.statSync(namespaceDir).isDirectory()) throw new Error('lifecycle principal namespace is not a directory');
        this.usage();
        return new DurableLifecycleSpool(namespaceDir, this.maxRecords);
      }
      const usage = this.usage();
      if (usage.records >= this.maxRecords) {
        throw new Error(`lifecycle spool exhausted across principals at ${this.maxRecords} records`);
      }
      if (usage.namespaces >= this.maxNamespaces) {
        throw new Error(`lifecycle spool exhausted across principals at ${this.maxNamespaces} namespaces`);
      }
      if (usage.inodes + 2 > this.maxInodes) {
        throw new Error(`lifecycle spool exhausted across principals at ${this.maxInodes} inodes`);
      }
      durableLifecycleMkdir(namespaceDir);
      try {
        return new DurableLifecycleSpool(namespaceDir, this.maxRecords);
      } catch (error) {
        this.reapNamespace(namespace);
        throw error;
      }
    });
  }

  entries(namespace: string, spool: DurableLifecycleSpool): LifecycleSpoolRecord[] {
    return this.runExclusive(() => {
      this.assertNamespace(namespace);
      return spool.entries();
    });
  }

  put(namespace: string, spool: DurableLifecycleSpool, record: LifecycleSpoolRecord): LifecycleSpoolRecord {
    return this.runExclusive(() => {
      this.assertNamespace(namespace);
      const existing = spool.has(record.key);
      const usage = this.usage();
      if (!existing && usage.records >= this.maxRecords) {
        throw new Error(`lifecycle spool exhausted across principals at ${this.maxRecords} records`);
      }
      const persisted = sanitizeLifecycleSpoolRecord({ ...record } as LifecycleSpoolRecord);
      const encodedRecordBytes = Buffer.byteLength(JSON.stringify(persisted), 'utf8');
      if (encodedRecordBytes > LIFECYCLE_SPOOL_MAX_RECORD_BYTES) {
        throw new Error(`lifecycle spool record exceeds ${LIFECYCLE_SPOOL_MAX_RECORD_BYTES} bytes`);
      }
      if (!existing) {
        const spoolFile = path.join(this.root, namespace, 'lifecycle-spool.json');
        const currentBytes = fs.existsSync(spoolFile) ? fs.statSync(spoolFile).size : 0;
        const projectedBytes = usage.bytes - currentBytes
          + Buffer.byteLength(JSON.stringify([...spool.entries(), persisted]), 'utf8');
        if (projectedBytes > this.maxBytes) {
          throw new Error(`lifecycle spool exhausted across principals at ${this.maxBytes} bytes`);
        }
      }
      return spool.put(record);
    });
  }

  retainReceipt(
    namespace: string,
    spool: DurableLifecycleSpool,
    key: string,
    receipt: string,
    cfg: BridgeConfig,
    replaceReceipt = '',
  ): string {
    return this.runExclusive(() => {
      this.assertNamespace(namespace);
      return spool.retainReceipt(key, receipt, replaceReceipt, cfg, namespace);
    });
  }

  acknowledge(namespace: string, spool: DurableLifecycleSpool, key: string): boolean {
    return this.runExclusive(() => {
      const namespaceDir = path.join(this.root, namespace);
      // A second process may have already acknowledged the same idempotent
      // record and reaped the now-empty namespace while this process was
      // completing the remote write. Missing here therefore means the durable
      // acknowledgement already won; retrying would strand a phantom record in
      // the local replay queue.
      if (!fs.existsSync(namespaceDir)) return true;
      this.assertNamespace(namespace);
      spool.ack(key);
      return this.removeIfEmptyLocked(namespace, spool);
    });
  }

  removeIfEmpty(namespace: string, spool: DurableLifecycleSpool): boolean {
    return this.runExclusive(() => {
      if (!fs.existsSync(path.join(this.root, namespace))) return true;
      this.assertNamespace(namespace);
      return this.removeIfEmptyLocked(namespace, spool);
    });
  }

  purgeBefore(namespace: string, spool: DurableLifecycleSpool, deletionEpoch: string): number {
    const epoch = Date.parse(deletionEpoch);
    if (!Number.isFinite(epoch)) throw new Error('invalid principal deletion epoch');
    return this.runExclusive(() => {
      const namespaceDir = path.join(this.root, namespace);
      if (!fs.existsSync(namespaceDir)) return 0;
      this.assertNamespace(namespace);
      const eligible = spool.entries().filter((record) => {
        const createdAt = Date.parse(record.createdAt);
        if (!Number.isFinite(createdAt)) throw new Error('invalid lifecycle spool creation timestamp');
        return createdAt <= epoch;
      });
      for (const record of eligible) spool.ack(record.key);
      if (spool.size === 0) this.removeIfEmptyLocked(namespace, spool);
      return eligible.length;
    });
  }

  reapNamespace(namespace: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(namespace)) return false;
    const namespaceDir = path.join(this.root, namespace);
    const guardDir = path.join(namespaceDir, '.lifecycle-spool.lock.guard');
    try { fs.rmdirSync(guardDir); } catch (error: any) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    }
    try {
      fs.rmdirSync(namespaceDir);
      fsyncLifecycleDirectory(this.root);
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return true;
      if (error?.code === 'ENOTEMPTY') return false;
      throw error;
    }
  }

  private assertNamespace(namespace: string): void {
    if (!/^[0-9a-f]{64}$/.test(namespace)) throw new Error('invalid lifecycle principal namespace');
    const namespaceDir = path.join(this.root, namespace);
    if (!fs.existsSync(namespaceDir) || !fs.statSync(namespaceDir).isDirectory()) {
      throw new Error('lifecycle principal namespace is no longer admitted');
    }
  }

  private removeIfEmptyLocked(namespace: string, spool: DurableLifecycleSpool): boolean {
    if (!spool.removeIfEmpty()) return false;
    return this.reapNamespace(namespace);
  }
}

function quarantineLifecycleFile(filePath: string, reason: string): string {
  const raw = fs.readFileSync(filePath);
  const suffix = `${reason}.${Date.now()}.${process.pid}.${Math.random().toString(16).slice(2)}.quarantine.json`;
  const destination = `${filePath}.${suffix}`;
  const marker = {
    schemaVersion: 'cortex.lifecycle-quarantine-metadata.v1',
    reason,
    originalBytes: raw.length,
    originalSha256: createHash('sha256').update(raw).digest('hex'),
  };
  const fd = fs.openSync(destination, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(marker), 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.unlinkSync(filePath);
  fsyncLifecycleDirectory(path.dirname(filePath));
  return destination;
}

const SearchSchema = {
  type: 'object', additionalProperties: false, required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 16_384 },
    maxResults: { type: 'integer', minimum: 1, maximum: 50 },
    minScore: { type: 'number', minimum: 0, maximum: 1 },
    filters: {
      type: 'object', additionalProperties: false,
      properties: {
        source_ids: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        source_paths: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        memory_types: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        tags: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        fact_keys: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        claim_keys: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        projects: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 256 } },
        classifications: { type: 'array', maxItems: 16, items: { type: 'string', enum: ['public', 'private', 'sensitive', 'restricted'] } },
        statuses: { type: 'array', maxItems: 16, items: { type: 'string', enum: ['active', 'superseded', 'tombstoned', 'historical', 'conflicted'] } },
        as_of: { type: 'string', maxLength: 64 },
        as_known_at: { type: 'string', maxLength: 64 },
        include_stale: { type: 'boolean' },
        include_unknown_time: { type: 'boolean' },
        include_conflicts: { type: 'boolean' },
      },
    },
  },
} as const;
const GetSchema = {
  type: 'object', additionalProperties: false, required: ['path'],
  properties: { path: { type: 'string' }, from: { type: 'number' }, lines: { type: 'number' } },
} as const;
const DeletePrincipalMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmation'],
  properties: {
    confirmation: { type: 'string', enum: ['HARD_DELETE_CORTEX_MEMORY'] },
  },
} as const;

function resolveConfig(pluginConfig?: Record<string, unknown>): Required<Pick<BridgeConfig, 'baseUrl' | 'searchPath' | 'storePath' | 'codecEventsPath' | 'timeoutMs' | 'retryCount' | 'retryBackoffMs' | 'curatedBoost' | 'projectFactBoost' | 'durableCandidatePenalty' | 'noisyWhatsappPenalty' | 'noisyPatternPenalty' | 'minDurabilityScore' | 'writeTags' | 'conflictPenalty' | 'recencyBoost' | 'explicitBoost' | 'corroborationBoost' | 'hardQueryCandidateCount' | 'maxResponseBytes' | 'lifecycleMaxInFlight' | 'lifecycleMaxPending' | 'lifecycleSpoolMaxRecords' | 'lifecycleReplayInitialDelayMs' | 'lifecycleReplayRetryMs' | 'lifecycleReplaySuccessDelayMs' | 'recentOutputMaxChars' | 'stateDir'>> & BridgeConfig {
  const cfg = (pluginConfig ?? {}) as BridgeConfig;
  const writeTokenHeader = cfg.writeTokenHeader ?? 'x-cortex-write-token';
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(writeTokenHeader)) throw new Error('invalid Cortex write-token header name');
  return {
    baseUrl: (cfg.baseUrl ?? 'http://127.0.0.1:8888').replace(/\/$/, ''),
    searchPath: cfg.searchPath ?? '/knowledge/search',
    storePath: cfg.storePath ?? '/nexus/commit',
    assurancePath: cfg.assurancePath ?? '/nexus/assurance/receipt',
    codecEventsPath: cfg.codecEventsPath ?? '/nexus/codec/events',
    timeoutMs: cfg.timeoutMs ?? 12000,
    retryCount: cfg.retryCount ?? 2,
    retryBackoffMs: cfg.retryBackoffMs ?? 350,
    enabledWriteThrough: cfg.enabledWriteThrough ?? false,
    enabledCodecContinuity: cfg.enabledCodecContinuity ?? true,
    maxResponseBytes: cfg.maxResponseBytes ?? 1_048_576,
    lifecycleMaxInFlight: Number.isSafeInteger(cfg.lifecycleMaxInFlight) && Number(cfg.lifecycleMaxInFlight) > 0
      ? Math.min(4096, Number(cfg.lifecycleMaxInFlight))
      : LIFECYCLE_MAX_IN_FLIGHT,
    lifecycleMaxPending: Number.isSafeInteger(cfg.lifecycleMaxPending) && Number(cfg.lifecycleMaxPending) > 0
      ? Math.min(16_384, Number(cfg.lifecycleMaxPending))
      : LIFECYCLE_MAX_PENDING,
    lifecycleSpoolMaxRecords: Number.isSafeInteger(cfg.lifecycleSpoolMaxRecords) && Number(cfg.lifecycleSpoolMaxRecords) > 0
      ? Math.min(65_536, Number(cfg.lifecycleSpoolMaxRecords))
      : LIFECYCLE_SPOOL_MAX_RECORDS,
    lifecycleReplayInitialDelayMs: Number.isSafeInteger(cfg.lifecycleReplayInitialDelayMs) && Number(cfg.lifecycleReplayInitialDelayMs) > 0
      ? Math.min(600_000, Number(cfg.lifecycleReplayInitialDelayMs))
      : LIFECYCLE_REPLAY_INITIAL_DELAY_MS,
    lifecycleReplayRetryMs: Number.isSafeInteger(cfg.lifecycleReplayRetryMs) && Number(cfg.lifecycleReplayRetryMs) > 0
      ? Math.min(600_000, Number(cfg.lifecycleReplayRetryMs))
      : LIFECYCLE_REPLAY_RETRY_MS,
    lifecycleReplaySuccessDelayMs: Number.isSafeInteger(cfg.lifecycleReplaySuccessDelayMs) && Number(cfg.lifecycleReplaySuccessDelayMs) > 0
      ? Math.min(600_000, Number(cfg.lifecycleReplaySuccessDelayMs))
      : LIFECYCLE_REPLAY_SUCCESS_DELAY_MS,
    recentOutputMaxChars: Number.isSafeInteger(cfg.recentOutputMaxChars) && Number(cfg.recentOutputMaxChars) > 0
      ? Math.min(65_536, Number(cfg.recentOutputMaxChars))
      : RECENT_OUTPUT_MAX_CHARS,
    writeToken: typeof cfg.writeToken === 'string' ? cfg.writeToken : '',
    writeTokenHeader: writeTokenHeader.toLowerCase(),
    tenantId: typeof cfg.tenantId === 'string' ? cfg.tenantId.trim() : 'cortex-local',
    workspaceId: typeof cfg.workspaceId === 'string' ? cfg.workspaceId.trim() : 'default',
    agentId: typeof cfg.agentId === 'string' && cfg.agentId.trim() ? cfg.agentId.trim() : 'main',
    ownerSenderId: typeof cfg.ownerSenderId === 'string' ? cfg.ownerSenderId.trim() : '',
    userId: typeof cfg.userId === 'string' && cfg.userId.trim() ? cfg.userId.trim() : 'local-user',
    channelId: typeof cfg.channelId === 'string' && cfg.channelId.trim() ? cfg.channelId.trim() : 'local-channel',
    sessionId: typeof cfg.sessionId === 'string' && cfg.sessionId.trim() ? cfg.sessionId.trim() : 'global-session',
    scopeCredentialId: typeof cfg.scopeCredentialId === 'string' ? cfg.scopeCredentialId.trim() : '',
    scopeHmacSecret: typeof cfg.scopeHmacSecret === 'string' ? cfg.scopeHmacSecret : '',
    allowUnsignedLocalDevelopment: cfg.allowUnsignedLocalDevelopment === true,
    sessionIdentityHmacSecret: typeof cfg.sessionIdentityHmacSecret === 'string' ? cfg.sessionIdentityHmacSecret : '',
    lifecycleEncryptionKey: typeof cfg.lifecycleEncryptionKey === 'string' ? cfg.lifecycleEncryptionKey : '',
    stateDir: typeof cfg.stateDir === 'string' && cfg.stateDir.trim()
      ? cfg.stateDir.trim()
      : path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-memory-bridge'),
    curatedBoost: cfg.curatedBoost ?? 0.24,
    projectFactBoost: cfg.projectFactBoost ?? 0.12,
    durableCandidatePenalty: cfg.durableCandidatePenalty ?? 0.14,
    noisyWhatsappPenalty: cfg.noisyWhatsappPenalty ?? 0.26,
    noisyPatternPenalty: cfg.noisyPatternPenalty ?? 0.2,
    minDurabilityScore: cfg.minDurabilityScore ?? 0.72,
    writeTags: Array.isArray(cfg.writeTags) ? cfg.writeTags.map((x) => String(x)) : ['durable-memory', 'assurance-candidate'],
    conflictPenalty: cfg.conflictPenalty ?? 0.18,
    recencyBoost: cfg.recencyBoost ?? 0.12,
    explicitBoost: cfg.explicitBoost ?? 0.14,
    corroborationBoost: cfg.corroborationBoost ?? 0.08,
    hardQueryCandidateCount: cfg.hardQueryCandidateCount ?? 12,
  };
}

function isLoopbackBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
    return ['http:', 'https:'].includes(url.protocol) && loopback && !url.username && !url.password;
  } catch {
    return false;
  }
}

function explicitUnsignedDevelopmentMode(): string {
  const configuredModes = [
    ['OPENCLAW_ENV', process.env.OPENCLAW_ENV],
    ['CORTEX_ENV', process.env.CORTEX_ENV],
    ['NODE_ENV', process.env.NODE_ENV],
  ]
    .map(([name, value]) => [name, String(value ?? '').trim().toLowerCase()] as const)
    .filter(([, value]) => value.length > 0);
  if (configuredModes.length === 0) {
    throw new Error('cortex-memory-bridge unsigned local development requires an explicit non-production runtime mode');
  }

  const aliases: Record<string, string> = { dev: 'development', prod: 'production' };
  const canonicalMode = (value: string): string => aliases[value] || value;
  const modes = new Set(configuredModes.map(([, value]) => canonicalMode(value)));
  if (modes.size !== 1) {
    throw new Error(`cortex-memory-bridge unsigned local development rejects conflicting runtime modes: ${configuredModes.map(([name, value]) => `${name}=${value}`).join(', ')}`);
  }
  const mode = [...modes][0];
  if (['production', 'staging'].includes(mode)) {
    throw new Error('cortex-memory-bridge unsigned local development is forbidden in production or staging mode');
  }
  if (!['development', 'test', 'local'].includes(mode)) {
    throw new Error(`cortex-memory-bridge unsigned local development requires dev, development, test, or local mode; received ${mode}`);
  }
  return mode;
}

function normalizeQuery(text: string): string { return text.trim().toLowerCase(); }
function looksHistoricalQuery(query: string): boolean { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query: string): boolean { const q = normalizeQuery(query); const words = q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function explicitNoiseSeekingQuery(query: string): boolean { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }
const STOPWORDS = new Set(['the','a','an','and','or','but','for','from','with','without','into','onto','about','what','where','when','which','who','whom','this','that','these','those','is','are','was','were','be','been','being','to','of','in','on','at','by','my','we','it','as','do','did','does','how','main','session']);
function semanticTerms(text: string): string[] {
  return Array.from(new Set(normalizeQuery(text).split(/[^a-z0-9_.-]+/).filter((x) => x.length >= 3 && !STOPWORDS.has(x))));
}
function lexicalOverlapScore(query: string, text: string, metadata: Record<string, unknown>): number {
  const qTerms = semanticTerms(query);
  if (!qTerms.length) return 0;
  const hay = `${text} ${String(metadata?.topic ?? '')} ${Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : ''}`.toLowerCase();
  let hits = 0;
  for (const term of qTerms) {
    if (hay.includes(term)) hits += 1;
  }
  return Math.max(0, Math.min(1, hits / qTerms.length));
}
function isCurated(metadata: any): boolean { const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x)) : []; return metadata?.quality === 'curated' || tags.includes('curated'); }
function isWhatsappHighSignal(metadata: any): boolean { return metadata?.source === 'whatsapp-high-signal'; }
function isProjectStateMemory(metadata: any): boolean { return ['curated-project-facts', 'curated-preferences-priorities', 'curated-anti-drift', 'curated-noise-suppression'].includes(String(metadata?.source ?? '')); }
function isDurableCandidate(metadata: any): boolean { return metadata?.source === 'durable-candidates'; }
function isGhostCache(metadata: any): boolean { return String(metadata?.type ?? '').toLowerCase() === 'ghost_cache' || String(metadata?.source ?? '').toLowerCase() === 'ghost_cache'; }
function queryIsAboutGhostCache(query: string): boolean { return /\bghost cache\b|\bghost\b.*\bcache\b|\bcache key\b|\bcached browse\b/.test(normalizeQuery(query)); }
function isProbeNoise(metadata: any, text: string): boolean {
  const source = String(metadata?.source ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.trim().toLowerCase();
  return source.includes('probe') || tags.includes('probe') || t === 'probe' || /^probe[:\s-]?/.test(t);
}
function queryIsAboutProbe(query: string): boolean { return /\bprobe\b|self-model|telemetry|diagnostic/.test(normalizeQuery(query)); }
function isLeakyInternalTrace(text: string): boolean {
  const t = text.toLowerCase();
  return /encrypted_content|thinkingsignature|cortex upstream routing applied:|\bthinking\s*\{|"type":"reasoning"|gaaaaaab/.test(t);
}
function queryIsAboutInternalTrace(query: string): boolean { return /encrypted_content|thinking|routing applied|reasoning payload|internal trace/.test(normalizeQuery(query)); }
function isExecutionTraceNoise(text: string): boolean {
  const t = text.toLowerCase();
  return /\btoolcall\b|\bsessions_yield\b|\bsessions_spawn\b|\bcall_[a-z0-9]+\b|"command":|"workdir":|"yieldms":|"timeoutseconds":|"runtime":"subagent"|openclaw gateway restart/.test(t);
}
function queryIsAboutExecutionTrace(query: string): boolean { return /toolcall|sessions_yield|sessions_spawn|execution trace|tool trace|gateway restart/.test(normalizeQuery(query)); }
function isRecentSummaryQuery(query: string): boolean {
  return /\bwhat changed recently\b|\brecent changes\b|\brecent update\b|\bstatus update\b|\bwhat'?s going on\b|\bhow'?s this going\b|\bwhat happened lately\b|\blately\b/.test(normalizeQuery(query));
}
function queryLooksLikePreference(query: string): boolean {
  return /\bprefer|preference|call me|timezone|pronouns|reply prefix|replies begin with|reply begin with|what should replies begin with|prefix should replies use\b/i.test(query);
}
function looksLikePreferenceQuestionEcho(text: string): boolean {
  return /\bopen loops?:\b|\bwhat did jake ask me\b|\bwhat should replies begin with\b|\bwhat preference does jake\b|\bprefix replies with\b/i.test(text);
}
function looksLikeExplicitPreferenceFact(text: string): boolean {
  return /\b(?:jake\s+)?prefers?\s+repl(?:y|ies)\s+to\s+begin\s+with\b|\breplies\s+to\s+begin\s+with\s*\[cortex\]/i.test(text);
}
function isRecentSummaryMemory(metadata: Record<string, unknown>, text: string): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const topic = String(metadata?.topic ?? '').toLowerCase();
  const t = text.toLowerCase();
  return tags.includes('recent-summary')
    || topic.includes('recent-status')
    || /recent status summary:|recent changes:|this session:|bridge repair completed|write-through proved|ranking improved|noise suppression improved/.test(t);
}
function isInternalOracleMemory(metadata: Record<string, unknown>, text: string): boolean {
  const source = String(metadata?.source ?? '').toLowerCase();
  const sessionKey = String(metadata?.sessionKey ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.toLowerCase();
  return source.includes('oracle')
    || sessionKey.includes('oracle')
    || tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /oracle predicts|durable verification marker|durable smoke marker|memory bridge probe|anti recursion|terminal synthesis|repeat safeguard|convergence guard|loop guard|recursion barrier/.test(t);
}
function queryIsAboutInternalOracle(query: string): boolean {
  return /\boracle\b|semantic prediction|memory bridge probe|durable (verification|smoke) marker|anti recursion|recursion barrier|loop guard/.test(query.toLowerCase());
}
function isOracleBoilerplate(text: string, metadata: Record<string, unknown>): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.toLowerCase().trim();
  return tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /^asking oracle for a semantic prediction\.\.\.?$/.test(t)
    || /^oracle predicts:?$/i.test(text.trim());
}
function queryWantsOracleBoilerplate(query: string): boolean {
  return /semantic prediction|raw oracle|oracle trace|oracle predicts|awareness/.test(normalizeQuery(query));
}
function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') return n > 1e12 ? n : n * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function extractTimestamp(metadata: Record<string, unknown>): number | null {
  return toTimestamp(metadata.timestamp) ?? toTimestamp(metadata.createdAt) ?? toTimestamp(metadata.updatedAt) ?? toTimestamp(metadata.occurredAt) ?? null;
}
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isFinite(n) ? n : null;
}
function candidateRawScore(item: any, metadata: Record<string, unknown>): number {
  // Cortex/Librarian may already reconcile semantic distance, lexical overlap,
  // freshness, and stale-negative penalties into an explicit score. Prefer that
  // over raw vector distance so the OpenClaw-facing bridge does not undo Cortex's
  // broader recall-integrity judgment.
  const direct = finiteNumber(item?.score);
  if (direct !== null) return clamp01(direct);
  const hybrid = finiteNumber(metadata?.hybrid_score);
  if (hybrid !== null) return clamp01(hybrid);
  const relevance = finiteNumber(metadata?.relevance_score);
  if (relevance !== null) return clamp01(relevance);
  const distance = finiteNumber(item?.distance);
  return distance !== null ? 1 / (1 + Math.max(0, distance)) : 0.5;
}
function textMatchesNoise(text: string): boolean {
  const t = text.trim();
  return [
    /^\[.*\]\sJake:\s\*\*.*(COMPLETE|Finished|LIVE|OPERATIONAL).*$/i,
    /^\[.*\]\sJake:\s✅\s?.*$/i,
    /^\[.*\]\sJake:\s\*?Source:\*?\s*https?:\/\//i,
    /^\[.*\]\sJake:\shttps?:\/\/\S+$/i,
    /^\[.*\]\sJake:\sINFO\b/i,
    /^\[.*\]\sJake:\s[0-9a-f]{32,}$/i,
    /^\[.*\]\sJake:\s(Absolutely|Perfect|Okay|Yep|Yes)\b/i,
  ].some((re) => re.test(t));
}
function recencyScore(timestampMs: number | null): number {
  if (!timestampMs) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestampMs) / 86400000);
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 30) return 0.65;
  if (ageDays <= 180) return 0.45;
  return 0.25;
}
function explicitnessScore(text: string): number {
  let score = 0.2;
  if (/\b(i prefer|prefer|remember this|please remember|call me|my timezone|we decided|the plan is|always use|default to|never use|use this|current|latest|final)\b/i.test(text)) score += 0.55;
  if (/\b(maybe|probably|might|i think|seems|guess|not sure)\b/i.test(text)) score -= 0.18;
  return Math.max(0, Math.min(1, score));
}
function queryWantsNegativeEvidence(query: string): boolean {
  return /\b(not found|no evidence|no record|absence|missing|remaining|open gap|open gaps|gap inventory|gap list|blocker|what(?:'s| is| was)? still missing|what(?:'s| is| was)? left|what remains)\b/i.test(normalizeQuery(query));
}
function queryWantsMemorySystem(query: string): boolean {
  return /\bmemory system|memory search|memory_search|recall|librarian|cortex memory|knowledge\/search|reranker|ranking|semantic search\b/i.test(normalizeQuery(query));
}
function isMemorySystemMetaRow(text: string, metadata: Record<string, unknown>): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : '';
  const hay = `${text} ${String(metadata?.source ?? '')} ${tags}`.toLowerCase();
  return /memory_search\(|memory search|local file-?memory lexical fallback|recall regression|recall route|librarian\.py|test_librarian_recall_fallback|stale-negative|correction\/conclusion rows|reranker|cortex memory bridge|cortex-memory-bridge|knowledge\/search/.test(hay);
}
function isFreshOrCorrectiveFact(text: string, metadata: Record<string, unknown>): boolean {
  const t = String(text || '');
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  if (metadata?.correction_memory === true || tags.includes('correction') || tags.includes('current_fact') || tags.includes('source_of_truth')) return true;
  if (/\bcorrection\s*:|\bcorrected\b|\btruth corrected\b|\boperational conclusion\b|\bdirectly supports\b|\bsource of truth\b|\bcurrent (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\blatest (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\bfinal (?:answer|decision|state|status|setup)\b|\bnew controller\s*:/i.test(t)) return true;
  if (/\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t)) return false;
  return /\bimplemented\b|\bfixed\b|\brepaired\b|\bverified\b|\blive verification\b|\btests? passed\b/i.test(t);
}
function isStaleNegativeOrOpenWork(query: string, text: string, metadata: Record<string, unknown>): boolean {
  if (queryWantsNegativeEvidence(query) || isFreshOrCorrectiveFact(text, metadata)) return false;
  if (metadata?.stale_negative_memory === true) return true;
  const t = String(text || '');
  return /\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bnot in (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bmissing (?:from|in) (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t);
}
function sourceQualityScore(metadata: Record<string, unknown>): number {
  if (metadata?.canonical_project_memory === true || metadata?.source === 'canonical_project_file') return 1;
  if (isCurated(metadata)) return 1;
  if (isProjectStateMemory(metadata)) return 0.92;
  if (isDurableCandidate(metadata)) return 0.66;
  if (isWhatsappHighSignal(metadata)) return 0.54;
  return 0.45;
}
function extractEntity(query: string, text: string, metadata: Record<string, unknown>): string | undefined {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return undefined;
  const explicit = text.match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
  if (explicit) return explicit;
  const fromQuery = query.match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
  return fromQuery ?? undefined;
}
function extractAttribute(query: string, text: string, metadata: Record<string, unknown>): string | undefined {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return 'internal_noise';
  const textHay = text.toLowerCase();
  const queryHay = query.toLowerCase();
  if (isRecentSummaryMemory(metadata, text)) return 'recent_summary';
  if (/latest|current|changed|used to|timeline|when|before|after|renamed|fixed|updated/.test(textHay)) return 'temporal_state';
  if (/prefer|preference|like|want|call me|timezone|pronouns|replies begin with|reply prefix/.test(textHay) || queryLooksLikePreference(queryHay)) return 'preference';
  if (/decid|plan|architecture|setup|config|memory/.test(textHay)) return 'decision';
  if (/status|working|l2|browser bridge|tool|runtime/.test(textHay)) return 'runtime_state';
  return undefined;
}
function normalizeValueSignature(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
function isTentativePreferenceSignature(signature: string | undefined): boolean {
  const s = String(signature || '').toLowerCase();
  return /\bopen loops?\b|\bwhat did\b|\bask me\b|\bquestion\b|\bunknown\b|\bsystem\b/.test(s);
}
function canonicalPreferenceCore(signature: string | undefined): string {
  const s = String(signature || '').toLowerCase();
  const match = s.match(/(?:jake\s+)?prefers?\s+repl(?:y|ies)\s+to\s+begin\s+with\s+[a-z0-9\[\]]+/);
  return match ? match[0] : '';
}
function detectConflict(a: CandidateSignals, b: CandidateSignals): boolean {
  if (!a.attribute || !b.attribute || a.attribute !== b.attribute) return false;
  if (a.attribute === 'recent_summary') return false;
  if (a.entity && b.entity && a.entity.toLowerCase() !== b.entity.toLowerCase()) return false;
  if (!a.valueSignature || !b.valueSignature || a.valueSignature === b.valueSignature) return false;
  if (a.attribute === 'preference') {
    if (isTentativePreferenceSignature(a.valueSignature) || isTentativePreferenceSignature(b.valueSignature)) return false;
    const aCore = canonicalPreferenceCore(a.valueSignature);
    const bCore = canonicalPreferenceCore(b.valueSignature);
    if (aCore && bCore && aCore === bCore) return false;
  }
  return true;
}
function queryNeedsReconcile(query: string): boolean {
  return /\b(latest|current|end up|decide|decided|change|changed|still|final|actually|correct|updated|now|working)\b/i.test(query);
}
function queryNeedsInvestigate(query: string): boolean {
  return /\b(timeline|before|after|used to|across sessions|over time|reconstruct|walk me through|evolved|history|what happened)\b/i.test(query);
}
function classifyQuery(query: string): { mode: QueryMode; tags: string[] } {
  const tags: string[] = [];
  if (isRecentSummaryQuery(query)) tags.push('recent-summary');
  if (queryNeedsInvestigate(query)) tags.push('timeline');
  if (queryNeedsReconcile(query)) tags.push('conflict-prone');
  if (/\bprefer|preference|relationship|context|social cue\b/i.test(query) || queryLooksLikePreference(query)) tags.push('preference');
  if (tags.includes('timeline')) return { mode: 'investigate', tags };
  if (tags.includes('recent-summary')) return { mode: 'reconcile', tags };
  if (tags.length > 0) return { mode: 'reconcile', tags };
  return { mode: 'fast', tags: ['simple-recall'] };
}

function mapCandidate(query: string, item: any, cfg: ReturnType<typeof resolveConfig>, corroborationCount: number): MemoryCandidate {
  const metadata = (item?.metadata ?? {}) as Record<string, unknown>;
  const text = String(item?.text ?? '');
  const rawScore = candidateRawScore(item, metadata);
  const timestampMs = extractTimestamp(metadata);
  const signals: CandidateSignals = {
    rawScore,
    recencyScore: recencyScore(timestampMs),
    explicitnessScore: explicitnessScore(text),
    sourceQualityScore: sourceQualityScore(metadata),
    corroborationScore: Math.min(1, corroborationCount / 3),
    lexicalOverlapScore: lexicalOverlapScore(query, text, metadata),
    contradictionPenalty: 0,
    supersededPenalty: 0,
    reasons: [],
    entity: extractEntity(query, text, metadata),
    attribute: extractAttribute(query, text, metadata),
    valueSignature: normalizeValueSignature(text),
  };
  let score = rawScore * 0.3 + signals.recencyScore * cfg.recencyBoost + signals.explicitnessScore * cfg.explicitBoost + signals.sourceQualityScore * 0.1 + signals.corroborationScore * cfg.corroborationBoost + signals.lexicalOverlapScore * 0.22;
  const historical = looksHistoricalQuery(query);
  const vague = isShortVagueQuery(query);
  const noiseSeeking = explicitNoiseSeekingQuery(query);
  if (isCurated(metadata)) { score += cfg.curatedBoost; signals.reasons.push('curated_boost'); }
  const authorityRank = finiteNumber(metadata?.authority_rank) ?? 30;
  score += Math.min(0.24, authorityRank / 420);
  if (metadata?.canonical_project_memory === true || metadata?.source === 'canonical_project_file') { score += 0.2; signals.reasons.push('canonical_project_authority'); }
  const memoryStatus = String(metadata?.memory_status ?? 'active').toLowerCase();
  if (!looksHistoricalQuery(query) && (memoryStatus === 'superseded' || memoryStatus === 'tombstoned')) { score -= 0.8; signals.supersededPenalty += 0.8; signals.reasons.push('explicitly_superseded'); }
  if (isProjectStateMemory(metadata) && !historical) { score += cfg.projectFactBoost; signals.reasons.push('project_fact_boost'); }
  if (signals.lexicalOverlapScore >= 0.34) { signals.reasons.push('lexical_overlap'); }
  if (!vague && signals.lexicalOverlapScore === 0) { score -= 0.12; signals.reasons.push('no_overlap_penalty'); }
  if (queryLooksLikePreference(query) && signals.attribute === 'preference') { score += 0.22; signals.reasons.push('preference_match_boost'); }
  if (queryLooksLikePreference(query) && looksLikeExplicitPreferenceFact(text)) { score += 0.34; signals.reasons.push('explicit_preference_phrase_boost'); }
  if (queryLooksLikePreference(query) && looksLikePreferenceQuestionEcho(text)) { score -= 0.42; signals.reasons.push('preference_question_echo_penalty'); }
  if (isMemorySystemMetaRow(text, metadata) && !queryWantsMemorySystem(query)) { score -= 0.5; signals.reasons.push('memory_system_meta_penalty'); }
  if (isFreshOrCorrectiveFact(text, metadata) && !historical) { score += 0.18; signals.reasons.push('fresh_or_corrective_fact_boost'); }
  if (isStaleNegativeOrOpenWork(query, text, metadata) && !historical) {
    score -= 0.44;
    signals.supersededPenalty += 0.22;
    signals.reasons.push('stale_negative_or_open_work_penalty');
  }
  if (isDurableCandidate(metadata) && vague && !historical) { score -= cfg.durableCandidatePenalty; signals.reasons.push('vague_candidate_penalty'); }
  if (isWhatsappHighSignal(metadata) && vague && !historical) { score -= cfg.noisyWhatsappPenalty; signals.reasons.push('vague_whatsapp_penalty'); }
  if (textMatchesNoise(text) && !noiseSeeking && !historical) { score -= cfg.noisyPatternPenalty; signals.reasons.push('noise_pattern_penalty'); }
  if (isGhostCache(metadata) && !queryIsAboutGhostCache(query)) { score -= 0.65; signals.reasons.push('ghost_cache_penalty'); }
  if (isProbeNoise(metadata, text) && !queryIsAboutProbe(query)) { score -= 0.7; signals.reasons.push('probe_noise_penalty'); }
  if (isLeakyInternalTrace(text) && !queryIsAboutInternalTrace(query)) { score -= 0.9; signals.reasons.push('leaky_internal_trace_penalty'); }
  if (isExecutionTraceNoise(text) && !queryIsAboutExecutionTrace(query)) { score -= 0.85; signals.reasons.push('execution_trace_penalty'); }
  if (isOracleBoilerplate(text, metadata) && !queryWantsOracleBoilerplate(query)) { score -= 0.92; signals.reasons.push('oracle_boilerplate_penalty'); }
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) { score -= 0.55; signals.reasons.push('internal_oracle_penalty'); }
  if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) { score -= 0.35; signals.reasons.push('internal_noise_attribute_penalty'); }
  if (isRecentSummaryQuery(query)) {
    if (isRecentSummaryMemory(metadata, text)) { score += 0.34; signals.reasons.push('recent_summary_boost'); }
    else {
      if (signals.recencyScore < 0.85) { score -= 0.18; signals.reasons.push('stale_for_recent_summary'); }
      if (/connection detail|ip address|ssh|token stored|authentication:|auth profile|credential/i.test(text)) { score -= 0.22; signals.reasons.push('static_detail_penalty'); }
    }
  }
  if (signals.recencyScore >= 0.85) signals.reasons.push('recent');
  if (signals.explicitnessScore >= 0.7) signals.reasons.push('explicit');
  return {
    path: `cortex:${item.id ?? 'unknown'}`,
    startLine: 1,
    endLine: 1,
    score: Math.max(0, Math.min(1, score)),
    snippet: text,
    source: 'memory',
    citation: item?.id ? `cortex:${item.id}` : undefined,
    metadata: { ...metadata, rerank: signals.reasons, rawScore, timestampMs, candidateSignals: signals },
  };
}

function reconcileResults(query: string, items: any[], cfg: ReturnType<typeof resolveConfig>): ReconcileResult {
  const classification = classifyQuery(query);
  const groupedBySignature = new Map<string, number>();
  for (const item of items) {
    const signature = normalizeValueSignature(String(item?.text ?? ''));
    if (!signature) continue;
    groupedBySignature.set(signature, (groupedBySignature.get(signature) ?? 0) + 1);
  }
  const mapped = items.map((item) => mapCandidate(query, item, cfg, groupedBySignature.get(normalizeValueSignature(String(item?.text ?? ''))) ?? 1));
  let visible = mapped.filter((item) => {
    const signals = item.metadata.candidateSignals as CandidateSignals;
    const memoryStatus = String(item.metadata?.memory_status ?? 'active').toLowerCase();
    if (!looksHistoricalQuery(query) && (memoryStatus === 'superseded' || memoryStatus === 'tombstoned')) return false;
    if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) return false;
    if (isGhostCache(item.metadata) && !queryIsAboutGhostCache(query)) return false;
    if (isProbeNoise(item.metadata, item.snippet) && !queryIsAboutProbe(query)) return false;
    if (isLeakyInternalTrace(item.snippet) && !queryIsAboutInternalTrace(query)) return false;
    if (isExecutionTraceNoise(item.snippet) && !queryIsAboutExecutionTrace(query)) return false;
    if (isOracleBoilerplate(item.snippet, item.metadata) && !queryWantsOracleBoilerplate(query)) return false;
    if (isMemorySystemMetaRow(item.snippet, item.metadata) && !queryWantsMemorySystem(query)) return false;
    if (isRecentSummaryQuery(query) && !isRecentSummaryMemory(item.metadata, item.snippet) && (signals.recencyScore < 0.85 || /connection detail|ip address|ssh|token stored|authentication:/i.test(item.snippet))) return false;
    return true;
  });
  const deduped = new Map<string, MemoryCandidate>();
  for (const item of visible) {
    const sig = String((item.metadata.candidateSignals as CandidateSignals).valueSignature ?? item.snippet);
    const existing = deduped.get(sig);
    if (!existing || item.score > existing.score) deduped.set(sig, item);
  }
  visible = Array.from(deduped.values());
  if (isRecentSummaryQuery(query)) {
    const summaryOnly = visible.filter((item) => isRecentSummaryMemory(item.metadata, item.snippet));
    if (summaryOnly.length > 0) visible = summaryOnly;
  }
  const hasFreshFact = visible.some((item) => {
    const signals = item.metadata.candidateSignals as CandidateSignals;
    return isFreshOrCorrectiveFact(item.snippet, item.metadata) && signals.lexicalOverlapScore >= 0.25;
  });
  if (hasFreshFact && !queryWantsNegativeEvidence(query)) {
    visible = visible.filter((item) => {
      if (!isStaleNegativeOrOpenWork(query, item.snippet, item.metadata)) return true;
      const signals = item.metadata.candidateSignals as CandidateSignals;
      signals.supersededPenalty += cfg.conflictPenalty;
      signals.reasons.push('suppressed_by_fresh_fact');
      item.score = Math.max(0, item.score - cfg.conflictPenalty * 2);
      return classification.mode === 'investigate';
    });
  }
  const conflicts: ReconcileResult['conflicts'] = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const aSignals = visible[i].metadata.candidateSignals as CandidateSignals;
      const bSignals = visible[j].metadata.candidateSignals as CandidateSignals;
      if (!queryIsAboutInternalOracle(query) && aSignals.attribute === 'internal_noise' && bSignals.attribute === 'internal_noise') continue;
      if (!detectConflict(aSignals, bSignals)) continue;
      aSignals.contradictionPenalty += cfg.conflictPenalty;
      bSignals.contradictionPenalty += cfg.conflictPenalty;
      visible[i].score = Math.max(0, visible[i].score - cfg.conflictPenalty);
      visible[j].score = Math.max(0, visible[j].score - cfg.conflictPenalty);
      const aTs = Number(visible[i].metadata.timestampMs ?? 0);
      const bTs = Number(visible[j].metadata.timestampMs ?? 0);
      if (aTs && bTs && aTs !== bTs) {
        const older = aTs < bTs ? visible[i] : visible[j];
        older.score = Math.max(0, older.score - cfg.conflictPenalty / 2);
        const olderSignals = older.metadata.candidateSignals as CandidateSignals;
        olderSignals.supersededPenalty += cfg.conflictPenalty / 2;
        olderSignals.reasons.push('likely_superseded');
      }
      conflicts.push({
        entity: aSignals.entity ?? bSignals.entity,
        attribute: aSignals.attribute,
        paths: [visible[i].path, visible[j].path],
        values: [aSignals.valueSignature ?? '', bSignals.valueSignature ?? ''],
      });
    }
  }
  visible.sort((a, b) => (b.score - a.score) || String(a.path).localeCompare(String(b.path)));
  const resolvedFactsMap = new Map<string, { entity?: string; attribute?: string; bestPath: string; supportingPaths: string[]; bestScore: number }>();
  for (const item of visible) {
    const signals = item.metadata.candidateSignals as CandidateSignals;
    const key = `${signals.entity ?? 'unknown'}::${signals.attribute ?? 'unknown'}`;
    const existing = resolvedFactsMap.get(key);
    if (!existing || item.score > existing.bestScore) {
      resolvedFactsMap.set(key, { entity: signals.entity, attribute: signals.attribute, bestPath: item.path, supportingPaths: [item.path], bestScore: item.score });
    } else if (!existing.supportingPaths.includes(item.path)) {
      existing.supportingPaths.push(item.path);
    }
  }
  return {
    mode: classification.mode,
    queryType: classification.tags,
    results: visible.slice(0, classification.mode === 'investigate' ? cfg.hardQueryCandidateCount : items.length),
    resolvedFacts: Array.from(resolvedFactsMap.values()).map(({ bestScore: _bestScore, ...rest }) => rest),
    conflicts,
  };
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cortexWriteHeaders(cfg: Pick<BridgeConfig, 'writeToken' | 'writeTokenHeader'>): Record<string, string> {
  return cfg.writeToken ? { [cfg.writeTokenHeader || 'x-cortex-write-token']: cfg.writeToken } : {};
}
function requireTrustedPrincipalContext(ctx: TrustedPrincipalContext): TrustedPrincipalContext {
  // A callback session is the one non-configurable principal dimension. The
  // shared principal derivation helper deliberately permits configured
  // agent/user/channel fallbacks, and route and memory surfaces must apply
  // that contract identically when OpenClaw supplies a partial callback.
  if (!ctx.sessionKey) {
    throw new Error('memory_search requires trusted invocation context: missing sessionKey');
  }
  if (ctx.senderConflict) {
    throw new Error('memory_search requires an unambiguous trusted sender');
  }
  return ctx;
}
const CORTEX_SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
function canonicalChannelIdentity(cfg: Pick<BridgeConfig, 'channelId'>, ctx: any = {}): string {
  // Native agent hooks separate the transport channel from the conversation
  // channelId. Preserve that distinction before lifecycle context is captured.
  const transport = String(ctx?.channel ?? '').trim();
  if (transport) {
    if (!CORTEX_SCOPE_ID_PATTERN.test(transport)) throw new Error('Cortex channel identity must be a bounded opaque identifier');
    return transport;
  }
  for (const candidate of [ctx?.messageChannel, ctx?.channelId, cfg.channelId]) {
    const normalized = String(candidate || '').trim();
    if (CORTEX_SCOPE_ID_PATTERN.test(normalized)) return normalized;
  }
  throw new Error('Cortex channel identity must be a bounded opaque identifier');
}
function scopedIdentity(cfg: BridgeConfig, ctx: any = {}): Record<string, string> {
  return deriveCortexPrincipal(cfg, ctx);
}
function searchableIdentity(cfg: BridgeConfig, ctx: any = {}): Record<string, string> {
  return deriveCortexKnowledgePrincipal(cfg, ctx);
}
function memoryScopeFields(cfg: BridgeConfig, scope: Record<string, string>): Record<string, string> {
  const secret = String(cfg.scopeHmacSecret || '');
  const tenantId = String(scope.tenant_id || '').trim();
  const workspaceId = String(scope.workspace_id || '').trim();
  if (!tenantId || !workspaceId) throw new Error('tenantId and workspaceId are required for scoped Cortex memory access');
  const credentialId = String(cfg.scopeCredentialId || '').trim();
  if (!secret.trim() || !credentialId) {
    if (cfg.allowUnsignedLocalDevelopment === true && tenantId === 'cortex-local' && workspaceId === 'default') {
      return { tenant_id: tenantId, workspace_id: workspaceId };
    }
    throw new Error('scopeCredentialId and scopeHmacSecret are required for Cortex memory access unless allowUnsignedLocalDevelopment is explicitly enabled for cortex-local/default');
  }
  const signature = createHmac('sha256', secret)
    .update(['cortex.memory.principal.v2', credentialId, tenantId, workspaceId, scope.agent_id, scope.user_id, scope.channel_id, scope.session_id].join('\n'), 'utf8')
    .digest('hex');
  return { tenant_id: tenantId, workspace_id: workspaceId, scope_credential_id: credentialId, scope_signature: signature };
}
function scopedHeaders(cfg: BridgeConfig, scope: Record<string, string>): Record<string, string> {
  const memoryScope = memoryScopeFields(cfg, scope);
  return {
    ...cortexWriteHeaders(cfg),
    'x-cortex-tenant-id': memoryScope.tenant_id,
    'x-cortex-workspace-id': memoryScope.workspace_id,
    'x-cortex-agent-id': scope.agent_id,
    'x-cortex-user-id': scope.user_id,
    'x-cortex-channel-id': scope.channel_id,
    'x-cortex-session-id': scope.session_id,
    ...(memoryScope.scope_credential_id ? { 'x-cortex-scope-credential-id': memoryScope.scope_credential_id } : {}),
    ...(memoryScope.scope_signature ? { 'x-cortex-scope-signature': memoryScope.scope_signature } : {}),
  };
}
function boundedLifecycleIdentity(value: unknown, field: string, maxLength: number): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`lifecycle callback requires trusted ${field}`);
  if (normalized.length > maxLength) throw new Error(`lifecycle callback ${field} exceeds ${maxLength} characters`);
  return normalized;
}
function canonicalLifecycleContext(cfg: BridgeConfig, ctx: any = {}, idempotencyKey = ''): LifecycleSpoolRecord['context'] {
  assertOwnerBoundFallbackIdentity(cfg, ctx);
  const callbackSender = String(ctx?.senderId || ctx?.requesterSenderId || '').trim();
  const trusted = captureTrustedPrincipalContext(ctx, {
    senderId: String(cfg.ownerSenderId || cfg.userId || '').trim(),
    userId: cfg.userId,
    channelId: cfg.channelId,
    agentId: cfg.agentId,
  });
  const session = boundedLifecycleIdentity(
    trusted.sessionKey,
    'session identity',
    512,
  );
  const sender = String(trusted.senderId || '').trim();
  if (!sender || trusted.senderConflict) {
    throw new Error('lifecycle memory requires an unambiguous trusted sender');
  }
  return {
    sessionKey: session,
    sessionId: session,
    // OpenClaw lifecycle hooks are not guaranteed to repeat fixed principal
    // dimensions. They must still provide the per-run session identity; the
    // remaining values may fall back only to this plugin's configured scope.
    // Cortex subsequently verifies the complete HMAC-signed scope against the
    // credential allow-list, so these defaults cannot broaden authorization.
    channelId: canonicalChannelIdentity(cfg, trusted),
    agentId: boundedLifecycleIdentity(trusted.agentId, 'agent identity', 256),
    userId: boundedLifecycleIdentity(trusted.userId, 'user identity', 256),
    // Preserve an actual callback sender, or the explicitly configured owner
    // binding.  A generic configured user fallback is enough to complete a
    // session-only principal, but must not be relabeled as callback evidence.
    ...(callbackSender || cfg.ownerSenderId ? { senderId: sender } : {}),
    idempotencyKey,
  };
}
function lifecyclePrincipal(cfg: BridgeConfig, context: LifecycleSpoolRecord['context']): LifecyclePrincipal {
  const scope = scopedIdentity(cfg, context);
  return {
    version: 1,
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    scope_credential_id: String(cfg.scopeCredentialId || '').trim() || 'unsigned-local-development',
    agent_id: scope.agent_id,
    user_id: scope.user_id,
    channel_id: scope.channel_id,
    session_id: scope.session_id,
  };
}
function lifecyclePrincipalNamespace(cfg: BridgeConfig, principal: LifecyclePrincipal): string {
  const scopeSecret = String(cfg.scopeHmacSecret || '');
  const namespaceSecret = scopeSecret.trim() ? scopeSecret : String(cfg.sessionIdentityHmacSecret || '');
  if (!namespaceSecret.trim()) throw new Error('lifecycle principal namespace requires a provisioned HMAC secret');
  const canonical = JSON.stringify([
    'cortex.lifecycle.principal.v2',
    ...LIFECYCLE_PRINCIPAL_FIELDS.map((field) => principal[field]),
  ]);
  return createHmac('sha256', namespaceSecret).update(canonical, 'utf8').digest('hex');
}
function lifecyclePrincipalsEqual(left: LifecyclePrincipal, right: LifecyclePrincipal): boolean {
  return left.version === right.version
    && LIFECYCLE_PRINCIPAL_FIELDS.every((field) => left[field] === right[field]);
}
function loadLifecycleSpools(
  cfg: ReturnType<typeof resolveConfig>,
  logger: { warn?: (message: string) => void },
): { root: string; spools: Map<string, DurableLifecycleSpool>; quota: DurableLifecycleQuota } {
  const stateRoot = cfg.stateDir;
  durableLifecycleMkdir(stateRoot);

  const legacyFile = path.join(stateRoot, 'lifecycle-spool.json');
  if (fs.existsSync(legacyFile)) {
    const quarantined = quarantineLifecycleFile(legacyFile, 'legacy-unscoped');
    logger.warn?.(`cortex-memory-bridge: quarantined unscoped lifecycle spool at ${quarantined}`);
  }

  const principalRoot = path.join(stateRoot, 'lifecycle-principals-v2');
  durableLifecycleMkdir(principalRoot);
  const quota = new DurableLifecycleQuota(principalRoot, cfg.lifecycleSpoolMaxRecords);
  return quota.runExclusive(() => {
    const spools = new Map<string, DurableLifecycleSpool>();
    let loadedRecords = 0;
    const entries = quota.restartEntries()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) continue;
      const namespaceDir = path.join(principalRoot, entry.name);
      const spoolFile = path.join(namespaceDir, 'lifecycle-spool.json');
      if (!fs.existsSync(spoolFile)) {
        quota.reapNamespace(entry.name);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(spoolFile, 'utf8'));
      } catch (error) {
        throw new Error(`invalid Cortex lifecycle spool; refusing replay; ${safeFailureSummary(error)}`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error('invalid Cortex lifecycle spool; refusing replay');
      }
      if (parsed.length > cfg.lifecycleSpoolMaxRecords) {
        const quarantined = quarantineLifecycleFile(spoolFile, 'global-quota-overflow');
        logger.warn?.(`cortex-memory-bridge: quarantined oversized lifecycle spool for bounded recovery at ${quarantined}`);
        continue;
      }
      if (parsed.length === 0) {
        try { fs.unlinkSync(spoolFile); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
        quota.reapNamespace(entry.name);
        continue;
      }
      if (parsed.every((record: any) => record?.version === 1 && !record?.principal)) {
        const quarantined = quarantineLifecycleFile(spoolFile, 'legacy-unscoped');
        logger.warn?.(`cortex-memory-bridge: quarantined unscoped lifecycle spool at ${quarantined}`);
        continue;
      }
      if (!parsed.every(isLifecycleSpoolRecord)) {
        throw new Error('invalid Cortex lifecycle spool; refusing replay');
      }
      const records = parsed as LifecycleSpoolRecord[];
      const matchesActivePrincipal = records.every((record) => {
        try {
          const currentNamespace = lifecyclePrincipalNamespace(cfg, record.principal);
          const configuredCredential = String(cfg.scopeCredentialId || '').trim() || 'unsigned-local-development';
          const boundToConfiguration = record.principal.tenant_id === cfg.tenantId
            && record.principal.workspace_id === cfg.workspaceId
            && record.principal.scope_credential_id === configuredCredential
            && currentNamespace === entry.name
            && record.key.startsWith(`${currentNamespace}:`);
          if (!boundToConfiguration) return false;
          if (parseLifecyclePayloadMetadata(record)) {
            return record.context.sessionKey === record.principal.session_id
              && record.context.sessionId === record.principal.session_id
              && record.context.channelId === record.principal.channel_id
              && record.context.agentId === record.principal.agent_id
              && record.context.userId === record.principal.user_id
              && record.context.idempotencyKey === record.key;
          }
          const currentContext = canonicalLifecycleContext(cfg, record.context, record.key);
          const currentPrincipal = lifecyclePrincipal(cfg, currentContext);
          return lifecyclePrincipalsEqual(record.principal, currentPrincipal);
        } catch {
          return false;
        }
      });
      if (!matchesActivePrincipal) {
        const quarantined = quarantineLifecycleFile(spoolFile, 'principal-scope-mismatch');
        logger.warn?.(`cortex-memory-bridge: quarantined lifecycle spool with inactive principal scope at ${quarantined}`);
        continue;
      }
      if (loadedRecords + records.length > cfg.lifecycleSpoolMaxRecords) {
        const quarantined = quarantineLifecycleFile(spoolFile, 'global-quota-overflow');
        logger.warn?.(`cortex-memory-bridge: quarantined overflow lifecycle spool for bounded recovery at ${quarantined}`);
        continue;
      }
      loadedRecords += records.length;
      spools.set(entry.name, new DurableLifecycleSpool(namespaceDir, cfg.lifecycleSpoolMaxRecords));
    }
    return { root: principalRoot, spools, quota };
  });
}
function searchResponseUnavailable(response: any): string | null {
  if (!response || typeof response !== 'object') return 'invalid search response';
  if (response.disabled === true || response.available === false) return 'search backend unavailable';
  if (typeof response.error === 'string' && response.error.trim()) return 'search backend reported an error';
  const mode = String(response.search_mode ?? response.mode ?? '').trim().toLowerCase();
  if (['disabled', 'error', 'failed', 'none', 'unavailable'].includes(mode)) return `search mode ${mode}`;
  return null;
}
function safeFailureMetadata(error: unknown): { type: string; code?: string; status?: number; detailHash: string } {
  const candidate = error as any;
  const rawType = error instanceof Error ? error.name : typeof error;
  const type = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawType) ? rawType : 'Error';
  const rawCode = typeof candidate?.code === 'string' ? candidate.code : '';
  const status = Number(candidate?.status);
  return {
    type,
    ...(rawCode && /^[A-Z0-9_]{1,64}$/.test(rawCode) ? { code: rawCode } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    detailHash: createHash('sha256').update(String(candidate?.message ?? error ?? ''), 'utf8').digest('hex'),
  };
}
function safeFailureSummary(error: unknown): string {
  const metadata = safeFailureMetadata(error);
  return `type=${metadata.type}${metadata.code ? ` code=${metadata.code}` : ''}${metadata.status ? ` status=${metadata.status}` : ''} detail_hash=${metadata.detailHash}`;
}
function retryableError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  return /aborted|AbortError|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|HTTP 408|HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(msg);
}
async function postJson(baseUrl: string, route: string, body: unknown, timeoutMs: number, retryCount = 0, retryBackoffMs = 250, maxResponseBytes = 1_048_576, writeHeaders: Record<string, string> = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...writeHeaders }, body: JSON.stringify(body), signal: controller.signal });
      const cap = maxResponseBytes;
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > cap) {
        try { void res.body?.cancel().catch(() => {}); } catch {}
        throw new Error(`response exceeds ${cap} bytes`);
      }
      const reader = res.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > cap) { try { void reader.cancel().catch(() => {}); } catch {} throw new Error(`response exceeds ${cap} bytes`); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder().decode(bytes);
      if (!res.ok) {
        let safeUpstreamCode = '';
        try {
          const parsed = JSON.parse(text);
          const candidate = String(parsed?.detail?.error ?? parsed?.error ?? '');
          if ([
            'assurance_receipt_expired_without_commit',
            'assurance_receipt_commit_outcome_unknown',
            'interaction_not_eligible_for_commit',
            'interaction_no_longer_eligible_for_commit',
          ].includes(candidate)) safeUpstreamCode = candidate;
        } catch {}
        const upstreamError = new Error(`upstream HTTP ${res.status}; body_bytes=${size}; body_hash=${createHash('sha256').update(text, 'utf8').digest('hex')}${safeUpstreamCode ? `; upstream_code=${safeUpstreamCode}` : ''}`) as Error & { status?: number };
        upstreamError.status = res.status;
        throw upstreamError;
      }
      if (!text) return {};
      try { return JSON.parse(text); } catch {
        throw new Error(`invalid upstream JSON; body_bytes=${size}; body_hash=${createHash('sha256').update(text, 'utf8').digest('hex')}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !retryableError(error)) throw error;
      await sleep(retryBackoffMs * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error(`unknown memory bridge error; detail_hash=${createHash('sha256').update(String(lastError || ''), 'utf8').digest('hex')}`);
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  if (obj.type === 'thinking' || typeof obj.thinkingSignature === 'string' || typeof obj.encrypted_content === 'string') return '';
  if (typeof obj.customType === 'string' && obj.display === false) return '';
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.content)) {
    const contentText = obj.content.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (contentText) return contentText;
  }
  if (typeof obj.role === 'string' && Array.isArray(obj.content)) {
    const roleContent = obj.content.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (roleContent) return roleContent;
  }
  if (Array.isArray(obj.messages)) {
    const msgText = obj.messages.map((m) => extractText(m)).filter(Boolean).join('\n');
    if (msgText) return msgText;
  }
  if (Array.isArray(obj.payloads)) {
    const payloadText = obj.payloads.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (payloadText) return payloadText;
  }
  if (typeof obj.type === 'string' && obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  return Object.values(obj).map(extractText).filter(Boolean).join('\n');
}

function extractLatestAssistantVisibleText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || (message as Record<string, unknown>).role !== 'assistant') continue;
    const text = extractText((message as Record<string, unknown>).content ?? message).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}
function extractAssistantVisibleText(messages: unknown): string {
  return extractLatestAssistantVisibleText(messages);
}
function extractCurrentTurnAssistantText(event: any): string {
  if (event?.success === false || !Array.isArray(event?.messages)) return '';
  const messages = event.messages;
  const userIndex = messages.findLastIndex((message: any) => message?.role === 'user');
  if (userIndex < 0) return '';
  for (let index = messages.length - 1; index > userIndex; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    // Only rendered text counts. Tool arguments, reasoning and old assistant
    // history must never become this turn's durable memory or continuity.
    const text = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .map((part: any) => part.text).join('\n') : '';
    return text.replace(/\s+/g, ' ').trim();
  }
  return '';
}
function extractLlmOutputText(event: any): string {
  const assistantTexts = Array.isArray(event?.assistantTexts) ? event.assistantTexts : [];
  for (let index = assistantTexts.length - 1; index >= 0; index -= 1) {
    const text = extractText(assistantTexts[index]).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  const lastAssistant = extractText(event?.lastAssistant).replace(/\s+/g, ' ').trim();
  if (lastAssistant) return lastAssistant;
  const latestAssistant = extractLatestAssistantVisibleText(event?.messages);
  if (latestAssistant) return latestAssistant;
  // Older OpenClaw lifecycle callbacks expose the correlated output directly
  // as `content`; retaining that shape is required for upgrade compatibility.
  return extractText(event?.content).replace(/\s+/g, ' ').trim();
}
function extractLatestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || (message as Record<string, unknown>).role !== 'user') continue;
    const text = extractText((message as Record<string, unknown>).content ?? message).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function extractDirectUserMemoryRequest(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || message.role !== 'user') continue;
    // Worker announcements also use role=user. Do not search backward past an
    // ineligible latest turn, flatten content blocks, or promote provenance text
    // into a new human instruction. This is the legacy raw-message path; the
    // current native projection requires its separate recorder envelope below.
    const internal = message.__openclaw;
    if (typeof message.content !== 'string'
        || Object.prototype.hasOwnProperty.call(message, 'provenance')
        || (internal && typeof internal === 'object' &&
          (internal.senderIsOwner === false || Object.prototype.hasOwnProperty.call(internal, 'provenance')))) return '';
    return message.content.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function extractCorrelatedNativeUserMemoryRequest(event: any, ctx: any, cfg: BridgeConfig): string {
  // Only the native recorder envelope can restore eligibility lost by the
  // model-facing user-message projection. Presence of a rejected/null envelope
  // is authoritative: never fall back to interpreting projected text as human.
  if (!Object.prototype.hasOwnProperty.call(event || {}, 'cortexCurrentUserInput')) {
    return extractDirectUserMemoryRequest(event?.messages);
  }
  const input = event.cortexCurrentUserInput;
  const invocation = captureTrustedPrincipalContext(ctx);
  if (!input || input.version !== 'openclaw.current-user-input.v1'
      || input.senderIsOwner !== true || input.provenancePresent !== false
      || invocation.senderConflict || !invocation.senderId
      || invocation.senderId !== String(cfg.ownerSenderId || '').trim()
      || typeof ctx?.runId !== 'string' || !ctx.runId
      || input.runId !== ctx.runId
      || (event.runId !== undefined && event.runId !== ctx.runId)
      || input.sessionKey !== invocation.sessionKey
      || input.agentId !== invocation.agentId
      || input.senderId !== invocation.senderId
      || !Number.isFinite(input.timestamp)
      || typeof input.content !== 'string' || input.content.length > 2000
      || !Array.isArray(event.messages)) return '';
  const latest = event.messages.findLast((message: any) => message?.role === 'user');
  if (!latest || latest.timestamp !== input.timestamp
      || Object.prototype.hasOwnProperty.call(latest, 'provenance')
      || (latest.__openclaw && typeof latest.__openclaw === 'object' &&
        (latest.__openclaw.senderIsOwner === false
          || Object.prototype.hasOwnProperty.call(latest.__openclaw, 'provenance')))) return '';
  const parts = latest.content;
  const projected = typeof parts === 'string' ? parts
    : Array.isArray(parts) && parts.length > 0
      && parts.every((part: any) => part?.type === 'text' && typeof part.text === 'string')
      ? parts.map((part: any) => part.text).join('\n') : '';
  const source = input.content.replace(/\s+/g, ' ').trim();
  return source && projected.replace(/\s+/g, ' ').trim() === source ? source : '';
}

const PROJECT_NEGATION_FILLER = '(?:a|an|any|the|production|live|deployment|configuration|config|code|project|changes?|work|touch(?:ed|ing)?|modif(?:y|ied|ying)|affect(?:ed|ing)?|chang(?:e|ed|ing)|related|directly|made|performed|applied|introduced|was|were|is|are|does|did|to|for|in|on|of)';
function projectMentionIsNegated(text: string, index: number, length: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf(';', index - 1),
    text.lastIndexOf('\n', index - 1),
    text.lastIndexOf('\u2014', index - 1),
  ) + 1;
  const followingBoundaries = [
    text.indexOf('.', index + length),
    text.indexOf(';', index + length),
    text.indexOf('\n', index + length),
    text.indexOf('\u2014', index + length),
  ].filter((boundary) => boundary >= 0);
  const clauseEnd = followingBoundaries.length > 0 ? Math.min(...followingBoundaries) : text.length;
  const before = text.slice(clauseStart, index).toLowerCase();
  const after = text.slice(index + length, clauseEnd).toLowerCase();
  const negatedBefore = new RegExp(
    `\\b(?:no|not|never|without|excluding|except)\\s+(?:${PROJECT_NEGATION_FILLER}\\s+){0,6}$`,
  ).test(before) || /\b(?:unrelated|outside)\s+(?:of|to)?\s*$/.test(before);
  const negatedAfter = new RegExp(
    `^\\s*(?:${PROJECT_NEGATION_FILLER}\\s+){0,5}(?:(?:was|were|is|are|has|have|had)\\s+)?(?:not\\s+(?:changed|modified|touched|affected)|no\\s+(?:changes?|work)|unchanged|untouched|excluded|out\\s+of\\s+scope)\\b`,
  ).test(after);
  return negatedBefore || negatedAfter;
}

function hasAffirmedProjectMention(text: string, expression: RegExp): boolean {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
  for (const match of text.matchAll(new RegExp(expression.source, flags))) {
    const index = match.index ?? -1;
    if (index >= 0 && !projectMentionIsNegated(text, index, match[0].length)) return true;
  }
  return false;
}

function detectProjectSlug(text: string): string | null {
  const t = normalizeQuery(text);
  if (hasAffirmedProjectMention(t, /\bmailchimp\b/i)) return 'mailchimp';
  if (hasAffirmedProjectMention(t, /\bprofit tournament\b/i)) return 'profit-tournament';
  if (hasAffirmedProjectMention(t, /\b(?:professional\s+)?(?:website|web)[- ]design(?:\s+learning)?\b/i)) return 'learning-os-website-design';
  if (hasAffirmedProjectMention(t, /\b(?:cortex[- ]?)?learning[- ]os\b/i)) return 'cortex-learning-os';
  if (hasAffirmedProjectMention(t, /\bpmhnp\b|\bclaim guard\b/i)) return 'pmhnp-claim-guard';
  return null;
}

const SECRET_DISCUSSION_WORDS = new Set([
  'configuration', 'configurations', 'configured', 'credential', 'credentials',
  'deployment', 'environment', 'example', 'examples', 'format', 'formats',
  'handling', 'installation', 'installations', 'material',
  'management', 'manager', 'masked', 'missing', 'placeholder', 'placeholders',
  'policies', 'policy',
  'provided', 'provisioned', 'redacted', 'required', 'requirement', 'requirements',
  'rotation', 'rotations', 'securely', 'should', 'storage', 'through', 'value',
  'values', 'variable', 'variables', 'without',
]);
function containsSecretLike(text: string): boolean {
  const value = String(text || '');
  if (/-----BEGIN [A-Z ]+ PRIVATE KEY-----/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i.test(value)
    || /\b(?:(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key|webhook[_-]?secret)|api[ -]?key|access[ -]?token|auth[ -]?token|webhook[ -]?secret|token|password|secret)\s*[:=]\s*[\"'`]?[^\s,;\"'`]{6,}/i.test(value)
    || /\b(?:sk|rk|pk)[_-](?:live|test|proj)[_-][A-Za-z0-9_-]{8,}/i.test(value)
    || /\bgh[pousr]_[A-Za-z0-9]{20,}/i.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value)
    || /\bxox[a-z]-[A-Za-z0-9-]{12,}/i.test(value)
    || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)
    || /\bssh-rsa\s+[A-Za-z0-9+/]{32,}={0,3}/i.test(value)) return true;

  const assignedAdjacentValue = /\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|webhook[_ -]?secret|token|password|passwd|secret)\s+(?:is|was|equals|value(?:\s+is)?|set\s+to)\s+[\"'`]?([A-Za-z0-9][A-Za-z0-9._~+\/-]{3,})/gi;
  const directAdjacentValue = /\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|webhook[_ -]?secret|token|password|passwd|secret)\s+[\"'`]?([A-Za-z0-9][A-Za-z0-9._~+\/-]{5,})/gi;
  for (const match of [...value.matchAll(assignedAdjacentValue), ...value.matchAll(directAdjacentValue)]) {
    const candidate = String(match[1] || '').toLowerCase();
    if (!SECRET_DISCUSSION_WORDS.has(candidate)) return true;
  }
  return false;
}

function statusMatchIsNegated(text: string, index: number, length: number, windowWords = 6): boolean {
  const lowered = String(text || '').toLowerCase();
  const clauseStart = Math.max(
    lowered.lastIndexOf('.', index - 1),
    lowered.lastIndexOf(';', index - 1),
    lowered.lastIndexOf('\n', index - 1),
    lowered.lastIndexOf('\u2014', index - 1),
  ) + 1;
  const following = [
    lowered.indexOf('.', index + length),
    lowered.indexOf(';', index + length),
    lowered.indexOf('\n', index + length),
    lowered.indexOf('\u2014', index + length),
  ].filter((boundary) => boundary >= 0);
  const clauseEnd = following.length > 0 ? Math.min(...following) : lowered.length;
  const before = lowered.slice(clauseStart, index);
  const after = lowered.slice(index + length, clauseEnd);
  const filler = `(?:\\s+[a-z0-9_-]+){0,${Math.max(0, windowWords)}}`;
  const negatedBefore = new RegExp(`\\b(?:no|not|never|without|neither)${filler}\\s*$`).test(before);
  const negatedAfter = new RegExp(
    `^\\s*(?:[a-z0-9_-]+\\s+){0,${Math.max(0, windowWords - 1)}}(?:(?:was|were|is|are|has|have|had)\\s+)?(?:not\\b|no\\b|unchanged\\b|untouched\\b|excluded\\b|unrelated\\b|outside\\b)`,
  ).test(after);
  return negatedBefore || negatedAfter;
}

function hasAffirmedStatusMatch(text: string, expression: RegExp): boolean {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
  for (const match of String(text || '').matchAll(new RegExp(expression.source, flags))) {
    const index = match.index ?? -1;
    if (index >= 0 && !statusMatchIsNegated(text, index, match[0].length)) return true;
  }
  return false;
}

function hasIncompleteTestPassRatio(text: string): boolean {
  for (const match of String(text || '').matchAll(/\b(?:focused\s+)?tests?\s*:?\s*(\d+)\s*\/\s*(\d+)\s+passed\b/gi)) {
    const passed = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isSafeInteger(passed) || !Number.isSafeInteger(total) || passed <= 0 || total <= 0 || passed !== total) return true;
  }
  return false;
}
function summarizeShape(value: unknown, depth = 0): unknown {
  if (depth > 2) return typeof value;
  if (value == null) return value;
  if (typeof value === 'string') return { type: 'string', len: value.length, sha256: createHash('sha256').update(value, 'utf8').digest('hex') };
  if (typeof value !== 'object') return { type: typeof value };
  if (Array.isArray(value)) return { type: 'array', len: value.length, itemTypes: value.slice(0, 8).map((v) => typeof v) };
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).slice(0, 12);
  const fields = entries.map(([key, nested]) => ({
    keyHash: createHash('sha256').update(key, 'utf8').digest('hex'),
    value: summarizeShape(nested, depth + 1),
  }));
  return { type: 'object', keyCount: Object.keys(obj).length, fields };
}
function durabilityScore(text: string): { score: number; reasons: string[]; kind: string } {
  const t = text.trim();
  const statusText = t.replace(/[*_`]/g, '');
  const reasons: string[] = [];
  let score = 0;
  let kind = 'transient';
  if (!t || t.length < 20) return { score: 0, reasons: ['too_short'], kind };
  if (/\b(supervisorstatus|matrixstatus|paritystatus)\b|\bcanonical status\b|\bremaining surfaces\b|\bremaining unsatisfied surfaces\b|\bwhat this run actually changed\b|\bblocker\s*:\s*|\btrustworthy partial result\b/i.test(t)) { score += 0.58; reasons.push('canonical_project_status'); kind = 'project_state'; }
  const incompleteTestRatio = hasIncompleteTestPassRatio(statusText);
  const completionEvidence = {
    completion: hasAffirmedStatusMatch(statusText, /\b(?:complete|completed|finished|implemented|delivered|saved)\b/i),
    commit: hasAffirmedStatusMatch(statusText, /\bcommitted\b|\bcommit\s*:\s*[0-9a-f]{7,40}\b/i),
    tests: !incompleteTestRatio && hasAffirmedStatusMatch(
      statusText,
      /\b(?:focused\s+)?tests?\s*:?\s*(?:\d+\s*\/\s*\d+\s+)?passed\b|\b(?:validation|verification|replay|safety scans?)\b[^.;\n]{0,80}\bpassed\b|\btested(?:\s+(?:successfully|cleanly))?\b/i,
    ),
    clean: hasAffirmedStatusMatch(
      statusText,
      /\b(?:remote\s+)?worktree\s+(?:is\s+|was\s+)?clean\b|\bworking tree\s+(?:is\s+|was\s+)?clean\b/i,
    ),
  };
  const completionEvidenceCount = Object.values(completionEvidence).filter(Boolean).length;
  const durableCompletion = !incompleteTestRatio && completionEvidenceCount >= 3
    && (completionEvidence.completion || completionEvidence.commit);
  if (durableCompletion) {
    score += 0.64;
    reasons.push('durable_completion_checkpoint');
    if (completionEvidence.commit) reasons.push('commit_evidence');
    if (completionEvidence.tests) reasons.push('test_evidence');
    if (completionEvidence.clean) reasons.push('clean_worktree');
    if (kind === 'transient') kind = 'completion_state';
  }
  if (durableCompletion && /\b(?:remaining work|remaining (?:steps|tasks|surfaces)|still (?:need|needs|requires|no)|next (?:phase|step|action)|what remains|left to do|open (?:work|items|gaps|loops))\b/i.test(statusText)) {
    score += 0.12;
    reasons.push('remaining_work_boundary');
  }
  if (durableCompletion && /\bnot (?:pushed|deployed)\b|\bnot pushed or deployed\b|\bdeployment\s+(?:is\s+|was\s+)?(?:pending|not performed)\b/i.test(statusText)) {
    score += 0.08;
    reasons.push('deployment_boundary');
  }
  if (/\bremember this\b|\bplease remember\b|\bmy preference\b|\bi prefer\b|\bcall me\b|\btimezone\b|\bpronouns\b/i.test(t)) { score += 0.45; reasons.push('explicit_preference'); kind = 'preference'; }
  if (/\bdecision\b|\bwe decided\b|\bthe plan is\b|\bfrom now on\b|\bdefault to\b|\balways use\b/i.test(t)) { score += 0.35; reasons.push('decision'); kind = 'decision'; }
  if (/\bcorrection\s*:|\bcorrected\b|\bwas wrong\b|\bwe later verified\b|\bdurable project record\b/i.test(t)) { score += 0.46; reasons.push('corrected_durable_fact'); if (kind === 'transient') kind = 'fact'; }
  if (/\breply-anchor context .* primary\b|\breply anchor .* primary\b|\bpersistence first\b/i.test(t)) { score += 0.2; reasons.push('anti_drift_or_lesson'); if (kind === 'transient') kind = 'decision'; }
  if (/\bproject\b|\barchitecture\b|\bsetup\b|\bconnection details\b|\bssh\b|\bendpoint\b/i.test(t)) { score += 0.22; reasons.push('project_fact'); if (kind === 'transient') kind = 'fact'; }
  if (detectProjectSlug(t)) { score += 0.16; reasons.push('named_project'); if (kind === 'transient') kind = 'fact'; }
  if (/\b(today|right now|currently|just now|this morning|tonight|lol|haha|thanks|ok|okay|sure)\b/i.test(t)) { score -= 0.18; reasons.push('transient_chat'); }
  if (/https?:\/\/\S+/.test(t) && t.length < 140) { score -= 0.18; reasons.push('bare_link'); }
  if (containsSecretLike(t)) { score = 0; reasons.push('secret_like'); kind = 'blocked'; }
  return { score: Math.max(0, Math.min(1, score)), reasons, kind };
}
function buildWriteThroughMetadata(cfg: ReturnType<typeof resolveConfig>, ctx: any, text: string, dur: ReturnType<typeof durabilityScore>) {
  const project = detectProjectSlug(text);
  const scopedIdentity = searchableIdentity(cfg, ctx);
  const scopedSessionId = scopedIdentity.session_id;
  const tags = Array.from(new Set([...(cfg.writeTags || []), ...dur.reasons, ...(project ? [project] : [])]));
  let source = 'openclaw-lifecycle-candidate';
  let topic: string | undefined;
  if (dur.kind === 'project_state') {
    source = 'openclaw-project-state-candidate';
    topic = project ? `${project}-canonical-status` : 'canonical-project-status';
  } else if (dur.kind === 'completion_state') {
    source = 'openclaw-completion-candidate';
    topic = project ? `${project}-completion-checkpoint` : 'completion-checkpoint';
  } else if (dur.kind === 'preference') {
    source = 'openclaw-preference-candidate';
    topic = 'preferences';
  } else if (dur.kind === 'decision') {
    source = 'openclaw-decision-candidate';
    topic = project ? `${project}-durable-decision` : 'durable-decision';
  }
  const subject = project || 'owner';
  const predicate = dur.kind === 'preference' ? 'prefers'
    : dur.kind === 'decision' ? 'decided'
      : dur.kind === 'completion_state' ? 'completion_state'
        : dur.kind === 'project_state' ? 'project_state'
          : 'asserts';
  const claimKey = `${subject}:${topic || predicate}`;
  const sourceId = `src_${createHash('sha256').update([
    'cortex.openclaw.lifecycle-source.v1',
    scopedIdentity.agent_id,
    scopedIdentity.user_id,
    scopedIdentity.channel_id,
  ].join('\0'), 'utf8').digest('hex').slice(0, 48)}`;
  const valueHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const factKey = `fact_${createHash('sha256').update([
    'cortex.openclaw.lifecycle-fact.v1', claimKey, valueHash, sourceId,
  ].join('\0'), 'utf8').digest('hex').slice(0, 48)}`;
  return {
    channel: canonicalChannelIdentity(cfg, ctx),
    sessionKey: scopedSessionId,
    source,
    quality: 'candidate',
    assurance_status: 'unvalidated',
    memory_kind: dur.kind,
    tags,
    project: project ?? undefined,
    topic,
    source_id: sourceId,
    subject,
    predicate,
    fact_scope: project || 'owner-global',
    claim_key: claimKey,
    fact_key: factKey,
    candidate_fact: true,
    evidence_count: 1,
    required_evidence_count: 2,
    confidence: dur.score,
    provenance: 'openclaw-lifecycle-assurance-candidate',
    memory_status: 'active',
    authority_rank: 30,
    memory_schema_version: 'cortex.memory.governance.v1',
    correction_memory: /\bcorrection\s*:|\bcorrected\b|\bcurrent canonical status\b/i.test(text),
  };
}

async function maybeWriteCodecContinuity(api: OpenClawPluginApi, cfg: ReturnType<typeof resolveConfig>, event: any, ctx: any, fallbackText?: string) {
  if (cfg.enabledCodecContinuity === false) return 'disabled' as const;
  if (!String(cfg.sessionIdentityHmacSecret || '').trim()) {
    api.logger.warn?.('cortex-memory-bridge: Codec continuity requires sessionIdentityHmacSecret shared with cortex-route-gate');
    return 'failed' as const;
  }
  const rawSessionKey = String(ctx?.sessionKey || ctx?.sessionId || '').trim();
  if (!rawSessionKey) return 'failed' as const;
  const text = [extractAssistantVisibleText(event?.messages), extractText(event?.result), String(fallbackText || '')]
    .filter(Boolean).join('\n').replace(/\s+/g, ' ').trim().slice(-2400);
  if (text.length < 20 || containsSecretLike(text)) return 'skipped' as const;
  try {
    const scope = scopedIdentity(cfg, ctx);
    const sessionKey = scope.session_id;
    // Codec acknowledges its server-derived full-principal namespace, not the
    // caller's session_id. Match the canonical backend isolation_key contract.
    const acknowledgedSessionKey = `principal:${createHash('sha256').update([
      'codec-session', scope.tenant_id, scope.workspace_id, scope.agent_id,
      scope.user_id, scope.channel_id, scope.session_id,
    ].join('\0'), 'utf8').digest('hex')}`;
    const response = await postJson(cfg.baseUrl, cfg.codecEventsPath, {
      idempotency_key: ctx?.idempotencyKey,
      session_key: sessionKey,
      events: [{ text, tags: ['openclaw', 'session-continuity'], metadata: { source: 'cortex-memory-bridge', channel: canonicalChannelIdentity(cfg, ctx), scope } }],
      max_chars: 1200,
      acknowledgement_only: true,
      scope,
      ...memoryScopeFields(cfg, scope),
    }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, scopedHeaders(cfg, scope));
    const acknowledgement = response?.acknowledgement;
    if (response?.success !== true
      || acknowledgement?.version !== 'nexus.codec-write-ack.v1'
      || acknowledgement?.status !== 'accepted'
      || acknowledgement?.session_key !== acknowledgedSessionKey
      || acknowledgement?.event_count !== 1
      || typeof acknowledgement?.state_fingerprint !== 'string'
      || !acknowledgement.state_fingerprint) {
      throw new Error('Codec continuity endpoint did not issue the bounded write acknowledgement');
    }
    return 'succeeded' as const;
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: Codec continuity write failed ${safeFailureSummary(error)}`);
    return 'failed' as const;
  }
}
function explicitUserMemoryCandidate(userText: string, assistantText: string): { fact: string; text: string } | null {
  // Only a direct request plus a positive acknowledgment qualifies. Text quoted
  // by tools, questions about memory, and a refused request are not commands.
  const match = /^(?:please\s+)?remember(?:\s+this)?(?:\s*:\s*|\s+(?:that\s+)?)(.+)$/i.exec(userText.trim());
  if (!match) return null;
  const fact = match[1].trim();
  if (fact.length < 8 || fact.length > 1600 || !/[A-Za-z]{3}/.test(fact)
      || /\?$/.test(fact) || /^(?:what|why|how|whether|do you|can you)\b/i.test(fact)
      || /^(?:hi|hello|thanks|thank you|okay|ok|got it)[.!\s]*$/i.test(fact)
      || /\b(?:ignore|override|bypass)\b.{0,100}\b(?:instructions|rules|policy|security|guardrails)\b|<\/?(?:system|developer)>|\b(?:system prompt|developer instructions)\b/i.test(fact)
      || containsSecretLike(fact)) return null;
  const acknowledgement = assistantText.replace(/^\[Cortex\]\s*/i, '').trim();
  if (acknowledgement.length > 180 || !/^(?:(?:got it|noted|remembered|understood|okay|ok|i['’]ll remember(?: that| this)?|i will remember(?: that| this)?|i['’]ll keep (?:that|this) in mind|i will keep (?:that|this) in mind)[.!\s,;–—-]*)+$/i.test(acknowledgement)) return null;
  return { fact, text: `User statement (unconfirmed; explicitly requested): ${fact}` };
}

async function maybeWriteThrough(
  api: OpenClawPluginApi,
  cfg: ReturnType<typeof resolveConfig>,
  event: any,
  ctx: any,
  fallbackText?: string,
  retainedReceipt?: string,
  retainReceipt?: (receipt: string, replaceReceipt?: string) => string,
  lifecycleObservedAt?: string,
) {
  if (!cfg.enabledWriteThrough) return 'disabled' as const;
  const latestUser = extractLatestUserText(event?.messages);
  const finalAssistant = (extractLatestAssistantVisibleText(event?.messages)
    || extractText(event?.result) || String(fallbackText || '')).replace(/\s+/g, ' ').trim();
  const invocation = captureTrustedPrincipalContext(ctx);
  // A worker's role=user task is not a direct human memory request. The session
  // shape only restricts this capture path; it never supplies the sender scope.
  const directHumanConversation = invocation.channelId === 'whatsapp'
    && /^agent:[^:]+:whatsapp:direct:/.test(invocation.sessionKey)
    && !invocation.sessionKey.includes(':subagent:');
  const explicitMemory = directHumanConversation
    ? explicitUserMemoryCandidate(extractDirectUserMemoryRequest(event?.messages), finalAssistant)
    : null;
  const text = [
    extractAssistantVisibleText(event?.messages),
    extractText(event?.result),
    String(fallbackText || ''),
  ].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
  if (!text) {
    api.logger.info?.('cortex-memory-bridge: write-through skipped (no extractable text)');
    return 'skipped' as const;
  }
  const recent = explicitMemory?.text || text.slice(-2000);
  const dur = explicitMemory
    ? { score: 1, reasons: ['explicit_user_memory_request'], kind: 'user_statement' }
    : durabilityScore(recent);
  if (dur.kind === 'blocked' || dur.score < cfg.minDurabilityScore) {
    api.logger.info?.(`cortex-memory-bridge: write-through skipped (score=${dur.score.toFixed(2)} < min=${cfg.minDurabilityScore.toFixed(2)} reasons=${dur.reasons.join(',') || 'none'})`);
    return 'skipped' as const;
  }
  const senderScoped = buildWriteThroughMetadata(cfg, ctx, recent, dur);
  if (lifecycleObservedAt) {
    (senderScoped as Record<string, unknown>).observed_at = lifecycleObservedAt;
  }
  if (explicitMemory) {
    const explicitValueHash = createHash('sha256').update(explicitMemory.fact, 'utf8').digest('hex');
    const explicitClaimKey = `owner:explicit-statement:${explicitValueHash}`;
    const explicitFactKey = `fact_${createHash('sha256').update([
      'cortex.openclaw.explicit-user-fact.v1',
      explicitClaimKey,
      explicitValueHash,
      String(senderScoped.source_id || ''),
    ].join('\0'), 'utf8').digest('hex').slice(0, 48)}`;
    Object.assign(senderScoped, {
      source: 'openclaw-explicit-user-memory', memory_kind: 'user_statement',
      topic: undefined, fact_key: explicitFactKey,
      claim_key: explicitClaimKey,
      subject: 'owner', predicate: 'stated', fact_scope: 'owner-global',
      fact_value: explicitMemory.fact,
      user_requested: true, independently_verified: false,
    });
  }
  try {
    const scope = searchableIdentity(cfg, ctx);
    const userQuery = latestUser || `Review OpenClaw ${dur.kind} memory candidate`;
    const interaction = {
      query: userQuery.slice(-2000),
      response: recent,
      levels_used: [7, 22],
    };
    const headers = scopedHeaders(cfg, scope);
    const issueReceipt = async (replaceReceipt = '') => {
      const receiptResponse = await postJson(cfg.baseUrl, cfg.assurancePath || '/nexus/assurance/receipt', interaction,
        cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, headers);
      if (receiptResponse?.success !== true || typeof receiptResponse?.receipt !== 'string' || !receiptResponse.receipt) {
        throw new Error('canonical memory assurance endpoint did not issue a receipt');
      }
      const issuedReceipt = String(receiptResponse.receipt);
      // The server receipt is the only durable-write identity. Persist it
      // before commit so response loss and process restart retry the same JTI.
      return retainReceipt?.(issuedReceipt, replaceReceipt) || issuedReceipt;
    };
    let assuranceReceipt = String(retainedReceipt || '').trim() || await issueReceipt();
    const commit = () => postJson(cfg.baseUrl, cfg.storePath, {
        ...interaction,
        assurance_receipt: assuranceReceipt,
        metadata: { ...senderScoped, scope },
      }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, headers);
    let response: any;
    try {
      response = await commit();
    } catch (error) {
      if (!/assurance_receipt_expired_without_commit/.test(String((error as any)?.message || error || ''))) throw error;
      // Nexus consulted its durable ledger and proved this expired receipt did
      // not commit. Only that explicit proof permits a new server identity.
      assuranceReceipt = await issueReceipt(assuranceReceipt);
      response = await commit();
    }
    const acknowledgement = response?.acknowledgement;
    const memoryId = String(acknowledgement?.memory_id || '');
    const receiptId = String(acknowledgement?.receipt_id || '');
    const committed = response?.success === true
      && response?.committed === true
      && response?.durable_write?.status === 'stored'
      && response?.assurance?.memory_commit?.eligible === true
      && acknowledgement?.version === 'nexus.memory-commit-ack.v1'
      && acknowledgement?.status === 'committed'
      && memoryId.length > 0
      && memoryId === String(response?.durable_write?.id || '')
      && receiptId.length > 0
      && receiptId === String(response?.assurance?.receipt?.id || '');
    if (committed) {
      const retrieval = await postJson(cfg.baseUrl, cfg.searchPath, {
        query: recent,
        n_results: Math.max(8, cfg.hardQueryCandidateCount),
        filters: {
          fact_keys: [String(senderScoped.fact_key)],
          statuses: ['active'],
          include_stale: true,
        },
        scope,
        ...memoryScopeFields(cfg, scope),
      }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, headers);
      const unavailable = searchResponseUnavailable(retrieval);
      if (unavailable) throw new Error(`canonical memory retrieval handoff unavailable: ${unavailable}`);
      const exactRecord = Array.isArray(retrieval?.results)
        ? retrieval.results.find((item: any) => String(item?.id || '') === memoryId)
        : undefined;
      if (!exactRecord) throw new Error('canonical memory retrieval handoff did not return the committed identifier');
      api.logger.info?.(`cortex-memory-bridge: assurance gate committed and retrieved durable memory (${dur.kind}, score=${dur.score.toFixed(2)})`);
      return 'succeeded' as const;
    }
    if (response?.committed === false && response?.durable_write?.status === 'skipped' && response?.assurance?.memory_commit?.eligible === false) {
      api.logger.info?.(`cortex-memory-bridge: assurance gate rejected durable memory candidate (${dur.kind})`);
      return 'skipped' as const;
    }
    throw new Error('canonical memory commit did not confirm a durable write');
  } catch (error) {
    if (isCanonicalAssuranceRejection(error)) {
      // A server-issued, explicit ineligibility decision is the assurance gate
      // working as designed. Treat it as a terminal skip so Codec continuity
      // can succeed and the durable lifecycle spool can be acknowledged.
      api.logger.info?.('cortex-memory-bridge: assurance gate rejected durable memory candidate');
      return 'skipped' as const;
    }
    api.logger.warn?.(`cortex-memory-bridge: write-through failed ${safeFailureSummary(error)}`);
    return 'failed' as const;
  }
}

function isCanonicalAssuranceRejection(error: unknown): boolean {
  const message = String((error as any)?.message || error || '');
  return /HTTP 422\b/.test(message)
    && /upstream_code=interaction_(?:not|no_longer)_eligible_for_commit\b/.test(message);
}

const plugin = {
  id: 'cortex-memory-bridge',
  name: 'Cortex Memory Bridge',
  description: 'Bridge from OpenClaw memory_search into Cortex with assurance-gated durable persistence and Codec continuity.',
  kind: 'memory',
  register(api: OpenClawPluginApi) {
    const initialConfig = resolveConfig(api.pluginConfig);
    if (!String(initialConfig.sessionIdentityHmacSecret || '').trim()) {
      throw new Error('cortex-memory-bridge requires an explicitly provisioned sessionIdentityHmacSecret shared with cortex-route-gate for memory_search and default-on Codec continuity');
    }
    const scopeCredentialId = String(initialConfig.scopeCredentialId || '').trim();
    const scopeHmacSecret = String(initialConfig.scopeHmacSecret || '');
    const hasScopeCredentialId = scopeCredentialId.length > 0;
    const hasScopeHmacSecret = scopeHmacSecret.trim().length > 0;
    if (hasScopeCredentialId !== hasScopeHmacSecret) {
      throw new Error('cortex-memory-bridge requires scopeCredentialId and scopeHmacSecret together');
    }
    if (hasScopeCredentialId && !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(scopeCredentialId)) {
      throw new Error('cortex-memory-bridge scopeCredentialId must be a bounded opaque identifier');
    }
    if (initialConfig.allowUnsignedLocalDevelopment === true) {
      if (hasScopeCredentialId || String(initialConfig.writeToken || '').trim()) {
        throw new Error('cortex-memory-bridge unsigned local development cannot be combined with production credentials');
      }
      if (initialConfig.tenantId !== 'cortex-local' || initialConfig.workspaceId !== 'default') {
        throw new Error('cortex-memory-bridge allowUnsignedLocalDevelopment is restricted to the cortex-local/default scope');
      }
      if (!isLoopbackBaseUrl(initialConfig.baseUrl)) {
        throw new Error('cortex-memory-bridge unsigned local development requires a loopback Cortex baseUrl');
      }
      const runtimeMode = explicitUnsignedDevelopmentMode();
      const warning = `SECURITY WARNING: cortex-memory-bridge is using unsigned loopback-only local development mode (${runtimeMode})`;
      if (typeof api.logger?.warn === 'function') api.logger.warn(warning);
      else console.warn(warning);
    }
    if (!hasScopeCredentialId) {
      if (initialConfig.allowUnsignedLocalDevelopment !== true) {
        throw new Error('cortex-memory-bridge requires scopeCredentialId and scopeHmacSecret unless allowUnsignedLocalDevelopment is explicitly enabled');
      }
    }
    if (!String(initialConfig.writeToken || '').trim() && initialConfig.allowUnsignedLocalDevelopment !== true) {
      throw new Error('cortex-memory-bridge requires writeToken outside explicit unsigned local development');
    }
    if (initialConfig.enabledWriteThrough || initialConfig.enabledCodecContinuity) {
      lifecycleEncryptionSecret(initialConfig);
    }
    const recentOutputMaxChars = initialConfig.recentOutputMaxChars;
    const lifecycleState = initialConfig.enabledWriteThrough || initialConfig.enabledCodecContinuity
      ? loadLifecycleSpools(initialConfig, api.logger)
      : null;
    const spools = lifecycleState?.spools ?? new Map<string, DurableLifecycleSpool>();
    const spoolForPrincipal = (principalNamespace: string) => {
      const existing = spools.get(principalNamespace);
      if (existing && fs.existsSync(path.join(lifecycleState!.root, principalNamespace))) return existing;
      if (existing) spools.delete(principalNamespace);
      if (!lifecycleState) throw new Error('lifecycle spool is unavailable while persistence is disabled');
      const created = lifecycleState.quota.spoolForNamespace(principalNamespace);
      spools.set(principalNamespace, created);
      return created;
    };
    const acknowledgeSpoolRecord = (principalNamespace: string, principalSpool: DurableLifecycleSpool, key: string) => {
      if (lifecycleState!.quota.acknowledge(principalNamespace, principalSpool, key)) {
        spools.delete(principalNamespace);
      }
    };
    const principalBinding = (ctx: any) => {
      const context = canonicalLifecycleContext(initialConfig, ctx);
      const principal = lifecyclePrincipal(initialConfig, context);
      return { context, principal, namespace: lifecyclePrincipalNamespace(initialConfig, principal) };
    };
    const recentOutputByPrincipal = new ExpiringLruMap<string>(RECENT_OUTPUT_MAX_ENTRIES, RECENT_OUTPUT_TTL_MS);
    const outputCacheKey = (principalNamespace: string, event: any, ctx: any) => {
      const identity = lifecycleIdentity(event, ctx);
      // Current OpenClaw callbacks do not always expose a run/completion ID.
      // The namespace already binds the complete principal and HMAC-derived
      // session, so a single latest-output slot is a safe bounded fallback for
      // the paired lifecycle callback in that exact session.
      return lifecyclePersistenceKey(
        principalNamespace,
        identity ? `output:${identity}` : 'output:session-latest',
      );
    };
    const sessionOutputCacheKey = (principalNamespace: string) => lifecyclePersistenceKey(
      principalNamespace,
      'output:session-latest',
    );
    const cachedLifecycleOutput = (principalNamespace: string, event: any, ctx: any) => {
      const exactKey = outputCacheKey(principalNamespace, event, ctx);
      const sessionKey = sessionOutputCacheKey(principalNamespace);
      return {
        exactKey,
        sessionKey,
        text: recentOutputByPrincipal.get(exactKey)
          ?? (exactKey === sessionKey ? undefined : recentOutputByPrincipal.get(sessionKey)),
      };
    };
    const completed = new ExpiringLruSet(LIFECYCLE_DEDUP_MAX_ENTRIES, LIFECYCLE_DEDUP_TTL_MS);
    const lifecycleOutcome = (
      key: string,
      values: Omit<LifecyclePersistenceOutcome, 'persistenceKeyHash'>,
    ): LifecyclePersistenceOutcome => ({
      ...values,
      persistenceKeyHash: createHash('sha256').update(key, 'utf8').digest('hex'),
    });
    const inFlight = new Map<string, Promise<LifecyclePersistenceOutcome>>();
    const queued = new Map<string, Promise<LifecyclePersistenceOutcome>>();
    const deletingPrincipals = new Set<string>();
    const pending: Array<{
      key: string;
      start: () => Promise<LifecyclePersistenceOutcome>;
      resolve: (value: LifecyclePersistenceOutcome) => void;
    }> = [];
    let refillSpool = () => {};
    let replayScheduled = false;
    const scheduleSpoolReplay = (delayMs: number) => {
      if (replayScheduled) return;
      replayScheduled = true;
      const timer = setTimeout(() => {
        replayScheduled = false;
        refillSpool();
      }, Math.max(1, delayMs));
      if (typeof (timer as any).unref === 'function') (timer as any).unref();
    };
    const makePersistenceKey = (principalNamespace: string, event: any, ctx: any, fallback?: string) => {
      const identity = lifecycleIdentity(event, ctx);
      const payload = identity ? `lifecycle:${identity}` : `content:${String(fallback || '').slice(-recentOutputMaxChars)}`;
      return lifecyclePersistenceKey(principalNamespace, payload);
    };
    const boundedLifecycleEvent = (
      event: any,
      cfg: ReturnType<typeof resolveConfig>,
      ctx: any,
    ): LifecycleReplayPayload['event'] => {
      const userText = truncateUtf8Tail(extractLatestUserText(event?.messages), 2000);
      const directUserText = truncateUtf8Tail(
        extractCorrelatedNativeUserMemoryRequest(event, ctx, cfg),
        2000,
      );
      // Native OpenClaw emits agent_end before llm_output. Use only visible
      // assistant text after the latest user boundary, never earlier history.
      const resultText = event?.success === false ? ''
        : extractText(event?.result) || extractCurrentTurnAssistantText(event);
      const boundedText = truncateUtf8Tail(resultText, cfg.recentOutputMaxChars);
      return {
        result: boundedText,
        messages: userText ? [{ role: 'user' as const, content: userText,
          // Preserve the raw-message eligibility decision across the bounded
          // projection. Flattening a worker announcement must not make it a
          // direct human Remember instruction; only this fixed marker enters
          // the encrypted replay payload, never the upstream provenance body.
          ...(directUserText && directUserText === userText
            ? {}
            : { provenance: { kind: 'ineligible-direct-memory-source' as const } }),
        }] : [],
      };
    };
    const drainPending = () => {
      while (pending.length > 0 && inFlight.size < initialConfig.lifecycleMaxInFlight) {
        const job = pending.shift()!;
        queued.delete(job.key);
        const active = job.start();
        inFlight.set(job.key, active);
        void active.then(job.resolve, (error) => {
          job.resolve(lifecycleOutcome(job.key, {
            ok: false,
            status: 'pending_retry',
            retainedForRetry: true,
            writeThrough: initialConfig.enabledWriteThrough ? 'not_attempted' : 'disabled',
            codecContinuity: initialConfig.enabledCodecContinuity ? 'not_attempted' : 'disabled',
            failure: safeFailureMetadata(error),
          }));
        });
      }
    };
    const persistLifecycle = (
      persistenceKey: string,
      cfg: ReturnType<typeof resolveConfig>,
      event: any,
      ctx: any,
      fallbackText?: string,
      storedPrincipal?: LifecyclePrincipal,
      storedReceipt?: string,
    ) => {
      if (!cfg.enabledWriteThrough && !cfg.enabledCodecContinuity) {
        api.logger.warn?.('cortex-memory-bridge: lifecycle persistence is disabled; output remains unacknowledged');
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'disabled',
          retainedForRetry: true,
          writeThrough: 'disabled',
          codecContinuity: 'disabled',
        }));
      }
      let context: LifecycleSpoolRecord['context'];
      let principal: LifecyclePrincipal;
      let principalNamespace: string;
      try {
        context = canonicalLifecycleContext(cfg, ctx, persistenceKey);
        principal = lifecyclePrincipal(cfg, context);
        principalNamespace = lifecyclePrincipalNamespace(cfg, principal);
        if (!persistenceKey.startsWith(`${principalNamespace}:`)) {
          throw new Error('lifecycle persistence key does not match the complete principal');
        }
        if (storedPrincipal && !lifecyclePrincipalsEqual(storedPrincipal, principal)) {
          throw new Error('stored lifecycle principal does not match the active callback identity');
        }
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: refused lifecycle persistence with incomplete or mismatched principal ${safeFailureSummary(error)}`);
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
          codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          failure: safeFailureMetadata(error),
        }));
      }
      if (deletingPrincipals.has(principalNamespace)) {
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: true,
          status: 'skipped',
          retainedForRetry: false,
          writeThrough: 'skipped',
          codecContinuity: 'skipped',
        }));
      }
      let principalSpool: DurableLifecycleSpool;
      try {
        principalSpool = spoolForPrincipal(principalNamespace);
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: lifecycle namespace admission failed ${safeFailureSummary(error)}`);
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
          codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          failure: safeFailureMetadata(error),
        }));
      }
      if (completed.has(persistenceKey)) {
        try { acknowledgeSpoolRecord(principalNamespace, principalSpool, persistenceKey); } catch (error) {
          api.logger.warn?.(`cortex-memory-bridge: failed to acknowledge completed lifecycle spool record ${safeFailureSummary(error)}`);
          return Promise.resolve(lifecycleOutcome(persistenceKey, {
            ok: false,
            status: 'pending_retry',
            retainedForRetry: true,
            writeThrough: 'not_attempted',
            codecContinuity: 'not_attempted',
            failure: safeFailureMetadata(error),
          }));
        }
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: true,
          status: 'already_persisted',
          retainedForRetry: false,
          writeThrough: 'not_attempted',
          codecContinuity: 'not_attempted',
        }));
      }
      const existing = inFlight.get(persistenceKey);
      if (existing) return existing;
      const waiting = queued.get(persistenceKey);
      if (waiting) return waiting;
      const boundedEvent = boundedLifecycleEvent(event, cfg, ctx);
      // Native agent_end declares success and provides its own snapshot. Never
      // substitute cached output when that snapshot lacks a current final text
      // (including another attempt sharing the run ID). Legacy callbacks may
      // use the separately run-correlated llm_output fallback instead.
      const boundedFallback = typeof event?.success === 'boolean' ? ''
        : truncateUtf8Tail(fallbackText, cfg.recentOutputMaxChars);
      const boundedContext = context;
      const retainedSpoolRecord = lifecycleState!.quota.entries(principalNamespace, principalSpool)
        .find((record) => record.key === persistenceKey);
      let activeReceipt = String(storedReceipt || '').trim();
      try {
        const retainedReceipt = retainedSpoolRecord?.version === 4
          ? unsealLifecycleReceipt(cfg, principalNamespace, retainedSpoolRecord)
          : String(retainedSpoolRecord?.assuranceReceipt || '').trim();
        if (activeReceipt && retainedReceipt && activeReceipt !== retainedReceipt) {
          throw new Error('lifecycle assurance receipt conflicts with encrypted durable state');
        }
        activeReceipt = activeReceipt || retainedReceipt;
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: refused lifecycle receipt replay ${safeFailureSummary(error)}`);
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
          codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          failure: safeFailureMetadata(error),
        }));
      }
      const replayPayload: LifecycleReplayPayload = {
        version: 1,
        event: boundedEvent,
        fallbackText: boundedFallback,
      };
      if (
        retainedSpoolRecord?.version === 4
        && retainedSpoolRecord.sealedPayload
        && retainedSpoolRecord.sealedPayload.payloadSha256 !== lifecycleReplayPayloadHash(replayPayload)
      ) {
        const error = new Error('lifecycle persistence key conflicts with the retained encrypted payload');
        api.logger.warn?.(`cortex-memory-bridge: refused lifecycle payload identity conflict ${safeFailureSummary(error)}`);
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
          codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          failure: safeFailureMetadata(error),
        }));
      }
      const createdAt = retainedSpoolRecord?.createdAt || new Date().toISOString();
      const recordBinding = {
        key: persistenceKey,
        createdAt,
        principal,
      };
      const sealedPayload = retainedSpoolRecord?.version === 4 && retainedSpoolRecord.sealedPayload
        ? retainedSpoolRecord.sealedPayload
        : sealLifecyclePayload(cfg, principalNamespace, recordBinding, replayPayload);
      const payloadMetadata = {
        schemaVersion: LIFECYCLE_PAYLOAD_METADATA_VERSION,
        result: lifecycleContentMetadata(boundedEvent.result),
        user: lifecycleContentMetadata(
          boundedEvent.messages.map((message) => message.content).join('\n'),
        ),
        userMessageCount: boundedEvent.messages.length,
        fallback: lifecycleContentMetadata(boundedFallback),
        replayEncrypted: true,
        payloadSha256: sealedPayload.payloadSha256,
      };
      let spoolRecord: LifecycleSpoolRecord = retainedSpoolRecord || {
        version: 4,
        key: persistenceKey,
        createdAt,
        principal,
        event: { result: JSON.stringify(payloadMetadata), messages: [] },
        context: boundedContext,
        fallbackText: '',
        sealedPayload,
      };
      try {
        // The replay payload crosses the durable boundary only as AES-256-GCM
        // ciphertext bound to the full principal namespace, persistence key,
        // creation timestamp, and plaintext hash. Metadata remains hash-only.
        if (!retainedSpoolRecord) {
          spoolRecord = lifecycleState!.quota.put(principalNamespace, principalSpool, spoolRecord);
        }
      } catch (error) {
        try {
          if (lifecycleState!.quota.removeIfEmpty(principalNamespace, principalSpool)) spools.delete(principalNamespace);
        } catch {}
        api.logger.warn?.(`cortex-memory-bridge: failed to durably spool lifecycle output ${safeFailureSummary(error)}`);
        return Promise.resolve(lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
          codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          failure: safeFailureMetadata(error),
        }));
      }
      const start = () => (async () => {
        const writeThroughStatus = await maybeWriteThrough(
          api,
          cfg,
          boundedEvent,
          boundedContext,
          boundedFallback,
          activeReceipt,
          (receipt, replaceReceipt) => {
            const canonicalReceipt = lifecycleState!.quota.retainReceipt(
              principalNamespace,
              principalSpool,
              spoolRecord.key,
              receipt,
              cfg,
              replaceReceipt,
            );
            activeReceipt = canonicalReceipt;
            return canonicalReceipt;
          },
          spoolRecord.createdAt,
        );
        const codecStatus = await maybeWriteCodecContinuity(
          api,
          cfg,
          boundedEvent,
          boundedContext,
          boundedFallback,
        );
        const writerStatuses = [writeThroughStatus, codecStatus];
        const failed = writerStatuses.includes('failed');
        const persisted = writerStatuses.includes('succeeded');
        const terminallySkipped = !failed && !persisted && writerStatuses.includes('skipped');
        if (failed || (!persisted && !terminallySkipped)) return lifecycleOutcome(persistenceKey, {
          ok: false,
          status: 'pending_retry',
          retainedForRetry: true,
          writeThrough: writeThroughStatus,
          codecContinuity: codecStatus,
        });
        try {
          acknowledgeSpoolRecord(principalNamespace, principalSpool, persistenceKey);
        } catch (error) {
          api.logger.warn?.(`cortex-memory-bridge: durable write succeeded but spool acknowledgment failed ${safeFailureSummary(error)}`);
          return lifecycleOutcome(persistenceKey, {
            ok: false,
            status: 'pending_retry',
            retainedForRetry: true,
            writeThrough: writeThroughStatus,
            codecContinuity: codecStatus,
            failure: safeFailureMetadata(error),
          });
        }
        completed.add(persistenceKey);
        scheduleSpoolReplay(cfg.lifecycleReplaySuccessDelayMs);
        return lifecycleOutcome(persistenceKey, {
          ok: true,
          status: persisted ? 'persisted' : 'skipped',
          retainedForRetry: false,
          writeThrough: writeThroughStatus,
          codecContinuity: codecStatus,
        });
      })().finally(() => {
        inFlight.delete(persistenceKey);
        drainPending();
      });
      if (inFlight.size >= cfg.lifecycleMaxInFlight) {
        if (pending.length >= cfg.lifecycleMaxPending) {
          api.logger.warn?.(`cortex-memory-bridge: lifecycle persistence queue exhausted at ${cfg.lifecycleMaxPending}; output retained for caller retry`);
          return Promise.resolve(lifecycleOutcome(persistenceKey, {
            ok: false,
            status: 'pending_retry',
            retainedForRetry: true,
            writeThrough: cfg.enabledWriteThrough ? 'not_attempted' : 'disabled',
            codecContinuity: cfg.enabledCodecContinuity ? 'not_attempted' : 'disabled',
          }));
        }
        let resolvePending!: (value: LifecyclePersistenceOutcome) => void;
        const waitingPromise = new Promise<LifecyclePersistenceOutcome>((resolve) => { resolvePending = resolve; });
        queued.set(persistenceKey, waitingPromise);
        pending.push({ key: persistenceKey, start, resolve: resolvePending });
        api.logger.warn?.(`cortex-memory-bridge: lifecycle persistence backpressured (${pending.length}/${cfg.lifecycleMaxPending} queued)`);
        return waitingPromise;
      }
      const active = start();
      inFlight.set(persistenceKey, active);
      return active;
    };
    refillSpool = () => {
      const cfg = initialConfig;
      if (!lifecycleState || (!cfg.enabledWriteThrough && !cfg.enabledCodecContinuity)) return;
      const schedulingLimit = cfg.lifecycleMaxInFlight + cfg.lifecycleMaxPending;
      for (const [principalNamespace, principalSpool] of spools.entries()) {
        if (deletingPrincipals.has(principalNamespace)) continue;
        let records: LifecycleSpoolRecord[];
        try {
          records = lifecycleState.quota.entries(principalNamespace, principalSpool);
        } catch (error) {
          spools.delete(principalNamespace);
          api.logger.warn?.(`cortex-memory-bridge: skipped stale lifecycle namespace during replay ${safeFailureSummary(error)}`);
          continue;
        }
        for (const record of records) {
          if (inFlight.size + queued.size >= schedulingLimit) return;
          if (inFlight.has(record.key) || queued.has(record.key) || completed.has(record.key)) continue;
          if (record.version !== 4 || !record.sealedPayload) {
            api.logger.warn?.(`cortex-memory-bridge: legacy lifecycle retry metadata awaits trusted callback key_hash=${createHash('sha256').update(record.key, 'utf8').digest('hex')}`);
            continue;
          }
          let replayPayload: LifecycleReplayPayload;
          try {
            replayPayload = unsealLifecyclePayload(cfg, principalNamespace, record);
          } catch (error) {
            api.logger.warn?.(`cortex-memory-bridge: refused encrypted lifecycle replay ${safeFailureSummary(error)}`);
            continue;
          }
          void persistLifecycle(
            record.key,
            cfg,
            replayPayload.event,
            record.context,
            replayPayload.fallbackText,
            record.principal,
            record.assuranceReceipt,
          ).then((outcome) => {
            if (outcome.retainedForRetry) {
              scheduleSpoolReplay(cfg.lifecycleReplayRetryMs);
            }
          }).catch((error) => {
            api.logger.warn?.(`cortex-memory-bridge: encrypted lifecycle replay failed ${safeFailureSummary(error)}`);
            scheduleSpoolReplay(cfg.lifecycleReplayRetryMs);
          });
        }
      }
    };
    scheduleSpoolReplay(initialConfig.lifecycleReplayInitialDelayMs);

    api.registerMemoryRuntime({
      async getMemorySearchManager(params: { agentId?: string; sessionKey?: string; sessionId?: string; userId?: string; requesterSenderId?: string; senderId?: string; channelId?: string; messageChannel?: string }) {
        try {
          const mod = await import('./manager.mjs');
          const manager = await mod.CortexMemorySearchManager.create({
            cfg: initialConfig,
            agentId: params?.agentId,
            invocationContext: captureTrustedPrincipalContext(params),
          });
          return { manager };
        } catch (error) {
          return {
            manager: null,
            error: `cortex_memory_manager_unavailable ${safeFailureSummary(error)}`,
          };
        }
      },
      resolveMemoryBackendConfig() {
        return { backend: 'builtin' as const };
      },
      async closeAllMemorySearchManagers() {},
    });

    const toolJsonResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value });

    api.registerTool((toolContext: any = {}) => {
      // Tool arguments are model-controlled; capture principal identity only from
      // OpenClaw's trusted factory context and freeze it before execution.
      const invocationContext = captureTrustedPrincipalContext(toolContext);
      return {
        label: 'Memory Search', name: 'memory_search', description: 'Search Cortex-backed memory over HTTP.', parameters: SearchSchema,
        execute: async (_toolCallId, params) => {
        const cfg = initialConfig;
        const query = String((params as { query: string }).query ?? '');
        const requestedMax = Number((params as { maxResults?: number }).maxResults ?? 5);
        const typedFilters = (params as { filters?: Record<string, unknown> }).filters;
        const classification = classifyQuery(query);
        const recentSummaryQuery = classification.tags.includes('recent-summary');
        const fetchCount = classification.mode === 'investigate'
          ? Math.max(requestedMax, cfg.hardQueryCandidateCount)
          : recentSummaryQuery
            ? Math.max(requestedMax, Math.max(cfg.hardQueryCandidateCount, 20))
            : Math.max(requestedMax, 8);
        try {
          const scope = searchableIdentity(cfg, requireTrustedPrincipalContext(invocationContext));
          const headers = scopedHeaders(cfg, scope);
          const response = await postJson(cfg.baseUrl, cfg.searchPath, {
            query,
            n_results: fetchCount,
            ...(typedFilters ? { filters: typedFilters } : {}),
            scope,
            ...memoryScopeFields(cfg, scope),
          }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, headers);
          const unavailable = searchResponseUnavailable(response);
          if (unavailable) throw new Error(`Cortex memory search unavailable: ${unavailable}`);
          let rawItems = Array.isArray(response?.results) ? response.results : [];
          if (recentSummaryQuery && !rawItems.some((item: any) => isRecentSummaryMemory((item?.metadata ?? {}) as Record<string, unknown>, String(item?.text ?? '')))) {
            const seen = new Set(rawItems.map((item: any) => String(item?.id ?? '')));
            for (const expandedQuery of [`recent status summary ${query}`.trim(), `question: ${query} answer:`.trim(), 'Cortex memory bridge repair completed']) {
              const expanded = await postJson(cfg.baseUrl, cfg.searchPath, {
                query: expandedQuery,
                n_results: fetchCount,
                ...(typedFilters ? { filters: typedFilters } : {}),
                scope,
                ...memoryScopeFields(cfg, scope),
              }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, headers);
              const expandedUnavailable = searchResponseUnavailable(expanded);
              if (expandedUnavailable) throw new Error(`Cortex memory search unavailable: ${expandedUnavailable}`);
              const extra = Array.isArray(expanded?.results) ? expanded.results : [];
              for (const item of extra) {
                const id = String(item?.id ?? '');
                if (id && seen.has(id)) continue;
                if (id) seen.add(id);
                rawItems.push(item);
              }
              if (rawItems.some((item: any) => isRecentSummaryMemory((item?.metadata ?? {}) as Record<string, unknown>, String(item?.text ?? '')))) break;
            }
          }
          const reconciled = reconcileResults(query, rawItems, cfg);
          let results = reconciled.results.slice(0, requestedMax);
          const minScore = typeof (params as { minScore?: number }).minScore === 'number' ? Number((params as { minScore?: number }).minScore) : null;
          if (minScore !== null) results = results.filter((x) => x.score >= minScore);
          const cleanButEmpty = results.length === 0 && reconciled.resolvedFacts.length === 0 && reconciled.conflicts.length === 0;
          const reportedMode = String(response?.mode ?? response?.search_mode ?? 'semantic').trim().toLowerCase();
          const safeMode = ['semantic', 'hybrid', 'lexical', 'lexical_fallback', 'fallback_lexical'].includes(reportedMode)
            ? reportedMode : 'unknown';
          return toolJsonResult({
            results,
            provider: 'cortex-http',
            mode: safeMode,
            memoryMode: reconciled.mode,
            queryType: reconciled.queryType,
            resolvedFacts: reconciled.resolvedFacts,
            conflicts: reconciled.conflicts,
            fallback: cleanButEmpty
              ? { from: 'memory', reason: 'clean_but_empty', suggestion: 'No relevant durable memory was found after noise suppression; fall back to workspace/filesystem or live tools.' }
              : (response?.degraded ? { from: 'cortex', reason: 'degraded_backend' } : undefined),
          });
        } catch (error) {
          return toolJsonResult({ results: [], disabled: true, error: 'cortex_memory_search_failed', failure: safeFailureMetadata(error) });
        }
      },
      };
    }, { names: ['memory_search'] });

    api.registerTool((toolContext: any = {}) => {
      const invocationContext = captureTrustedPrincipalContext(toolContext);
      return {
        label: 'Memory Get', name: 'memory_get', description: 'Read a bounded line window from an exact cortex: record path returned by memory_search, within the authenticated caller’s memory scope.', parameters: GetSchema,
        execute: async (_toolCallId, params) => {
          const requested = params as { path?: string; from?: number; lines?: number };
          const path = String(requested.path ?? '');
          try {
            const { CortexMemorySearchManager } = await import('./manager.mjs');
            const manager = await CortexMemorySearchManager.create({ cfg: initialConfig, invocationContext });
            return toolJsonResult(await manager.readFile({ relPath: path, from: requested.from, lines: requested.lines }));
          } catch (error) {
            return toolJsonResult({ path, text: '', disabled: true, error: 'cortex_memory_get_failed', failure: safeFailureMetadata(error) });
          }
        },
      };
    }, { names: ['memory_get'] });

    api.registerTool((toolContext: any = {}) => {
      const invocationContext = captureTrustedPrincipalContext(toolContext);
      return {
        label: 'Delete Principal Memory',
        name: 'memory_delete_principal',
        description: 'Hard-delete the authenticated principal’s Cortex projections and pre-deletion replay state. Requires the exact confirmation token.',
        parameters: DeletePrincipalMemorySchema,
        execute: async (_toolCallId, params) => {
          const requested = params as { confirmation?: string };
          if (requested.confirmation !== 'HARD_DELETE_CORTEX_MEMORY') {
            return toolJsonResult({ completed: false, error: 'explicit_confirmation_required' });
          }
          let deletingNamespace = '';
          let ownsDeletionFence = false;
          const cancelledJobs: typeof pending = [];
          try {
            const cfg = initialConfig;
            const trusted = requireTrustedPrincipalContext(invocationContext);
            const scope = searchableIdentity(cfg, trusted);
            const headers = scopedHeaders(cfg, scope);
            const binding = principalBinding(trusted);
            deletingNamespace = binding.namespace;
            if (deletingPrincipals.has(deletingNamespace)) {
              return toolJsonResult({ completed: false, error: 'principal_deletion_already_in_progress' });
            }
            deletingPrincipals.add(deletingNamespace);
            ownsDeletionFence = true;

            // Stop queued/replay work first, then let already-issued network
            // operations settle before creating the server fence. This keeps
            // codec continuity from repopulating a surface after the server's
            // final purge while still allowing the fence to reject any stale
            // encrypted record that survives a partial failure.
            for (let index = pending.length - 1; index >= 0; index -= 1) {
              const job = pending[index];
              if (!job.key.startsWith(`${deletingNamespace}:`)) continue;
              pending.splice(index, 1);
              queued.delete(job.key);
              cancelledJobs.push(job);
            }
            const draining = [...inFlight.entries()]
              .filter(([key]) => key.startsWith(`${deletingNamespace}:`))
              .map(([, promise]) => promise);
            await Promise.allSettled(draining);

            const response = await postJson(
              cfg.baseUrl,
              '/l22/delete-principal',
              {
                confirmation: 'HARD_DELETE_CORTEX_MEMORY',
                preserve_source_files: true,
                reason: 'authenticated_principal_requested_erasure',
                scope,
                ...memoryScopeFields(cfg, scope),
              },
              cfg.timeoutMs,
              cfg.retryCount,
              cfg.retryBackoffMs,
              cfg.maxResponseBytes,
              headers,
            );
            if (response?.completed !== true
              || response?.source_files_preserved !== true
              || response?.client_spool_purge_required !== true
              || typeof response?.deletion_epoch !== 'string') {
              throw new Error('Cortex did not confirm principal deletion convergence');
            }
            const keyPrefix = `${deletingNamespace}:`;
            recentOutputByPrincipal.deletePrefix(keyPrefix);
            completed.deletePrefix(keyPrefix);
            let localSpoolRecords = 0;
            if (lifecycleState) {
              const namespaceDir = path.join(lifecycleState.root, deletingNamespace);
              if (fs.existsSync(namespaceDir)) {
                const principalSpool = spoolForPrincipal(deletingNamespace);
                localSpoolRecords = lifecycleState.quota.purgeBefore(
                  deletingNamespace,
                  principalSpool,
                  response.deletion_epoch,
                );
                if (!fs.existsSync(namespaceDir)) spools.delete(deletingNamespace);
              }
            }
            for (const job of cancelledJobs) {
              job.resolve(lifecycleOutcome(job.key, {
                ok: true,
                status: 'skipped',
                retainedForRetry: false,
                writeThrough: 'skipped',
                codecContinuity: 'skipped',
              }));
            }
            return toolJsonResult({
              completed: true,
              deletionId: response.deletion_id,
              deletionEpoch: response.deletion_epoch,
              serverCounts: response.counts,
              localSpoolRecords,
              cancelledQueued: cancelledJobs.length,
              drainedInFlight: draining.length,
              sourceFilesPreserved: true,
            });
          } catch (error) {
            for (const job of cancelledJobs) {
              job.resolve(lifecycleOutcome(job.key, {
                ok: false,
                status: 'pending_retry',
                retainedForRetry: true,
                writeThrough: initialConfig.enabledWriteThrough ? 'not_attempted' : 'disabled',
                codecContinuity: initialConfig.enabledCodecContinuity ? 'not_attempted' : 'disabled',
                failure: safeFailureMetadata(error),
              }));
            }
            scheduleSpoolReplay(initialConfig.lifecycleReplayRetryMs);
            return toolJsonResult({
              completed: false,
              error: 'cortex_memory_delete_failed',
              failure: safeFailureMetadata(error),
            });
          } finally {
            if (ownsDeletionFence) deletingPrincipals.delete(deletingNamespace);
          }
        },
      };
    }, { names: ['memory_delete_principal'] });

    api.on('llm_output', (event: any, ctx: any) => {
      const text = extractLlmOutputText(event);
      if (!text) return;
      try {
        const binding = principalBinding(ctx);
        if (deletingPrincipals.has(binding.namespace)) return;
        const cacheKey = outputCacheKey(binding.namespace, event, ctx);
        if (cacheKey) recentOutputByPrincipal.set(cacheKey, text.slice(-recentOutputMaxChars));
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: refused recent output with incomplete principal ${safeFailureSummary(error)}`);
        throw error;
      }
    });

    api.on('subagent_ended', async (event: any, ctx: any) => {
      const cfg = initialConfig;
      const binding = principalBinding(ctx);
      const cached = cachedLifecycleOutput(binding.namespace, event, ctx);
      const fallbackText = cached.text;
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: subagent_ended shape ${JSON.stringify({ principal: binding.namespace, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(binding.namespace, event, ctx, fallbackText || extractText(event?.result));
      const outcome = await persistLifecycle(
        persistenceKey,
        cfg,
        { result: event?.result, messages: event?.messages, success: event?.success },
        ctx,
        fallbackText,
      );
      if (!outcome.ok) {
        api.logger.warn?.(`cortex-memory-bridge: subagent lifecycle persistence pending retry key_hash=${outcome.persistenceKeyHash} write_through=${outcome.writeThrough} codec=${outcome.codecContinuity}`);
      }
      return outcome;
    });

    api.on('agent_end', async (event: any, ctx: any) => {
      const cfg = initialConfig;
      const binding = principalBinding(ctx);
      const cached = cachedLifecycleOutput(binding.namespace, event, ctx);
      const fallbackText = cached.text;
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: agent_end shape ${JSON.stringify({ principal: binding.namespace, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(binding.namespace, event, ctx, fallbackText || extractText(event?.result));
      const outcome = await persistLifecycle(persistenceKey, cfg, event, ctx, fallbackText);
      if (outcome.ok) {
        recentOutputByPrincipal.delete(cached.exactKey);
        if (cached.sessionKey !== cached.exactKey) recentOutputByPrincipal.delete(cached.sessionKey);
        return outcome;
      } else {
        const error = new Error('Cortex lifecycle persistence failed; output retained for retry') as Error & {
          code?: string;
          outcome?: LifecyclePersistenceOutcome;
        };
        error.code = 'CORTEX_MEMORY_PERSISTENCE_PENDING';
        error.outcome = outcome;
        throw error;
      }
    });
  },
};

export default plugin;
export { DurableLifecycleQuota, DurableLifecycleSpool, ExpiringLruMap, canonicalChannelIdentity, durabilityScore, buildWriteThroughMetadata, durableLifecycleMkdir, extractLatestAssistantVisibleText, extractLlmOutputText, isCanonicalAssuranceRejection, lifecyclePersistenceKey, reconcileResults, sealLifecyclePayload, sealLifecycleReceipt, unsealLifecyclePayload, unsealLifecycleReceipt, withLifecycleDirectoryLock };
