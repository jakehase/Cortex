import { recordJobServiceHeartbeat, runJobs } from './jobs.mjs';

export function startJobLoop(state, intervalMs = 100) {
  const workerId = `mailclone-loop-${process.pid}`;
  recordJobServiceHeartbeat(state, { workerId, status: 'started', detail: 'job runtime loop started' });
  runJobs(state, { workerId });
  let lastHeartbeatAt = Date.now();
  const timer = setInterval(() => {
    runJobs(state, { workerId });
    if (Date.now() - lastHeartbeatAt >= 5000) {
      recordJobServiceHeartbeat(state, { workerId, status: 'running', detail: 'job runtime loop heartbeat' });
      lastHeartbeatAt = Date.now();
    }
  }, intervalMs);
  return {
    workerId,
    stop() {
      clearInterval(timer);
      recordJobServiceHeartbeat(state, { workerId, status: 'stopped', detail: 'job runtime loop stopped' });
    }
  };
}
