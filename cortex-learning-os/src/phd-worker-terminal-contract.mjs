export const PHD_WORKER_SUMMARY_SCHEMA =
  'cortex.learning_os.phd_worker_summary.v2';
export const PHD_WORKER_BLOCKER_SCHEMA =
  'cortex.learning_os.phd_worker_blocker.v1';

const BLOCKER_CODES = new Set([
  'mechanically_invalid',
  'worker_exception',
]);
const BLOCKER_PHASES = new Set([
  'inert_execution',
  'model_execution',
  'worker_exception',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function boundedMessage(message) {
  const normalized = String(message || '')
    .replaceAll(/[\u0000-\u001f\u007f]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return (normalized || 'qualification worker failed closed').slice(0, 1000);
}

export function createPhdWorkerBlocker({
  code,
  phase,
  message,
} = {}) {
  const blocker = {
    schemaVersion: PHD_WORKER_BLOCKER_SCHEMA,
    code,
    phase,
    message: boundedMessage(message),
  };
  if (!validatePhdWorkerBlocker(blocker)) {
    throw new Error('invalid PhD worker blocker');
  }
  return blocker;
}

export function validatePhdWorkerBlocker(blocker) {
  return exactKeys(blocker, ['schemaVersion', 'code', 'phase', 'message'])
    && blocker.schemaVersion === PHD_WORKER_BLOCKER_SCHEMA
    && BLOCKER_CODES.has(blocker.code)
    && BLOCKER_PHASES.has(blocker.phase)
    && typeof blocker.message === 'string'
    && blocker.message.length >= 1
    && blocker.message.length <= 1000
    && blocker.message === boundedMessage(blocker.message);
}

export function phdWorkerSummaryKeys(status) {
  const keys = [
    'schemaVersion', 'jobId', 'campaignId', 'jobDigest', 'executor', 'status',
    'notBefore', 'startedAt', 'completedAt', 'expiresAt', 'executionIntervalSha256',
    'timingProvenance', 'outputSha256', 'executionIdentity', 'authority',
    'canonicalStateMutated', 'truthBoundary',
  ];
  if (status === 'failed') keys.push('blocker');
  return keys;
}

export function validatePhdWorkerSummaryStatus(summary) {
  if (!isRecord(summary)
      || summary.schemaVersion !== PHD_WORKER_SUMMARY_SCHEMA
      || !['candidate', 'failed'].includes(summary.status)
      || !exactKeys(summary, phdWorkerSummaryKeys(summary.status))) {
    return false;
  }
  return summary.status === 'candidate'
    ? !Object.hasOwn(summary, 'blocker')
    : validatePhdWorkerBlocker(summary.blocker);
}
