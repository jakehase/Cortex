export function extractCurrentTestHint(processEntries = []) {
  const commands = processEntries
    .map((entry) => entry?.command || entry?.cmd || '')
    .filter(Boolean);
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    const matches = command.match(/tests\/[A-Za-z0-9._/-]+\.test\.mjs/g);
    if (matches?.length) return matches[matches.length - 1];
  }
  return null;
}

export function buildHeartbeatSummary({ now = Date.now(), startedAt = null, lastOutputAt = null, artifactStates = [], processEntries = [] } = {}) {
  const artifactTimes = artifactStates
    .map((entry) => Number(entry?.mtimeMs || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const lastArtifactAt = artifactTimes.length ? Math.max(...artifactTimes) : null;
  const startedAtMs = startedAt ? Date.parse(startedAt) : null;
  const lastOutputAtMs = lastOutputAt ? Date.parse(lastOutputAt) : null;
  const lastProgressAtMs = [lastOutputAtMs, lastArtifactAt].filter((value) => Number.isFinite(value) && value > 0);
  const lastProgressAt = lastProgressAtMs.length ? new Date(Math.max(...lastProgressAtMs)).toISOString() : startedAt;
  const staleForSec = lastProgressAt ? Math.max(0, Math.round((now - Date.parse(lastProgressAt)) / 1000)) : null;
  const runningForSec = startedAtMs ? Math.max(0, Math.round((now - startedAtMs) / 1000)) : null;
  return {
    currentTestHint: extractCurrentTestHint(processEntries),
    lastProgressAt,
    staleForSec,
    runningForSec
  };
}
