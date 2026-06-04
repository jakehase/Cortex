#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveNumber(name, fallback) {
  const raw = Number(process.env[name] || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const relPath = process.argv[2];
const surfaceId = process.argv[3] || path.basename(relPath || 'surface');
if (!relPath || path.isAbsolute(relPath) || relPath.includes('..')) {
  console.log(JSON.stringify({ ok: false, surfaceId, modulePath: relPath || null, error: 'usage: verify-control-plane-module-endurance.mjs <relative-module-path> [surface-id]' }));
  process.exit(2);
}

const minDurationMs = readPositiveNumber('CONTROL_PLANE_BENCHMARK_SURFACE_MIN_DURATION_MS', readPositiveNumber('STACK_B3_BENCHMARK_SURFACE_MIN_DURATION_MS', 120 * 60 * 1000));
const minCycles = Math.max(1, Math.floor(readPositiveNumber('CONTROL_PLANE_BENCHMARK_SURFACE_MIN_CYCLES', readPositiveNumber('STACK_B3_BENCHMARK_SURFACE_MIN_CYCLES', 3))));
const cycleIntervalMs = readPositiveNumber('CONTROL_PLANE_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS', readPositiveNumber('STACK_B3_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS', 60 * 1000));
const maxCycleIntervalMs = Math.max(1, cycleIntervalMs);
const absPath = path.resolve(process.cwd(), relPath);
const startedAt = Date.now();
let firstMeaningfulProgressMs = null;
let cyclesCompleted = 0;
const errors = [];

async function importOnce(cycle) {
  const url = `${pathToFileURL(absPath).href}?controlPlaneEnduranceCycle=${cycle}&t=${Date.now()}`;
  await import(url);
}

try {
  while (true) {
    const cycleStartedAt = Date.now();
    cyclesCompleted += 1;
    await importOnce(cyclesCompleted);
    if (firstMeaningfulProgressMs == null) firstMeaningfulProgressMs = Date.now() - startedAt;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= minDurationMs && cyclesCompleted >= minCycles) break;

    const remainingDurationMs = Math.max(0, minDurationMs - elapsedMs);
    const remainingCycles = Math.max(0, minCycles - cyclesCompleted);
    const nextDelayMs = remainingCycles > 0
      ? Math.min(maxCycleIntervalMs, Math.max(1, Math.ceil(remainingDurationMs / Math.max(1, remainingCycles))))
      : Math.min(maxCycleIntervalMs, Math.max(1, remainingDurationMs));
    const cycleCostMs = Date.now() - cycleStartedAt;
    await sleep(Math.max(1, nextDelayMs - cycleCostMs));
  }

  const durationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    ok: true,
    surfaceId,
    modulePath: relPath,
    durationMs,
    cyclesCompleted,
    firstMeaningfulProgressMs,
    firstMeaningfulProgressAt: new Date(startedAt + firstMeaningfulProgressMs).toISOString(),
    minDurationMs,
    minCycles
  }));
  process.exit(0);
} catch (error) {
  errors.push(error?.stack || error?.message || String(error));
  console.log(JSON.stringify({
    ok: false,
    surfaceId,
    modulePath: relPath,
    durationMs: Date.now() - startedAt,
    cyclesCompleted,
    firstMeaningfulProgressMs,
    minDurationMs,
    minCycles,
    errors
  }));
  process.exit(2);
}
