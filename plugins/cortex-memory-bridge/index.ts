import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/memory-core';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { captureTrustedPrincipalContext, deriveCortexPrincipal } from '../cortex-principal-identity.mjs';

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
  allowUnsignedLocalDevelopment?: boolean;
  sessionIdentityHmacSecret?: string;
};

type TrustedPrincipalContext = {
  sessionKey: string;
  userId: string;
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
const LIFECYCLE_MAX_IN_FLIGHT = 64;
const LIFECYCLE_MAX_PENDING = 256;
const LIFECYCLE_SPOOL_MAX_RECORDS = 4096;
const LIFECYCLE_SPOOL_MAX_RECORD_BYTES = 256 * 1024;
const LIFECYCLE_NAMESPACE_INODE_BUDGET = 8;
const LIFECYCLE_ROOT_INODE_RESERVE = 16;
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

  private pruneExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

type LifecycleSpoolRecord = {
  version: 3;
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
    idempotencyKey: string;
  };
  fallbackText: string;
  assuranceReceipt?: string;
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
  return [2, 3].includes(Number(record.version))
    && typeof record.key === 'string' && record.key.length > 0 && record.key.length <= 2048
    && typeof record.createdAt === 'string' && record.createdAt.length <= 64
    && isLifecyclePrincipal(record.principal)
    && typeof record.fallbackText === 'string' && record.fallbackText.length <= 65_536
    && event && typeof event === 'object' && typeof event.result === 'string' && event.result.length <= 65_536
    && Array.isArray(event.messages) && event.messages.length <= 1
    && event.messages.every((message: any) => message?.role === 'user' && typeof message.content === 'string' && message.content.length <= 2000)
    && context && typeof context === 'object'
    && ['sessionKey', 'sessionId', 'channelId', 'agentId', 'userId', 'idempotencyKey']
      .every((field) => typeof context[field] === 'string' && context[field].length <= 2048)
    && (record.assuranceReceipt === undefined
      || (typeof record.assuranceReceipt === 'string' && record.assuranceReceipt.length > 0 && record.assuranceReceipt.length <= 16_384));
}

const LIFECYCLE_PAYLOAD_METADATA_VERSION = 'cortex.lifecycle-payload-metadata.v1';

function lifecycleContentMetadata(value: string): { bytes: number; sha256: string } {
  const bytes = Buffer.from(String(value || ''), 'utf8');
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function parseLifecyclePayloadMetadata(record: LifecycleSpoolRecord): Record<string, unknown> | null {
  try {
    const value = JSON.parse(record.event.result);
    return value && typeof value === 'object' && !Array.isArray(value)
      && value.schemaVersion === LIFECYCLE_PAYLOAD_METADATA_VERSION ? value : null;
  } catch { return null; }
}

function sanitizeLifecycleSpoolRecord(record: LifecycleSpoolRecord): LifecycleSpoolRecord {
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
      const persisted = sanitizeLifecycleSpoolRecord({ ...record, version: 3 } as LifecycleSpoolRecord);
      this.records.set(record.key, persisted);
      this.flush();
      return { ...persisted };
    });
  }

  retainReceipt(key: string, candidateReceipt: string, replaceReceipt = ''): string {
    return this.withLock(() => {
      this.reload();
      const record = this.records.get(key);
      if (!record) throw new Error('cannot retain an assurance receipt for a missing lifecycle record');
      const existingReceipt = String(record.assuranceReceipt || '').trim();
      const expectedReceipt = String(replaceReceipt || '').trim();
      if (existingReceipt && (!expectedReceipt || existingReceipt !== expectedReceipt)) return existingReceipt;
      const receipt = String(candidateReceipt || '').trim();
      if (!receipt || receipt.length > 16_384) throw new Error('invalid assurance receipt for lifecycle spool');
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
      const sanitized = sanitizeLifecycleSpoolRecord({ ...record, version: 3 });
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
    this.maxBytes = Math.max(LIFECYCLE_SPOOL_MAX_RECORD_BYTES, maxRecords * LIFECYCLE_SPOOL_MAX_RECORD_BYTES);
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
      const persisted = sanitizeLifecycleSpoolRecord({ ...record, version: 3 } as LifecycleSpoolRecord);
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
    replaceReceipt = '',
  ): string {
    return this.runExclusive(() => {
      this.assertNamespace(namespace);
      return spool.retainReceipt(key, receipt, replaceReceipt);
    });
  }

  acknowledge(namespace: string, spool: DurableLifecycleSpool, key: string): boolean {
    return this.runExclusive(() => {
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
  properties: { query: { type: 'string', minLength: 1 }, maxResults: { type: 'number', minimum: 1, maximum: 50 }, minScore: { type: 'number', minimum: 0, maximum: 1 } },
} as const;
const GetSchema = {
  type: 'object', additionalProperties: false, required: ['path'],
  properties: { path: { type: 'string' }, from: { type: 'number' }, lines: { type: 'number' } },
} as const;

function resolveConfig(pluginConfig?: Record<string, unknown>): Required<Pick<BridgeConfig, 'baseUrl' | 'searchPath' | 'storePath' | 'codecEventsPath' | 'timeoutMs' | 'retryCount' | 'retryBackoffMs' | 'curatedBoost' | 'projectFactBoost' | 'durableCandidatePenalty' | 'noisyWhatsappPenalty' | 'noisyPatternPenalty' | 'minDurabilityScore' | 'writeTags' | 'conflictPenalty' | 'recencyBoost' | 'explicitBoost' | 'corroborationBoost' | 'hardQueryCandidateCount' | 'maxResponseBytes' | 'lifecycleMaxInFlight' | 'lifecycleMaxPending' | 'lifecycleSpoolMaxRecords' | 'recentOutputMaxChars' | 'stateDir'>> & BridgeConfig {
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
    recentOutputMaxChars: Number.isSafeInteger(cfg.recentOutputMaxChars) && Number(cfg.recentOutputMaxChars) > 0
      ? Math.min(65_536, Number(cfg.recentOutputMaxChars))
      : RECENT_OUTPUT_MAX_CHARS,
    writeToken: typeof cfg.writeToken === 'string' ? cfg.writeToken : '',
    writeTokenHeader: writeTokenHeader.toLowerCase(),
    tenantId: typeof cfg.tenantId === 'string' ? cfg.tenantId.trim() : 'cortex-local',
    workspaceId: typeof cfg.workspaceId === 'string' ? cfg.workspaceId.trim() : 'default',
    agentId: typeof cfg.agentId === 'string' && cfg.agentId.trim() ? cfg.agentId.trim() : 'main',
    userId: typeof cfg.userId === 'string' && cfg.userId.trim() ? cfg.userId.trim() : 'local-user',
    channelId: typeof cfg.channelId === 'string' && cfg.channelId.trim() ? cfg.channelId.trim() : 'local-channel',
    sessionId: typeof cfg.sessionId === 'string' && cfg.sessionId.trim() ? cfg.sessionId.trim() : 'global-session',
    scopeCredentialId: typeof cfg.scopeCredentialId === 'string' ? cfg.scopeCredentialId.trim() : '',
    scopeHmacSecret: typeof cfg.scopeHmacSecret === 'string' ? cfg.scopeHmacSecret : '',
    allowUnsignedLocalDevelopment: cfg.allowUnsignedLocalDevelopment === true,
    sessionIdentityHmacSecret: typeof cfg.sessionIdentityHmacSecret === 'string' ? cfg.sessionIdentityHmacSecret : '',
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
  return ctx;
}
function scopedIdentity(cfg: BridgeConfig, ctx: any = {}): Record<string, string> {
  return deriveCortexPrincipal(cfg, ctx);
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
  const session = boundedLifecycleIdentity(
    ctx?.sessionKey || ctx?.sessionId,
    'session identity',
    512,
  );
  return {
    sessionKey: session,
    sessionId: session,
    // OpenClaw lifecycle hooks are not guaranteed to repeat fixed principal
    // dimensions. They must still provide the per-run session identity; the
    // remaining values may fall back only to this plugin's configured scope.
    // Cortex subsequently verifies the complete HMAC-signed scope against the
    // credential allow-list, so these defaults cannot broaden authorization.
    channelId: boundedLifecycleIdentity(ctx?.channelId || ctx?.messageChannel || cfg.channelId, 'channel identity', 256),
    agentId: boundedLifecycleIdentity(ctx?.agentId || cfg.agentId, 'agent identity', 256),
    userId: boundedLifecycleIdentity(ctx?.userId || ctx?.requesterSenderId || cfg.userId, 'user identity', 256),
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
          if (['assurance_receipt_expired_without_commit', 'assurance_receipt_commit_outcome_unknown'].includes(candidate)) safeUpstreamCode = candidate;
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

function extractAssistantVisibleText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  return messages
    .filter((m) => m && typeof m === 'object' && (m as Record<string, unknown>).role === 'assistant')
    .map((m) => extractText((m as Record<string, unknown>).content ?? m))
    .filter(Boolean)
    .join('\n');
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
function detectProjectSlug(text: string): string | null {
  const t = normalizeQuery(text);
  if (/\bmailchimp\b/.test(t)) return 'mailchimp';
  if (/\bpmhnp\b|\bclaim guard\b/.test(t)) return 'pmhnp-claim-guard';
  return null;
}
function containsSecretLike(text: string): boolean {
  return /\b(api[_-]?key|token|password|secret|bearer|ssh-rsa|BEGIN [A-Z ]+ PRIVATE KEY)\b/i.test(text);
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
  const reasons: string[] = [];
  let score = 0;
  let kind = 'transient';
  if (!t || t.length < 20) return { score: 0, reasons: ['too_short'], kind };
  if (/\b(supervisorstatus|matrixstatus|paritystatus)\b|\bcanonical status\b|\bremaining surfaces\b|\bremaining unsatisfied surfaces\b|\bwhat this run actually changed\b|\bblocker\s*:\s*|\btrustworthy partial result\b/i.test(t)) { score += 0.58; reasons.push('canonical_project_status'); kind = 'project_state'; }
  if (/\bremember this\b|\bplease remember\b|\bmy preference\b|\bi prefer\b|\bcall me\b|\btimezone\b|\bpronouns\b/i.test(t)) { score += 0.45; reasons.push('explicit_preference'); kind = 'preference'; }
  if (/\bdecision\b|\bwe decided\b|\bthe plan is\b|\bfrom now on\b|\bdefault to\b|\balways use\b/i.test(t)) { score += 0.35; reasons.push('decision'); kind = 'decision'; }
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
  const scopedSessionId = scopedIdentity(cfg, ctx).session_id;
  const tags = Array.from(new Set([...(cfg.writeTags || []), ...dur.reasons, ...(project ? [project] : [])]));
  let source = 'openclaw-lifecycle-candidate';
  let topic: string | undefined;
  if (dur.kind === 'project_state') {
    source = 'openclaw-project-state-candidate';
    topic = project ? `${project}-canonical-status` : 'canonical-project-status';
  } else if (dur.kind === 'preference') {
    source = 'openclaw-preference-candidate';
    topic = 'preferences';
  } else if (dur.kind === 'decision') {
    source = 'openclaw-decision-candidate';
    topic = project ? `${project}-durable-decision` : 'durable-decision';
  }
  return {
    channel: ctx?.channelId ?? 'unknown',
    sessionKey: scopedSessionId,
    source,
    quality: 'candidate',
    assurance_status: 'unvalidated',
    memory_kind: dur.kind,
    tags,
    project: project ?? undefined,
    topic,
    fact_key: topic ? `${project ?? 'global'}:${topic}` : undefined,
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
    const response = await postJson(cfg.baseUrl, cfg.codecEventsPath, {
      idempotency_key: ctx?.idempotencyKey,
      session_key: sessionKey,
      events: [{ text, tags: ['openclaw', 'session-continuity'], metadata: { source: 'cortex-memory-bridge', channel: ctx?.channelId ?? 'unknown', scope } }],
      max_chars: 1200,
      scope,
      ...memoryScopeFields(cfg, scope),
    }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes, scopedHeaders(cfg, scope));
    if (response?.success !== true) throw new Error('Codec continuity endpoint did not confirm the write');
    return 'succeeded' as const;
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: Codec continuity write failed ${safeFailureSummary(error)}`);
    return 'failed' as const;
  }
}
async function maybeWriteThrough(
  api: OpenClawPluginApi,
  cfg: ReturnType<typeof resolveConfig>,
  event: any,
  ctx: any,
  fallbackText?: string,
  retainedReceipt?: string,
  retainReceipt?: (receipt: string, replaceReceipt?: string) => string,
) {
  if (!cfg.enabledWriteThrough) return 'disabled' as const;
  const text = [
    extractAssistantVisibleText(event?.messages),
    extractText(event?.result),
    String(fallbackText || ''),
  ].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
  if (!text) {
    api.logger.info?.('cortex-memory-bridge: write-through skipped (no extractable text)');
    return 'skipped' as const;
  }
  const recent = text.slice(-2000);
  const dur = durabilityScore(recent);
  if (dur.score < cfg.minDurabilityScore) {
    api.logger.info?.(`cortex-memory-bridge: write-through skipped (score=${dur.score.toFixed(2)} < min=${cfg.minDurabilityScore.toFixed(2)} reasons=${dur.reasons.join(',') || 'none'})`);
    return 'skipped' as const;
  }
  const senderScoped = buildWriteThroughMetadata(cfg, ctx, recent, dur);
  try {
    const scope = scopedIdentity(cfg, ctx);
    const userQuery = extractLatestUserText(event?.messages) || `Review OpenClaw ${dur.kind} memory candidate`;
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
    const committed = response?.success === true
      && response?.committed === true
      && response?.durable_write?.status === 'stored'
      && response?.assurance?.memory_commit?.eligible === true;
    if (committed) {
      api.logger.info?.(`cortex-memory-bridge: assurance gate committed durable memory (${dur.kind}, score=${dur.score.toFixed(2)})`);
      return 'succeeded' as const;
    }
    if (response?.committed === false && response?.durable_write?.status === 'skipped' && response?.assurance?.memory_commit?.eligible === false) {
      api.logger.info?.(`cortex-memory-bridge: assurance gate rejected durable memory candidate (${dur.kind})`);
      return 'skipped' as const;
    }
    throw new Error('canonical memory commit did not confirm a durable write');
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: write-through failed ${safeFailureSummary(error)}`);
    return 'failed' as const;
  }
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
    const completed = new ExpiringLruSet(LIFECYCLE_DEDUP_MAX_ENTRIES, LIFECYCLE_DEDUP_TTL_MS);
    const inFlight = new Map<string, Promise<boolean>>();
    const queued = new Map<string, Promise<boolean>>();
    const pending: Array<{ key: string; start: () => Promise<boolean>; resolve: (value: boolean) => void }> = [];
    let refillSpool = () => {};
    const makePersistenceKey = (principalNamespace: string, event: any, ctx: any, fallback?: string) => {
      const identity = lifecycleIdentity(event, ctx);
      const payload = identity ? `lifecycle:${identity}` : `content:${String(fallback || '').slice(-recentOutputMaxChars)}`;
      return lifecyclePersistenceKey(principalNamespace, payload);
    };
    const boundedLifecycleEvent = (event: any, cfg: ReturnType<typeof resolveConfig>) => {
      const userText = extractLatestUserText(event?.messages).slice(-2000);
      const assistantText = extractAssistantVisibleText(event?.messages);
      const resultText = extractText(event?.result);
      const boundedText = [assistantText, resultText]
        .filter(Boolean)
        .join('\n')
        .slice(-cfg.recentOutputMaxChars);
      return {
        result: boundedText,
        messages: userText ? [{ role: 'user' as const, content: userText }] : [],
      };
    };
    const drainPending = () => {
      while (pending.length > 0 && inFlight.size < initialConfig.lifecycleMaxInFlight) {
        const job = pending.shift()!;
        queued.delete(job.key);
        const active = job.start();
        inFlight.set(job.key, active);
        void active.then(job.resolve);
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
        return Promise.resolve(false);
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
        return Promise.resolve(false);
      }
      let principalSpool: DurableLifecycleSpool;
      try {
        principalSpool = spoolForPrincipal(principalNamespace);
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: lifecycle namespace admission failed ${safeFailureSummary(error)}`);
        return Promise.resolve(false);
      }
      if (completed.has(persistenceKey)) {
        try { acknowledgeSpoolRecord(principalNamespace, principalSpool, persistenceKey); } catch (error) {
          api.logger.warn?.(`cortex-memory-bridge: failed to acknowledge completed lifecycle spool record ${safeFailureSummary(error)}`);
          return Promise.resolve(false);
        }
        return Promise.resolve(true);
      }
      const existing = inFlight.get(persistenceKey);
      if (existing) return existing;
      const waiting = queued.get(persistenceKey);
      if (waiting) return waiting;
      const boundedEvent = boundedLifecycleEvent(event, cfg);
      const boundedFallback = String(fallbackText || '').slice(-cfg.recentOutputMaxChars);
      const boundedContext = context;
      const retainedSpoolRecord = lifecycleState!.quota.entries(principalNamespace, principalSpool)
        .find((record) => record.key === persistenceKey);
      const activeReceipt = String(storedReceipt || retainedSpoolRecord?.assuranceReceipt || '').trim();
      let spoolRecord: LifecycleSpoolRecord = {
        version: 3,
        key: persistenceKey,
        createdAt: new Date().toISOString(),
        principal,
        event: boundedEvent,
        context: boundedContext,
        fallbackText: boundedFallback,
        ...(activeReceipt ? { assuranceReceipt: activeReceipt } : {}),
      };
      try {
        // Only metadata and a server receipt cross the durable boundary. The
        // current trusted callback retains the raw payload in memory for this
        // attempt; a later callback must supply it again after restart.
        spoolRecord = lifecycleState!.quota.put(principalNamespace, principalSpool, spoolRecord);
      } catch (error) {
        try {
          if (lifecycleState!.quota.removeIfEmpty(principalNamespace, principalSpool)) spools.delete(principalNamespace);
        } catch {}
        api.logger.warn?.(`cortex-memory-bridge: failed to durably spool lifecycle output ${safeFailureSummary(error)}`);
        return Promise.resolve(false);
      }
      const start = () => (async () => {
        const writeThroughStatus = await maybeWriteThrough(
          api,
          cfg,
          boundedEvent,
          boundedContext,
          boundedFallback,
          spoolRecord.assuranceReceipt,
          (receipt, replaceReceipt) => {
            const canonicalReceipt = lifecycleState!.quota.retainReceipt(
              principalNamespace,
              principalSpool,
              spoolRecord.key,
              receipt,
              replaceReceipt,
            );
            spoolRecord.assuranceReceipt = canonicalReceipt;
            return canonicalReceipt;
          },
        );
        const codecStatus = await maybeWriteCodecContinuity(
          api,
          cfg,
          boundedEvent,
          boundedContext,
          boundedFallback,
        );
        const enabled = [writeThroughStatus, codecStatus].some((status) => status !== 'disabled');
        const succeeded = enabled && ![writeThroughStatus, codecStatus].includes('failed');
        if (!succeeded) return false;
        try {
          acknowledgeSpoolRecord(principalNamespace, principalSpool, persistenceKey);
        } catch (error) {
          api.logger.warn?.(`cortex-memory-bridge: durable write succeeded but spool acknowledgment failed ${safeFailureSummary(error)}`);
          return false;
        }
        completed.add(persistenceKey);
        queueMicrotask(refillSpool);
        return true;
      })().finally(() => {
        inFlight.delete(persistenceKey);
        drainPending();
      });
      if (inFlight.size >= cfg.lifecycleMaxInFlight) {
        if (pending.length >= cfg.lifecycleMaxPending) {
          api.logger.warn?.(`cortex-memory-bridge: lifecycle persistence queue exhausted at ${cfg.lifecycleMaxPending}; output retained for caller retry`);
          return Promise.resolve(false);
        }
        let resolvePending!: (value: boolean) => void;
        const waitingPromise = new Promise<boolean>((resolve) => { resolvePending = resolve; });
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
          // The spool intentionally contains no user/output text.  Automatic
          // restart replay would persist a hash marker as if it were memory;
          // retain the receipt/metadata until the trusted lifecycle callback
          // supplies the same payload again.
          api.logger.warn?.(`cortex-memory-bridge: lifecycle retry metadata awaits trusted callback key_hash=${createHash('sha256').update(record.key, 'utf8').digest('hex')}`);
        }
      }
    };
    queueMicrotask(refillSpool);

    api.registerMemoryRuntime({
      async getMemorySearchManager(params: { agentId?: string; sessionKey?: string; sessionId?: string; userId?: string; requesterSenderId?: string; channelId?: string; messageChannel?: string }) {
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
        const classification = classifyQuery(query);
        const recentSummaryQuery = classification.tags.includes('recent-summary');
        const fetchCount = classification.mode === 'investigate'
          ? Math.max(requestedMax, cfg.hardQueryCandidateCount)
          : recentSummaryQuery
            ? Math.max(requestedMax, Math.max(cfg.hardQueryCandidateCount, 20))
            : Math.max(requestedMax, 8);
        try {
          const scope = scopedIdentity(cfg, requireTrustedPrincipalContext(invocationContext));
          const headers = scopedHeaders(cfg, scope);
          const response = await postJson(cfg.baseUrl, cfg.searchPath, {
            query,
            n_results: fetchCount,
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
          return JSON.stringify({
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
          return JSON.stringify({ results: [], disabled: true, error: 'cortex_memory_search_failed', failure: safeFailureMetadata(error) });
        }
      },
      };
    }, { names: ['memory_search'] });

    api.registerTool(() => ({
      label: 'Memory Get', name: 'memory_get', description: 'Stub: Cortex does not currently expose OpenClaw-compatible file snippet reads.', parameters: GetSchema,
      execute: async (_toolCallId, params) => {
        const path = String((params as { path?: string }).path ?? '');
        return JSON.stringify({ path, text: '', disabled: true, error: 'cortex-memory-bridge does not implement memory_get yet; Cortex search endpoints return records, not workspace file snippets.' });
      },
    }), { names: ['memory_get'] });

    api.on('llm_output', (event: any, ctx: any) => {
      const text = extractText(event);
      if (!text) return;
      try {
        const binding = principalBinding(ctx);
        recentOutputByPrincipal.set(binding.namespace, text.slice(-recentOutputMaxChars));
      } catch (error) {
        api.logger.warn?.(`cortex-memory-bridge: refused recent output with incomplete principal ${safeFailureSummary(error)}`);
        throw error;
      }
    });

    api.on('subagent_ended', async (event: any, ctx: any) => {
      const cfg = initialConfig;
      const binding = principalBinding(ctx);
      const fallbackText = recentOutputByPrincipal.get(binding.namespace);
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: subagent_ended shape ${JSON.stringify({ principal: binding.namespace, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(binding.namespace, event, ctx, fallbackText || extractText(event?.result));
      await persistLifecycle(persistenceKey, cfg, { result: event?.result, messages: event?.messages }, binding.context, fallbackText);
    });

    api.on('agent_end', async (event: any, ctx: any) => {
      const cfg = initialConfig;
      const binding = principalBinding(ctx);
      const fallbackText = recentOutputByPrincipal.get(binding.namespace);
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: agent_end shape ${JSON.stringify({ principal: binding.namespace, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(binding.namespace, event, ctx, fallbackText || extractText(event?.result));
      const persisted = await persistLifecycle(persistenceKey, cfg, event, binding.context, fallbackText);
      if (persisted) {
        recentOutputByPrincipal.delete(binding.namespace);
      } else {
        throw new Error('Cortex lifecycle persistence failed; output retained for retry');
      }
    });
  },
};

export default plugin;
export { DurableLifecycleQuota, DurableLifecycleSpool, ExpiringLruMap, durabilityScore, buildWriteThroughMetadata, durableLifecycleMkdir, lifecyclePersistenceKey, reconcileResults, withLifecycleDirectoryLock };
