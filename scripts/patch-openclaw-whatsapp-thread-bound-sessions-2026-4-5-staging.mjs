#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const defaultTargetPath = '/tmp/openclaw-audit/pkg/package/dist/pi-embedded-DWASRjxE.js';
const args = process.argv.slice(2);
let targetPath = defaultTargetPath;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--file' && args[i + 1]) {
    targetPath = path.resolve(args[i + 1]);
    i += 1;
  }
}

const oldHelperBlock = `function resolveSpawnMode(params) {
\tif (params.requestedMode === "run" || params.requestedMode === "session") return params.requestedMode;
\treturn params.threadRequested ? "session" : "run";
}
function summarizeError$1(err) {
\tif (err instanceof Error) return err.message;
\tif (typeof err === "string") return err;
\treturn "error";
}
async function ensureThreadBindingForSubagentSpawn(params) {
\tconst hookRunner = params.hookRunner;
\tif (!hookRunner?.hasHooks("subagent_spawning")) return {
\t\tstatus: "error",
\t\terror: "thread=true is unavailable because no channel plugin registered subagent_spawning hooks."
\t};
\ttry {
\t\tconst result = await hookRunner.runSubagentSpawning({
\t\t\tchildSessionKey: params.childSessionKey,
\t\t\tagentId: params.agentId,
\t\t\tlabel: params.label,
\t\t\tmode: params.mode,
\t\t\trequester: params.requester,
\t\t\tthreadRequested: true
\t\t}, {
\t\t\tchildSessionKey: params.childSessionKey,
\t\t\trequesterSessionKey: params.requesterSessionKey
\t\t});
\t\tif (result?.status === "error") return {
\t\t\tstatus: "error",
\t\t\terror: result.error.trim() || "Failed to prepare thread binding for this subagent session."
\t\t};
\t\tif (result?.status !== "ok" || !result.threadBindingReady) return {
\t\t\tstatus: "error",
\t\t\terror: "Unable to create or bind a thread for this subagent session. Session mode is unavailable for this target."
\t\t};
\t\treturn { status: "ok" };
\t} catch (err) {
\t\treturn {
\t\t\tstatus: "error",
\t\t\terror: \`Thread bind failed: \${summarizeError$1(err)}\`
\t\t};
\t}
}
`;

const newHelperBlock = `function resolveSpawnMode(params) {
\tif (params.requestedMode === "run" || params.requestedMode === "session") return params.requestedMode;
\treturn params.threadRequested ? "session" : "run";
}
function summarizeError$1(err) {
\tif (err instanceof Error) return err.message;
\tif (typeof err === "string") return err;
\treturn "error";
}
function resolveSubagentSpawnConversationId(requester) {
\tconst threadId = requester?.threadId != null ? String(requester.threadId).trim() : "";
\tif (threadId) return threadId;
\tconst to = requester?.to != null ? String(requester.to).trim() : "";
\tif (!to) return;
\treturn resolveConversationIdForThreadBinding({
\t\tchannel: requester?.channel,
\t\tto,
\t\tthreadId: requester?.threadId
\t});
}
async function ensureCurrentConversationBindingForSubagentSpawn(params) {
\tconst channel = params.requester.channel?.trim().toLowerCase() || "";
\tif (!channel) return {
\t\tstatus: "error",
\t\terror: "thread=true requires an active channel conversation context."
\t};
\tconst accountId = params.requester.accountId?.trim() || "default";
\tconst policy = resolveThreadBindingSpawnPolicy({
\t\tcfg: params.cfg,
\t\tchannel,
\t\taccountId,
\t\tkind: "subagent"
\t});
\tif (!policy.enabled) return {
\t\tstatus: "error",
\t\terror: formatThreadBindingDisabledError({
\t\t\tchannel: policy.channel,
\t\t\taccountId: policy.accountId,
\t\t\tkind: "subagent"
\t\t})
\t};
\tif (!policy.spawnEnabled) return {
\t\tstatus: "error",
\t\terror: formatThreadBindingSpawnDisabledError({
\t\t\tchannel: policy.channel,
\t\t\taccountId: policy.accountId,
\t\t\tkind: "subagent"
\t\t})
\t};
\tconst bindingService = getSessionBindingService();
\tconst capabilities = bindingService.getCapabilities({
\t\tchannel: policy.channel,
\t\taccountId: policy.accountId
\t});
\tif (!capabilities.adapterAvailable || !capabilities.bindSupported) return {
\t\tstatus: "error",
\t\terror: \`Thread bindings are unavailable for \${policy.channel}.\`
\t};
\tif (!capabilities.placements.includes("current")) return {
\t\tstatus: "error",
\t\terror: \`Thread bindings do not support current placement for \${policy.channel}.\`
\t};
\tconst conversationId = resolveSubagentSpawnConversationId(params.requester);
\tif (!conversationId) return {
\t\tstatus: "error",
\t\terror: \`thread=true requires running inside an active \${policy.channel} conversation.\`
\t};
\tconst conversation = {
\t\tchannel: policy.channel,
\t\taccountId: policy.accountId,
\t\tconversationId
\t};
\tconst existingBinding = bindingService.resolveByConversation(conversation);
\tif (existingBinding && existingBinding.targetSessionKey !== params.childSessionKey && existingBinding.status !== "ended") return {
\t\tstatus: "error",
\t\terror: \`This \${policy.channel} conversation is already bound to another session. Unbind it first before spawning a new thread-bound subagent.\`
\t};
\ttry {
\t\tawait bindingService.bind({
\t\t\ttargetSessionKey: params.childSessionKey,
\t\t\ttargetKind: "subagent",
\t\t\tconversation,
\t\t\tplacement: "current",
\t\t\tmetadata: {
\t\t\t\tthreadName: resolveThreadBindingThreadName({
\t\t\t\t\tagentId: params.agentId,
\t\t\t\t\tlabel: params.label
\t\t\t\t}),
\t\t\t\tagentId: params.agentId,
\t\t\t\tlabel: params.label,
\t\t\t\tboundBy: "system",
\t\t\t\tintroText: resolveThreadBindingIntroText({
\t\t\t\t\tagentId: params.agentId,
\t\t\t\t\tlabel: params.label,
\t\t\t\t\tidleTimeoutMs: resolveThreadBindingIdleTimeoutMsForChannel({
\t\t\t\t\t\tcfg: params.cfg,
\t\t\t\t\t\tchannel: policy.channel,
\t\t\t\t\t\taccountId: policy.accountId
\t\t\t\t\t}),
\t\t\t\t\tmaxAgeMs: resolveThreadBindingMaxAgeMsForChannel({
\t\t\t\t\t\tcfg: params.cfg,
\t\t\t\t\t\tchannel: policy.channel,
\t\t\t\t\t\taccountId: policy.accountId
\t\t\t\t\t})
\t\t\t\t})
\t\t\t}
\t\t});
\t\treturn { status: "ok" };
\t} catch (err) {
\t\treturn {
\t\t\tstatus: "error",
\t\t\terror: \`Thread bind failed: \${summarizeError$1(err)}\`
\t\t};
\t}
}
async function ensureThreadBindingForSubagentSpawn(params) {
\tconst hookRunner = params.hookRunner;
\tif (hookRunner?.hasHooks("subagent_spawning")) try {
\t\tconst result = await hookRunner.runSubagentSpawning({
\t\t\tchildSessionKey: params.childSessionKey,
\t\t\tagentId: params.agentId,
\t\t\tlabel: params.label,
\t\t\tmode: params.mode,
\t\t\trequester: params.requester,
\t\t\tthreadRequested: true
\t\t}, {
\t\t\tchildSessionKey: params.childSessionKey,
\t\t\trequesterSessionKey: params.requesterSessionKey
\t\t});
\t\tif (result?.status === "error") return {
\t\t\tstatus: "error",
\t\t\terror: result.error.trim() || "Failed to prepare thread binding for this subagent session."
\t\t};
\t\tif (result?.status === "ok" && result.threadBindingReady) return { status: "ok" };
\t} catch (err) {
\t\treturn {
\t\t\tstatus: "error",
\t\t\terror: \`Thread bind failed: \${summarizeError$1(err)}\`
\t\t};
\t}
\treturn await ensureCurrentConversationBindingForSubagentSpawn(params);
}
`;

const oldCallSite = `\t\tconst bindResult = await ensureThreadBindingForSubagentSpawn({
\t\t\thookRunner,
\t\t\tchildSessionKey,
\t\t\tagentId: targetAgentId,
\t\t\tlabel: label || void 0,
\t\t\tmode: spawnMode,
\t\t\trequesterSessionKey: requesterInternalKey,
\t\t\trequester: {
\t\t\t\tchannel: requesterOrigin?.channel,
\t\t\t\taccountId: requesterOrigin?.accountId,
\t\t\t\tto: requesterOrigin?.to,
\t\t\t\tthreadId: requesterOrigin?.threadId
\t\t\t}
\t\t});`;

const newCallSite = `\t\tconst bindResult = await ensureThreadBindingForSubagentSpawn({
\t\t\tcfg,
\t\t\thookRunner,
\t\t\tchildSessionKey,
\t\t\tagentId: targetAgentId,
\t\t\tlabel: label || void 0,
\t\t\tmode: spawnMode,
\t\t\trequesterSessionKey: requesterInternalKey,
\t\t\trequester: {
\t\t\t\tchannel: requesterOrigin?.channel,
\t\t\t\taccountId: requesterOrigin?.accountId,
\t\t\t\tto: requesterOrigin?.to,
\t\t\t\tthreadId: requesterOrigin?.threadId
\t\t\t}
\t\t});`;

if (!fs.existsSync(targetPath)) {
  console.error(`Target file not found: ${targetPath}`);
  process.exit(1);
}

const current = fs.readFileSync(targetPath, 'utf8');
let next = current;

if (current.includes('function resolveSubagentSpawnConversationId(requester) {') && current.includes('\t\t\tcfg,')) {
  console.log('Already patched.');
  process.exit(0);
}

if (!current.includes(oldHelperBlock)) {
  console.error('Expected upstream helper block not found; refusing to patch blindly.');
  process.exit(1);
}
next = next.replace(oldHelperBlock, newHelperBlock);

if (!next.includes(oldCallSite)) {
  console.error('Expected upstream bind call site not found after helper replacement; refusing to continue.');
  process.exit(1);
}
next = next.replace(oldCallSite, newCallSite);

if (next === current) {
  console.log('No changes applied.');
  process.exit(0);
}

const backupPath = `${targetPath}.bak-whatsapp-thread-bindings-2026.4.5-staging`;
if (!fs.existsSync(backupPath)) fs.copyFileSync(targetPath, backupPath);
fs.writeFileSync(targetPath, next);
console.log(`Patched ${targetPath}`);
console.log(`Backup: ${backupPath}`);
