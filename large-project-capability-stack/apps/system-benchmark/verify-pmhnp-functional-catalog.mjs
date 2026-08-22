#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PMHNP_TIER2_SCENARIOS } from './pmhnp-tier2-scenarios.mjs';

const scenarioScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'verify-pmhnp-functional-scenario.mjs');
const results = [];
const startedAt = Date.now();

for (const scenario of PMHNP_TIER2_SCENARIOS) {
  const run = spawnSync(process.execPath, [scenarioScript, scenario.id], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });

  const rawStdout = String(run.stdout || '').trim();
  const candidate = rawStdout.split('\n').filter(Boolean).reverse().find((line) => line.trim().startsWith('{')) || rawStdout;
  let parsed = null;
  try {
    parsed = JSON.parse(candidate || '{}');
  } catch {
    parsed = {
      ok: false,
      scenarioId: scenario.id,
      error: 'catalog_child_output_parse_failed',
      stdout: run.stdout || '',
      stderr: run.stderr || ''
    };
  }

  results.push({
    scenarioId: scenario.id,
    label: scenario.label,
    ok: run.status === 0 && parsed.ok !== false,
    exitCode: run.status,
    output: parsed,
    stderr: run.stderr || ''
  });

  if (run.status !== 0 || parsed.ok === false) break;
}

const ok = results.length === PMHNP_TIER2_SCENARIOS.length && results.every((entry) => entry.ok);
console.log(JSON.stringify({
  ok,
  scenarioCount: PMHNP_TIER2_SCENARIOS.length,
  passedCount: results.filter((entry) => entry.ok).length,
  durationMs: Date.now() - startedAt,
  results
}));
process.exit(ok ? 0 : 2);
