#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBenchmarkGroundTruth, readBenchmarkScoreboard } from '../../packages/system-benchmark/index.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const stackRoot = path.resolve(scriptDir, '../..');
const scoreboardPath = path.resolve(process.argv[2] || path.join(stackRoot, 'artifacts/benchmarks/scoreboard.json'));
const outputPath = path.resolve(process.argv[3] || path.join(path.dirname(scoreboardPath), 'ground_truth.json'));

const scoreboard = readBenchmarkScoreboard(scoreboardPath);
const summary = buildBenchmarkGroundTruth(scoreboard);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, scoreboardPath, outputPath, benchmarkCount: summary.benchmarkCount, trustedThresholdPassCount: summary.trustedThresholdPassCount }, null, 2));
