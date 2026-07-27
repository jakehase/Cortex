import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256File, sha256Text } from './hash.mjs';

function ownerWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
        || fs.readFileSync(filePath, 'utf8') !== rendered) throw new Error(`refusing worker artifact substitution: ${path.basename(filePath)}`);
    return;
  }
  fs.writeFileSync(filePath, rendered, { mode: 0o600, flag: 'wx' });
}

export function buildInertTransferProposal({
  artifactRoot,
  plan,
  tasks,
  attempts,
  providerCalls = null,
  terminalStatus = 'completed',
  claimedOutcome = 'candidate',
  completedAt = new Date().toISOString(),
} = {}) {
  if (!['completed', 'blocked'].includes(terminalStatus)) throw new Error('invalid worker terminal status');
  if (!['qualified', 'candidate', 'no-transfer', 'invalid', 'blocked', 'underpowered', 'null'].includes(claimedOutcome)) throw new Error('invalid claimed outcome');
  if (!Array.isArray(tasks) || !Array.isArray(attempts) || attempts.length > plan.budgets.maxTrials) throw new Error('invalid transfer proposal inputs');
  const root = path.resolve(artifactRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const files = {
    'plan.json': plan,
    'tasks.json': tasks,
    'attempts.json': attempts,
  };
  if (providerCalls !== null) {
    if (!Array.isArray(providerCalls) || providerCalls.length !== attempts.length) throw new Error('invalid provider call ledger');
    files['provider_calls.json'] = providerCalls;
  }
  for (const [name, value] of Object.entries(files)) ownerWriteJson(path.join(root, name), value);
  const proposal = {
    schemaVersion: 'cortex.learning_os.transfer_worker_proposal.v1',
    runId: plan.runId,
    profileId: plan.profileId,
    planDigest: sha256Text(canonicalJson(plan)),
    completedAt,
    terminalStatus,
    attemptsDigest: sha256Text(canonicalJson(attempts)),
    claimedOutcome,
    truthBoundary: 'This worker-authored proposal is inert and untrusted. Only independent control-plane replay may sign transfer state or install a live entry.',
  };
  ownerWriteJson(path.join(root, 'worker_proposal.json'), proposal);
  const rows = Object.keys({ ...files, 'worker_proposal.json': proposal }).sort().map((name) => ({
    path: name,
    sha256: sha256File(path.join(root, name)),
    bytes: fs.statSync(path.join(root, name)).size,
  }));
  const manifest = {
    schemaVersion: 'cortex.learning_os.transfer_artifact_manifest.v1',
    runId: plan.runId,
    generatedAt: completedAt,
    files: rows,
    truthBoundary: 'Manifest binds proposal artifacts byte-for-byte but does not make worker claims trusted.',
  };
  ownerWriteJson(path.join(root, 'artifact_manifest.json'), manifest);
  return { proposal, manifest };
}
