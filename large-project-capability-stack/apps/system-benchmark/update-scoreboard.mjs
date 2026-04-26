#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { upsertBenchmarkScoreboardRow } from '../../packages/system-benchmark/index.mjs';

const scoreboardPath = path.resolve(process.argv[2] || path.join(process.cwd(), 'artifacts/benchmarks/scoreboard.json'));
const rowPath = process.argv[3] ? path.resolve(process.argv[3]) : null;

if (!rowPath) {
  console.error('Usage: node apps/system-benchmark/update-scoreboard.mjs <scoreboardPath> <scoreboardRowPath>');
  process.exit(1);
}

const row = JSON.parse(fs.readFileSync(rowPath, 'utf8'));
const scoreboard = upsertBenchmarkScoreboardRow({ scoreboardPath, row });

console.log(JSON.stringify({
  ok: true,
  scoreboardPath,
  rowPath,
  rowCount: scoreboard.rows.length,
  runId: row.runId
}, null, 2));
