import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { readJson } from '../src/json.mjs';
import { CLOS_ROOT } from '../src/paths.mjs';

function filesUnder(root, suffixes) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(target, suffixes);
    return suffixes.some((suffix) => entry.name.endsWith(suffix)) ? [target] : [];
  });
}

test('all Learning OS production reasoning defaults are xhigh', () => {
  const policy = readJson(path.join(CLOS_ROOT, 'policies/adaptive-math-v0.8.json'));
  assert.equal(policy.modelRuntime.thinking, 'xhigh');

  const productionFiles = [
    ...filesUnder(path.join(CLOS_ROOT, 'src'), ['.mjs', '.js']),
    ...filesUnder(path.join(CLOS_ROOT, 'scripts'), ['.sh', '.mjs', '.js']),
  ];
  const weakerDefault = /(?:thinking|reasoningEffort)\s*(?:=|:)\s*['"](?:off|minimal|low|medium|high)['"]|thinkingArgument\s*\|\|\s*['"](?:off|minimal|low|medium|high)['"]|value\(['"]--reasoning['"],\s*['"](?:off|minimal|low|medium|high)['"]\)|--thinking\s+(?:off|minimal|low|medium|high)\b/g;
  const violations = productionFiles.flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(weakerDefault)].map((match) => `${path.relative(CLOS_ROOT, file)}: ${match[0]}`);
  });
  assert.deepEqual(violations, []);
});
