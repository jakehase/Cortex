import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type OutboundDedupeConfig = { channels?: string[]; ttlMs?: number; minNormalizedLength?: number; memoryMaxSize?: number; fileMaxEntries?: number };
type Delivery = { version: "openclaw.delivery-hook.v1"; deliveryId: string; payloadIndex: number; attemptId: string; phase: "sending" | "completed"; visibleSendEvidence?: boolean };
type NamespaceState = { loaded: boolean; entries: Map<string, number> };
type Reservation = { attemptId: string; expiresAt: number };
const namespaceState = new Map<string, NamespaceState>();
const namespaceLocks = new Map<string, Promise<void>>();
const reservations = new Map<string, Reservation>();
const RESERVATION_MS = 5 * 60 * 1000;

function resolveNamespaceFile(namespace: string): string {
  const state = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  return path.join(state, "outbound-dedupe", `${namespace.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "default"}.json`);
}
function hash(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizeContent(content: string): string {
  return content.replace(/\[\[\s*reply_to:[^\]]+\]\]/gi, "").replace(/\[\[\s*reply_to_current\s*\]\]/gi, "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\s*(noted\.?\s*)?cortex upstream routing applied:[^\n]*$/gim, "").trim();
}
function deliveryFromContext(context: unknown, phase: Delivery["phase"]): Delivery | null {
  const value = (context as { cortexDelivery?: Delivery } | null)?.cortexDelivery;
  if (!value || value.version !== "openclaw.delivery-hook.v1" || value.phase !== phase) return null;
  if (typeof value.deliveryId !== "string" || !value.deliveryId.trim() || value.deliveryId.length > 256) return null;
  if (typeof value.attemptId !== "string" || !value.attemptId.trim() || value.attemptId.length > 256) return null;
  if (!Number.isSafeInteger(value.payloadIndex) || value.payloadIndex < 0) return null;
  return value;
}
function pruneEntries(entries: Map<string, number>, now: number, ttlMs: number, maximum: number) {
  for (const [key, ts] of entries) if (!Number.isFinite(ts) || now - ts > ttlMs) entries.delete(key);
  if (entries.size > maximum) {
    const retained = [...entries].sort((a, b) => b[1] - a[1]).slice(0, maximum);
    entries.clear(); for (const [key, ts] of retained) entries.set(key, ts);
  }
}
async function withNamespaceLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
  const previous = namespaceLocks.get(namespace) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  namespaceLocks.set(namespace, queued);
  await previous;
  try { return await fn(); }
  finally { release(); if (namespaceLocks.get(namespace) === queued) namespaceLocks.delete(namespace); }
}
async function loadNamespace(namespace: string, ttlMs: number, maximum: number, warn: () => void) {
  let state = namespaceState.get(namespace);
  if (!state) { state = { loaded: false, entries: new Map() }; namespaceState.set(namespace, state); }
  if (!state.loaded) {
    try {
      const parsed = JSON.parse(await readFile(resolveNamespaceFile(namespace), "utf-8"));
      for (const entry of parsed.entries ?? []) if (typeof entry?.key === "string" && Number.isFinite(entry?.ts)) state.entries.set(entry.key, entry.ts);
    } catch (error) { if ((error as { code?: string })?.code !== "ENOENT") warn(); }
    state.loaded = true;
  }
  pruneEntries(state.entries, Date.now(), ttlMs, maximum);
  return state;
}
async function persistNamespace(namespace: string, state: NamespaceState, warn: () => void) {
  try {
    const file = resolveNamespaceFile(namespace);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ entries: [...state.entries].sort((a, b) => b[1] - a[1]).map(([key, ts]) => ({ key, ts })) }) + "\n", "utf-8");
  } catch { warn(); }
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as OutboundDedupeConfig;
  const channels = new Set((cfg.channels ?? ["whatsapp"]).map(value => value.trim()).filter(Boolean));
  const ttlMs = Math.max(1000, Math.trunc(cfg.ttlMs ?? 6 * 60 * 60 * 1000));
  const minLength = Math.max(1, Math.trunc(cfg.minNormalizedLength ?? 1));
  const memoryMaxSize = Math.max(1, Math.trunc(cfg.memoryMaxSize ?? 5000));
  const fileMaxEntries = Math.max(1, Math.trunc(cfg.fileMaxEntries ?? 50000));
  const maximum = Math.min(memoryMaxSize, fileMaxEntries);
  const warn = () => api.logger.warn?.("outbound-dedupe: delivery ledger persistence failed");
  const keyFor = (delivery: Delivery) => hash(JSON.stringify(["native-delivery-v3", delivery.deliveryId, delivery.payloadIndex]));
  const namespaceFor = (event: { to: string }, ctx: { channelId: string; accountId?: string }) => `${ctx.channelId}:${ctx.accountId?.trim() || "default"}:${event.to}`;

  api.on("message_sending", async (event, ctx) => {
    if (!channels.has(ctx.channelId)) return;
    const delivery = deliveryFromContext(ctx, "sending");
    // Ingress is a preliminary hook, not a send receipt. Uninstrumented legacy
    // paths also lack a safe completion identity and cannot justify a TTL block.
    if (!delivery) return;
    const normalized = normalizeContent(event.content ?? "");
    if (!normalized || normalized.length < minLength) return;
    const namespace = namespaceFor(event, ctx), key = keyFor(delivery);
    const reservationKey = hash(JSON.stringify([namespace, key]));
    const cancelled = await withNamespaceLock(namespace, async () => {
      const state = await loadNamespace(namespace, ttlMs, maximum, warn);
      const now = Date.now();
      for (const [id, reservation] of reservations) if (reservation.expiresAt <= now) reservations.delete(id);
      const seenAt = state.entries.get(key);
      if (seenAt !== undefined && now - seenAt <= ttlMs) return true;
      if (reservations.has(reservationKey)) return true;
      // Native durable queue claims remain authoritative even if this optional
      // in-process guard is at capacity. Never hide a new reply to free space.
      if (reservations.size >= memoryMaxSize) return false;
      reservations.set(reservationKey, { attemptId: delivery.attemptId, expiresAt: now + RESERVATION_MS });
      return false;
    });
    if (!cancelled) return;
    api.logger.info?.(`outbound-dedupe: cancelled repeated native delivery ${ctx.channelId}`);
    return { cancel: true };
  });

  api.on("message_sent", async (event, ctx) => {
    if (!channels.has(ctx.channelId)) return;
    const delivery = deliveryFromContext(ctx, "completed");
    if (!delivery) return;
    const namespace = namespaceFor(event, ctx), key = keyFor(delivery);
    const reservationKey = hash(JSON.stringify([namespace, key]));
    await withNamespaceLock(namespace, async () => {
      const reservation = reservations.get(reservationKey);
      // A cancelled concurrent attempt or a late completion can never release,
      // commit, or overwrite the reservation belonging to another attempt.
      if (!reservation || reservation.attemptId !== delivery.attemptId) return;
      reservations.delete(reservationKey);
      if (event.success !== true || delivery.visibleSendEvidence !== true) return;
      // Partial/unknown failures remain native queue reconciliation decisions;
      // only complete payload success commits this optional duplicate ledger.
      const state = await loadNamespace(namespace, ttlMs, maximum, warn);
      state.entries.set(key, Date.now());
      pruneEntries(state.entries, Date.now(), ttlMs, maximum);
      await persistNamespace(namespace, state, warn);
    });
  });
}
