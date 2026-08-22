import fs from 'node:fs';
import path from 'node:path';

function load(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function save(filePath, ledger) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2));
  return ledger;
}

export function createLedger(filePath, seed = {}) {
  const ledger = {
    version: 1,
    createdAt: new Date().toISOString(),
    contractPath: seed.contractPath || null,
    graphPath: seed.graphPath || null,
    matrixPath: seed.matrixPath || null,
    events: [],
    checkpoints: []
  };
  return save(filePath, ledger);
}

export function appendLedgerEvent(filePath, event) {
  const ledger = load(filePath);
  ledger.events.push({ at: new Date().toISOString(), ...event });
  return save(filePath, ledger);
}

export function writeCheckpoint(filePath, label, payload) {
  const ledger = load(filePath);
  ledger.checkpoints.push({ at: new Date().toISOString(), label, payload });
  return save(filePath, ledger);
}

export function recoverFromLedger(filePath) {
  const ledger = load(filePath);
  return {
    contractPath: ledger.contractPath,
    graphPath: ledger.graphPath,
    matrixPath: ledger.matrixPath,
    latestCheckpoint: ledger.checkpoints.at(-1) || null,
    eventCount: ledger.events.length
  };
}

export function loadLedger(filePath) {
  return load(filePath);
}
