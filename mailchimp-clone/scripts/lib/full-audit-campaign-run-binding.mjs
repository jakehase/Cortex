import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRunId(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveMirroredRelativePath(workerStatus, key) {
  const rel = workerStatus?.mirrored?.[key];
  return typeof rel === 'string' && rel.trim().length > 0 ? rel.trim() : null;
}

export function resolveMirroredArtifactPath(rootDir, workerStatus, key, fallback = null) {
  if (fallback && fs.existsSync(fallback)) return fallback;
  const rel = resolveMirroredRelativePath(workerStatus, key);
  const mirroredPath = rel ? path.join(rootDir, rel) : null;
  if (mirroredPath && fs.existsSync(mirroredPath)) return mirroredPath;
  return fallback || mirroredPath;
}

export function resolveCampaignRunBinding({ rootDir, artifactDir, currentRunPath, workerStatusPath }) {
  const currentRun = readJson(currentRunPath, null);
  const workerStatus = readJson(workerStatusPath, null);
  const remoteExecutionStatusPath = resolveMirroredArtifactPath(rootDir, workerStatus, 'remoteExecutionStatusPath', null);
  const remoteExecutionStatus = remoteExecutionStatusPath ? readJson(remoteExecutionStatusPath, null) : null;

  const currentRunId = resolveRunId(currentRun?.runId);
  const remoteExecutionRunId = resolveRunId(remoteExecutionStatus?.runId);
  const workerRunId = resolveRunId(workerStatus?.runId) ?? remoteExecutionRunId;
  const currentRunTime = Math.max(parseTimestamp(currentRun?.generatedAt), parseTimestamp(currentRun?.startedAt));
  const workerTime = Math.max(
    parseTimestamp(workerStatus?.generatedAt),
    parseTimestamp(workerStatus?.updatedAt),
    parseTimestamp(workerStatus?.lastHeartbeatAt),
    parseTimestamp(remoteExecutionStatus?.generatedAt)
  );

  let runId = currentRunId;
  let source = currentRunId ? 'current_run' : 'missing';
  const currentRunStale = Boolean(workerRunId && currentRunId && currentRunId !== workerRunId);

  if (workerRunId && (!currentRunId || currentRunStale)) {
    if (!currentRunId || workerStatus?.running === true || workerTime >= currentRunTime) {
      runId = workerRunId;
      source = 'worker_status';
    }
  }

  const runDir = runId ? path.join(artifactDir, 'runs', runId) : null;
  const remoteExecutionMatchesRun = Boolean(runId && remoteExecutionRunId && remoteExecutionRunId === runId);
  const preferRemoteExecution = (currentRunStale || !currentRunId) && remoteExecutionMatchesRun;
  const resolvedCurrentRun = runId ? {
    ...(currentRun && typeof currentRun === 'object' ? currentRun : {}),
    runId,
    generatedAt: currentRun?.generatedAt ?? workerStatus?.generatedAt ?? remoteExecutionStatus?.generatedAt ?? null,
    startedAt: currentRun?.startedAt ?? workerStatus?.startedAt ?? workerStatus?.generatedAt ?? null,
    runDir: currentRun?.runDir ?? runDir,
    artifactRoot: currentRun?.artifactRoot ?? runDir,
    reportsDir: currentRun?.reportsDir ?? (runDir ? path.join(runDir, 'reports') : null),
    remoteArtifactRoot: preferRemoteExecution
      ? (remoteExecutionStatus?.artifactRoot ?? currentRun?.remoteArtifactRoot ?? null)
      : (currentRun?.remoteArtifactRoot ?? (remoteExecutionMatchesRun ? remoteExecutionStatus?.artifactRoot : null) ?? null),
    remoteWorktree: preferRemoteExecution
      ? (remoteExecutionStatus?.worktreePath ?? currentRun?.remoteWorktree ?? null)
      : (currentRun?.remoteWorktree ?? (remoteExecutionMatchesRun ? remoteExecutionStatus?.worktreePath : null) ?? null),
    remoteBaselineRepo: preferRemoteExecution
      ? (remoteExecutionStatus?.baselineRepo ?? currentRun?.remoteBaselineRepo ?? null)
      : (currentRun?.remoteBaselineRepo ?? (remoteExecutionMatchesRun ? remoteExecutionStatus?.baselineRepo : null) ?? null)
  } : currentRun;

  return {
    runId,
    runDir,
    source,
    currentRunStale,
    currentRun: resolvedCurrentRun,
    workerStatus,
    remoteExecutionStatus,
    remoteExecutionStatusPath
  };
}
