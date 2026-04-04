import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type OutboundDedupeConfig = {
  channels?: string[];
  ttlMs?: number;
  minNormalizedLength?: number;
  memoryMaxSize?: number;
  fileMaxEntries?: number;
};

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_NORMALIZED_LENGTH = 1;
const DEFAULT_MEMORY_MAX_SIZE = 5000;
const DEFAULT_FILE_MAX_ENTRIES = 50000;

type NamespaceState = {
  loaded: boolean;
  entries: Map<string, number>;
};

const namespaceState = new Map<string, NamespaceState>();
const namespaceLocks = new Map<string, Promise<void>>();

function resolveStateDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const stateOverride = env.OPENCLAW_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) return stateOverride;
  return path.join(os.homedir(), ".openclaw");
}

function sanitizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "default";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveNamespaceFile(namespace: string): string {
  return path.join(resolveStateDirFromEnv(), "outbound-dedupe", `${sanitizeSegment(namespace)}.json`);
}

function normalizeContent(content: string): string {
  return content
    .replace(/\[\[\s*reply_to:[^\]]+\]\]/gi, "")
    .replace(/\[\[\s*reply_to_current\s*\]\]/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*(noted\.?\s*)?cortex upstream routing applied:[^\n]*$/gim, "")
    .trim();
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function pruneEntries(entries: Map<string, number>, now: number, ttlMs: number, fileMaxEntries: number) {
  for (const [key, ts] of entries) {
    if (now - ts > ttlMs) entries.delete(key);
  }

  if (entries.size <= fileMaxEntries) return;

  const trimmed = [...entries.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, fileMaxEntries);

  entries.clear();
  for (const [key, ts] of trimmed) entries.set(key, ts);
}

async function loadNamespace(namespace: string, ttlMs: number, fileMaxEntries: number, onDiskError?: (error: unknown) => void) {
  let state = namespaceState.get(namespace);
  if (!state) {
    state = { loaded: false, entries: new Map<string, number>() };
    namespaceState.set(namespace, state);
  }

  if (state.loaded) return state;

  const filePath = resolveNamespaceFile(namespace);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: Array<{ key?: string; ts?: number }> };
    for (const entry of parsed.entries ?? []) {
      if (typeof entry?.key !== "string" || typeof entry?.ts !== "number") continue;
      state.entries.set(entry.key, entry.ts);
    }
  } catch (error) {
    const message = String(error);
    if (!message.includes("ENOENT")) onDiskError?.(error);
  }

  pruneEntries(state.entries, Date.now(), ttlMs, fileMaxEntries);
  state.loaded = true;
  return state;
}

async function persistNamespace(namespace: string, state: NamespaceState, onDiskError?: (error: unknown) => void) {
  const filePath = resolveNamespaceFile(namespace);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
      entries: [...state.entries.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, ts]) => ({ key, ts })),
    };
    await writeFile(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
  } catch (error) {
    onDiskError?.(error);
  }
}

async function withNamespaceLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
  const previous = namespaceLocks.get(namespace) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  namespaceLocks.set(namespace, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (namespaceLocks.get(namespace) === current) {
      namespaceLocks.delete(namespace);
    }
  }
}

async function checkAndRecordPersistent(
  namespace: string,
  key: string,
  ttlMs: number,
  fileMaxEntries: number,
  memoryMaxSize: number,
  onDiskError?: (error: unknown) => void,
) {
  return withNamespaceLock(namespace, async () => {
    const state = await loadNamespace(namespace, ttlMs, fileMaxEntries, onDiskError);
    const now = Date.now();
    pruneEntries(state.entries, now, ttlMs, fileMaxEntries);

    const seenAt = state.entries.get(key);
    if (typeof seenAt === "number" && now - seenAt <= ttlMs) {
      return false;
    }

    state.entries.set(key, now);
    pruneEntries(state.entries, now, ttlMs, Math.min(fileMaxEntries, memoryMaxSize));
    await persistNamespace(namespace, state, onDiskError);
    return true;
  });
}

export default function register(api: OpenClawPluginApi) {
  const pluginCfg = (api.pluginConfig ?? {}) as OutboundDedupeConfig;
  const allowedChannels = new Set((pluginCfg.channels ?? ["whatsapp"]).map((v) => v.trim()).filter(Boolean));
  const ttlMs = Math.max(1000, Math.trunc(pluginCfg.ttlMs ?? DEFAULT_TTL_MS));
  const minNormalizedLength = Math.max(1, Math.trunc(pluginCfg.minNormalizedLength ?? DEFAULT_MIN_NORMALIZED_LENGTH));
  const memoryMaxSize = Math.max(1, Math.trunc(pluginCfg.memoryMaxSize ?? DEFAULT_MEMORY_MAX_SIZE));
  const fileMaxEntries = Math.max(1, Math.trunc(pluginCfg.fileMaxEntries ?? DEFAULT_FILE_MAX_ENTRIES));

  api.on("message_sending", async (event, ctx) => {
    if (!allowedChannels.has(ctx.channelId)) return;

    const normalized = normalizeContent(event.content ?? "");
    if (!normalized || normalized.length < minNormalizedLength) return;

    const accountId = (ctx.accountId ?? "default").trim() || "default";
    const namespace = `${ctx.channelId}:${accountId}:${event.to}`;
    const key = hashContent(normalized);
    const shouldSend = await checkAndRecordPersistent(namespace, key, ttlMs, fileMaxEntries, memoryMaxSize, (error) => {
      api.logger.warn?.(`outbound-dedupe: check failed for ${namespace}: ${String(error)}`);
    });

    if (shouldSend) return;

    api.logger.info?.(
      `outbound-dedupe: cancelled duplicate outbound ${ctx.channelId} message to ${event.to} (${normalized.slice(0, 80)})`,
    );
    return { cancel: true };
  });
}
