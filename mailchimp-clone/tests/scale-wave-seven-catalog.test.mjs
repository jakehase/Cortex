import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleWaveSevenCatalog, summarizeScaleWaveSevenCatalog, createScaleWaveSevenAppShellCatalog } from '../packages/scale-wave-seven/index.mjs';

test('scale wave seven catalog tracks the large expansion wave and its app shells', () => {
  const groups = createScaleWaveSevenCatalog();
  const summary = summarizeScaleWaveSevenCatalog(groups);
  const shells = createScaleWaveSevenAppShellCatalog(groups);
  assert.equal(summary.groupCount, 5);
  assert.equal(summary.totalModules, 540);
  assert.equal(shells.length, 5);
  assert.ok(groups.every((group) => group.modules.length >= 1));
  assert.ok(shells.every((shell) => shell.totalModules >= 1));
});

