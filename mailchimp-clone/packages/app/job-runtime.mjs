import { runJobs } from './jobs.mjs';

export function startJobLoop(state, intervalMs = 100) {
  runJobs(state);
  const timer = setInterval(() => runJobs(state), intervalMs);
  return { stop() { clearInterval(timer); } };
}
