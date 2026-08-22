#!/usr/bin/env node
import fs from 'node:fs';

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const deadline = Date.now() + 10_000;
const waitCell = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(input.attackReadyPath)) {
  if (Date.now() >= deadline) process.exit(2);
  Atomics.wait(waitCell, 0, 0, 5);
}
let result = 'replaced';
try {
  fs.renameSync(input.attackReplacementPath, input.targetPath);
} catch (error) {
  result = `denied:${error.code || 'UNKNOWN'}:uid-${process.geteuid()}`;
}
fs.writeFileSync(input.attackResultPath, `${result}\n`, {
  flag: 'wx',
  mode: 0o644,
});
