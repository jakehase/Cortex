import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLedger, appendLedgerEvent, writeCheckpoint, recoverFromLedger } from '../packages/recovery-ledger/index.mjs';

test('persists resume/recovery checkpoints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-ledger-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  createLedger(ledgerPath, { contractPath: '/tmp/contract.json', graphPath: '/tmp/graph.json', matrixPath: '/tmp/matrix.json' });
  appendLedgerEvent(ledgerPath, { type: 'step' });
  writeCheckpoint(ledgerPath, 'after-step', { ready: true });
  const recovered = recoverFromLedger(ledgerPath);
  assert.equal(recovered.contractPath, '/tmp/contract.json');
  assert.equal(recovered.latestCheckpoint.label, 'after-step');
  assert.equal(recovered.eventCount, 1);
});
