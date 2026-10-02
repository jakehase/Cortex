import crypto from 'node:crypto';
import path from 'node:path';

export const completionHandoffSchemaVersion = 'clawd.remote_completion_handoff.v2';

const MAX_FIELD_CHARS = 50_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function boundedText(value, maximum = MAX_FIELD_CHARS) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maximum) : null;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validTimestamp(value) {
  const text = boundedText(value, 128);
  return Boolean(text && Number.isFinite(Date.parse(text)));
}

export function extractCompletionSummary(stdout) {
  const candidates = [];
  for (const line of String(stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event?.item;
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      candidates.push(item.text);
    }
    if (event?.message?.role === 'assistant') {
      candidates.push(contentText(event.message.content));
    }
    if (event?.role === 'assistant') {
      candidates.push(contentText(event.content ?? event.text));
    }
  }
  return boundedText(candidates.filter((value) => String(value).trim()).at(-1));
}

export function defaultCompletionHandoffPath(resultArtifact) {
  const resolved = path.resolve(resultArtifact);
  const extension = path.extname(resolved);
  if (!extension) return `${resolved}.completion-handoff.json`;
  return `${resolved.slice(0, -extension.length)}.completion-handoff${extension}`;
}

function canonicalHandoffPayload(payload) {
  return {
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    status: payload.status,
    project: payload.project,
    task: payload.task,
    remainingWork: payload.remainingWork,
    completion: payload.completion,
    sourceExecution: payload.sourceExecution,
    sourceIdentity: payload.sourceIdentity,
    resultArtifact: payload.resultArtifact,
    verifierReceipt: payload.verifierReceipt,
    canonicalMemory: payload.canonicalMemory,
    truthBoundary: payload.truthBoundary,
  };
}

export function buildRemoteCompletionHandoff({
  result,
  project,
  task,
  completionSummary,
  remainingWork,
  resultArtifact = null,
}) {
  const summaryFromWorker = extractCompletionSummary(result?.stdout);
  const summary = boundedText(completionSummary) ?? summaryFromWorker;
  const boundedRemainingWork = boundedText(remainingWork);
  const startedAt = boundedText(result?.startedAt, 128);
  const completedAt = boundedText(result?.completedAt ?? result?.generatedAt, 128);
  const orderedTimestamps = validTimestamp(startedAt)
    && validTimestamp(completedAt)
    && Date.parse(startedAt) <= Date.parse(completedAt);
  const eventEvidence = result?.providerUsage ?? {};
  const executionComplete = Boolean(
    result?.ok
    && result?.launchConfirmed
    && result?.completionConfirmed
    && result?.exitCode === 0
    && eventEvidence.orderedSingleTurn === true
    && eventEvidence.finalAgentMessageObserved === true
    && eventEvidence.terminalFailureObserved === false
    && Number(eventEvidence.tokensObserved ?? 0) > 0
    && summary
    && orderedTimestamps
  );
  const artifactBound = Boolean(
    resultArtifact?.persisted === true
    && boundedText(resultArtifact?.path, 4096)
    && SHA256_PATTERN.test(String(resultArtifact?.sha256 ?? ''))
    && Number.isInteger(resultArtifact?.bytes)
    && resultArtifact.bytes > 0
  );
  const status = !executionComplete
    ? 'failed'
    : (artifactBound && !boundedRemainingWork ? 'complete' : 'execution_complete_review_required');
  const payload = {
    schemaVersion: completionHandoffSchemaVersion,
    handoffId: '',
    generatedAt: completedAt,
    status,
    project: boundedText(project, 256),
    task: boundedText(task, 1024),
    remainingWork: boundedRemainingWork,
    completion: {
      summary,
      summarySource: boundedText(completionSummary)
        ? 'explicit_launcher_input'
        : (summaryFromWorker ? 'worker_final_message' : 'unavailable'),
      summarySha256: summary ? sha256(summary) : null,
    },
    sourceExecution: {
      schemaVersion: boundedText(result?.schemaVersion, 128),
      action: boundedText(result?.action, 64),
      executionPlane: result?.executionPlane && typeof result.executionPlane === 'object'
        ? {
            host: boundedText(result.executionPlane.host, 512),
            workspace: boundedText(result.executionPlane.workspace, 2048),
          }
        : null,
      startedAt,
      completedAt,
      launchConfirmed: Boolean(result?.launchConfirmed),
      completionConfirmed: Boolean(result?.completionConfirmed),
      exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
      failureStage: boundedText(result?.failureStage, 256),
      failureCode: boundedText(result?.failureCode, 256),
      model: boundedText(result?.model, 256),
      reasoningEffort: boundedText(result?.reasoningEffort, 64),
      serviceTier: result?.serviceTier && typeof result.serviceTier === 'object'
        ? {
            requested: boundedText(result.serviceTier.requested, 64),
            transmitted: result.serviceTier.transmitted === true,
            providerConfirmed: result.serviceTier.providerConfirmed === true,
            policy: boundedText(result.serviceTier.policy, 128),
          }
        : null,
      providerUsage: result?.providerUsage && typeof result.providerUsage === 'object'
        ? {
            callsStarted: Number(result.providerUsage.callsStarted ?? 0) || 0,
            callsCompleted: Number(result.providerUsage.callsCompleted ?? 0) || 0,
            inputTokens: Number(result.providerUsage.inputTokens ?? 0) || 0,
            outputTokens: Number(result.providerUsage.outputTokens ?? 0) || 0,
            reasoningTokens: Number(result.providerUsage.reasoningTokens ?? 0) || 0,
            tokensObserved: Number(result.providerUsage.tokensObserved ?? 0) || 0,
            orderedSingleTurn: result.providerUsage.orderedSingleTurn === true,
            finalAgentMessageObserved: result.providerUsage.finalAgentMessageObserved === true,
            terminalFailureObserved: result.providerUsage.terminalFailureObserved === true,
            eventStreamSha256: SHA256_PATTERN.test(String(result.providerUsage.eventStreamSha256 ?? ''))
              ? result.providerUsage.eventStreamSha256
              : null,
          }
        : null,
    },
    sourceIdentity: result?.sourceIdentity && typeof result.sourceIdentity === 'object'
      ? {
          launcherSha256: SHA256_PATTERN.test(String(result.sourceIdentity.launcherSha256 ?? ''))
            ? result.sourceIdentity.launcherSha256
            : null,
          handoffModuleSha256: SHA256_PATTERN.test(String(result.sourceIdentity.handoffModuleSha256 ?? ''))
            ? result.sourceIdentity.handoffModuleSha256
            : null,
          configSha256: SHA256_PATTERN.test(String(result.sourceIdentity.configSha256 ?? ''))
            ? result.sourceIdentity.configSha256
            : null,
        }
      : null,
    resultArtifact: {
      path: artifactBound ? path.resolve(resultArtifact.path) : null,
      sha256: artifactBound ? resultArtifact.sha256 : null,
      bytes: artifactBound ? resultArtifact.bytes : null,
      persisted: artifactBound,
    },
    verifierReceipt: {
      orderedTurn: eventEvidence.orderedSingleTurn === true,
      finalResultPresent: Boolean(summary && eventEvidence.finalAgentMessageObserved === true),
      terminalFailureAbsent: eventEvidence.terminalFailureObserved === false,
      providerUsageObserved: Number(eventEvidence.tokensObserved ?? 0) > 0,
      timestampsOrdered: orderedTimestamps,
      exactResultArtifactBound: artifactBound,
    },
    canonicalMemory: {
      writePerformed: false,
      reviewRequired: status !== 'failed',
      target: 'canonical_project_memory',
    },
    truthBoundary: artifactBound
      ? 'Execution-plane completion evidence bound to the exact persisted result artifact. Canonical project memory still requires explicit review/ingestion.'
      : 'Execution-plane evidence is not bound to a persisted result artifact and cannot support a terminal completion handoff.',
  };
  payload.handoffId = sha256(JSON.stringify(canonicalHandoffPayload(payload)));
  payload.integrity = {
    algorithm: 'sha256',
    canonicalPayloadSha256: payload.handoffId,
    exactResultArtifactBound: artifactBound,
  };
  return payload;
}
