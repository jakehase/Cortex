import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createPersistentDedupe } from "openclaw/plugin-sdk";

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

export default function register(api: OpenClawPluginApi) {
  const pluginCfg = (api.pluginConfig ?? {}) as OutboundDedupeConfig;
  const allowedChannels = new Set((pluginCfg.channels ?? ["whatsapp"]).map((v) => v.trim()).filter(Boolean));
  const ttlMs = Math.max(1000, Math.trunc(pluginCfg.ttlMs ?? DEFAULT_TTL_MS));
  const minNormalizedLength = Math.max(1, Math.trunc(pluginCfg.minNormalizedLength ?? DEFAULT_MIN_NORMALIZED_LENGTH));
  const persistentDedupe = createPersistentDedupe({
    ttlMs,
    memoryMaxSize: Math.max(1, Math.trunc(pluginCfg.memoryMaxSize ?? DEFAULT_MEMORY_MAX_SIZE)),
    fileMaxEntries: Math.max(1, Math.trunc(pluginCfg.fileMaxEntries ?? DEFAULT_FILE_MAX_ENTRIES)),
    resolveFilePath: (namespace) =>
      path.join(resolveStateDirFromEnv(), "outbound-dedupe", `${sanitizeSegment(namespace)}.json`),
    onDiskError: (error) => {
      api.logger.warn?.(`outbound-dedupe: disk error: ${String(error)}`);
    },
  });

  api.on("message_sending", async (event, ctx) => {
    if (!allowedChannels.has(ctx.channelId)) return;

    const normalized = normalizeContent(event.content ?? "");
    if (!normalized || normalized.length < minNormalizedLength) return;

    const accountId = (ctx.accountId ?? "default").trim() || "default";
    const namespace = `${ctx.channelId}:${accountId}:${event.to}`;
    const key = hashContent(normalized);
    const shouldSend = await persistentDedupe.checkAndRecord(key, {
      namespace,
      onDiskError: (error) => {
        api.logger.warn?.(`outbound-dedupe: check failed for ${namespace}: ${String(error)}`);
      },
    });

    if (shouldSend) return;

    api.logger.info?.(
      `outbound-dedupe: cancelled duplicate outbound ${ctx.channelId} message to ${event.to} (${normalized.slice(0, 80)})`,
    );
    return { cancel: true };
  });
}
