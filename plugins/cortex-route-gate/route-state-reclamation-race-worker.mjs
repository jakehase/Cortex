import fs from 'node:fs';
import path from 'node:path';
import { updateJson } from './index.ts';

const [targetPath, coordinationDir, role] = process.argv.slice(2);
const readNumber = (name) => {
  try { return Number(fs.readFileSync(path.join(coordinationDir, name), 'utf8')) || 0; } catch { return 0; }
};
const writeNumber = (name, value) => fs.writeFileSync(path.join(coordinationDir, name), String(value));

updateJson(targetPath, { mutations: [] }, (state) => {
  const active = readNumber('active') + 1;
  writeNumber('active', active);
  writeNumber('max-concurrent', Math.max(readNumber('max-concurrent'), active));
  fs.writeFileSync(path.join(coordinationDir, `${role}.entered`), '');
  if (role !== 'second-reclaimer') {
    const release = path.join(coordinationDir, `${role}.release`);
    while (!fs.existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  state.mutations.push(role);
  writeNumber('active', readNumber('active') - 1);
});
