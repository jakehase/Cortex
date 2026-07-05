#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'required'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
  return fallback;
}

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.max(1, Number(ms) || 1));
}

function truncate(value = '', maxChars = 6000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.max(100, maxChars - head - 80);
  return `${text.slice(0, head)}\n...[truncated ${text.length - head - tail} chars]...\n${text.slice(-tail)}`;
}

function which(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120_000,
    maxBuffer: 1024 * 1024 * 20
  });
  return {
    ok: result.status === 0,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: truncate(result.stdout || ''),
    stderr: truncate([result.stderr, result.error?.message].filter(Boolean).join('\n'))
  };
}

function safeRead(filePath, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, 0);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function isGodotProductPath(rel = '') {
  const value = String(rel || '').replace(/^\.\//, '');
  if (!value || path.isAbsolute(value) || value.includes('..')) return false;
  if (/(^|\/)(?:docs?|tests?|__tests__|artifacts?|benchmarks?|fixtures?|mocks?)\//i.test(value)) return false;
  if (value === 'project.godot') return true;
  return /^(?:scripts|scenes|ui|assets|autoload|addons|tools\/editor|tools\/qa)\//.test(value)
    && /\.(?:gd|tscn|tres|res|cfg|json|import|shader|material)$/i.test(value);
}

function findAssetManifest(repoPath) {
  const candidates = ['assets/manifest.json', 'artifacts/game_asset_manifest.json'];
  for (const rel of candidates) {
    const full = path.join(repoPath, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return rel;
  }
  return null;
}

function check(checks, ok, id, message, details = {}, severity = 'blocking') {
  checks.push({ ok: Boolean(ok), id, message, severity, ...details });
}

function staticSurfaceChecks({ repoPath, surfaceId, file, kind, lane, checkAssetManifest }) {
  const checks = [];
  const projectPath = path.join(repoPath, 'project.godot');
  const filePath = path.join(repoPath, file);
  const repoExists = fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory();
  check(checks, repoExists, 'repo_exists', 'repo path exists and is a directory', { repoPath });
  check(checks, fs.existsSync(projectPath), 'godot_project_file_present', 'project.godot is present', { projectPath });
  check(checks, isGodotProductPath(file), 'assigned_file_is_godot_product_path', 'assigned file is a Godot product/runtime path, not docs/tests/artifacts', { file });
  check(checks, fs.existsSync(filePath) && fs.statSync(filePath).isFile(), 'assigned_product_file_present', 'assigned product file exists after implementation', { filePath });
  const source = safeRead(filePath);
  const nonTrivial = source.trim().length >= 40 && !/^\s*(?:#.*\n?)*\s*$/.test(source);
  check(checks, nonTrivial, 'assigned_product_file_nontrivial', 'assigned product file contains non-trivial implementation text', { byteCount: source.length });
  check(checks, Boolean(surfaceId), 'surface_id_present', 'surface id is provided', { surfaceId });
  check(checks, Boolean(kind), 'surface_kind_present', 'surface kind/domain is provided', { kind, lane });
  if (checkAssetManifest) {
    const manifest = findAssetManifest(repoPath);
    check(checks, Boolean(manifest), 'asset_manifest_present', 'asset manifest exists for asset/VFX/audio surfaces', { candidates: ['assets/manifest.json', 'artifacts/game_asset_manifest.json'], manifest });
  }
  return checks;
}

function optionalGodotChecks({ repoPath, args }) {
  const checks = [];
  const requireGodotCli = parseBool(args.requireGodotCli ?? process.env.GAME_VERIFY_REQUIRE_GODOT_CLI, false);
  const runImport = parseBool(args.runGodotImport ?? process.env.GAME_VERIFY_RUN_GODOT_IMPORT, false);
  const runHeadlessScene = parseBool(args.runHeadlessScene ?? process.env.GAME_VERIFY_RUN_HEADLESS_SCENE, false);
  const runMovementCombat = parseBool(args.runMovementCombat ?? process.env.GAME_VERIFY_RUN_MOVEMENT_COMBAT, false);
  const captureScreenshot = parseBool(args.captureScreenshot ?? process.env.GAME_VERIFY_CAPTURE_SCREENSHOT, false);
  const godotBin = process.env.GODOT_BIN || which('godot4') || which('godot') || null;

  check(checks, !requireGodotCli || Boolean(godotBin), 'godot_cli_available_when_required', 'Godot CLI is available when required by execution-plane policy', { godotBin, requireGodotCli });
  if (!godotBin) return checks;

  if (runImport) {
    checks.push({
      id: 'godot_headless_import_check',
      message: 'Godot headless import/project check exits cleanly',
      severity: 'blocking',
      ...runCommand(godotBin, ['--headless', '--path', repoPath, '--quit'], { cwd: repoPath, timeoutMs: positiveNumber(process.env.GAME_VERIFY_GODOT_TIMEOUT_MS, 180_000) })
    });
  }

  const sceneHarness = path.join(repoPath, 'tests/headless/scene_load_smoke.gd');
  check(checks, !runHeadlessScene || fs.existsSync(sceneHarness), 'headless_scene_harness_present', 'headless scene-load harness exists when execution is requested', { harnessPath: sceneHarness });
  if (runHeadlessScene && fs.existsSync(sceneHarness)) {
    checks.push({
      id: 'godot_headless_scene_load_harness',
      message: 'Godot headless scene-load harness exits cleanly',
      severity: 'blocking',
      ...runCommand(godotBin, ['--headless', '--path', repoPath, '--script', sceneHarness], { cwd: repoPath, timeoutMs: positiveNumber(process.env.GAME_VERIFY_GODOT_TIMEOUT_MS, 180_000) })
    });
  }

  const movementHarness = path.join(repoPath, 'tests/headless/player_movement_combat_smoke.gd');
  check(checks, !runMovementCombat || fs.existsSync(movementHarness), 'movement_combat_harness_present', 'movement/combat harness exists when execution is requested', { harnessPath: movementHarness });
  if (runMovementCombat && fs.existsSync(movementHarness)) {
    checks.push({
      id: 'godot_movement_combat_harness',
      message: 'Godot movement/combat harness exits cleanly',
      severity: 'blocking',
      ...runCommand(godotBin, ['--headless', '--path', repoPath, '--script', movementHarness], { cwd: repoPath, timeoutMs: positiveNumber(process.env.GAME_VERIFY_GODOT_TIMEOUT_MS, 180_000) })
    });
  }

  if (captureScreenshot) {
    const output = path.join(repoPath, 'artifacts/game-verification/latest-screenshot.png');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    checks.push({
      id: 'godot_screenshot_capture_optional',
      message: 'Optional screenshot capture command exits cleanly',
      severity: 'non_blocking',
      ...runCommand(godotBin, ['--headless', '--path', repoPath, '--quit'], { cwd: repoPath, timeoutMs: positiveNumber(process.env.GAME_VERIFY_GODOT_TIMEOUT_MS, 180_000) }),
      output
    });
  }

  return checks;
}

const args = parseArgs(process.argv.slice(2));
const surfaceId = String(args.surface || args.surfaceId || '').trim();
const file = String(args.file || '').trim();
const kind = String(args.kind || '').trim();
const lane = String(args.lane || '').trim();
const repoPath = path.resolve(args.repoPath || process.cwd());
const durationMs = positiveNumber(args.durationMs, 0);
const minCycles = Math.max(1, Math.floor(positiveNumber(args.minCycles, 1)));
const cycleIntervalMs = Math.max(50, positiveNumber(args.cycleIntervalMs, 60_000));
const checkAssetManifest = parseBool(args.checkAssetManifest, false);

if (!surfaceId || !file) {
  console.error('usage: node verify-godot-game-surface.mjs --surface <id> --file <relative-file> [--repo-path <repo>]');
  process.exit(2);
}

const startedAt = Date.now();
const startedAtIso = new Date(startedAt).toISOString();
const cycles = [];
let cycle = 0;
while (cycle < minCycles || (durationMs > 0 && Date.now() - startedAt < durationMs)) {
  cycle += 1;
  const cycleStartedAt = Date.now();
  const checks = [
    ...staticSurfaceChecks({ repoPath, surfaceId, file, kind, lane, checkAssetManifest }),
    ...optionalGodotChecks({ repoPath, args })
  ];
  cycles.push({
    cycle,
    startedAt: new Date(cycleStartedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - cycleStartedAt,
    ok: checks.filter((entry) => entry.severity !== 'non_blocking').every((entry) => entry.ok !== false),
    checks
  });
  if (durationMs <= 0 || Date.now() - startedAt >= durationMs) break;
  sleepMs(Math.min(cycleIntervalMs, Math.max(1, durationMs - (Date.now() - startedAt))));
}

const allChecks = cycles.flatMap((entry) => entry.checks);
const blockingFailures = allChecks.filter((entry) => entry.severity !== 'non_blocking' && entry.ok === false);
const finishedAt = Date.now();
const payload = {
  schemaVersion: 'clawd.godot_game_surface_verifier.v1',
  ok: blockingFailures.length === 0,
  surfaceId,
  file,
  kind,
  lane,
  repoPath,
  startedAt: startedAtIso,
  finishedAt: new Date(finishedAt).toISOString(),
  durationMs: finishedAt - startedAt,
  firstMeaningfulProgressMs: 0,
  firstMeaningfulProgressAt: startedAtIso,
  cyclesCompleted: cycles.length,
  checkKinds: Array.from(new Set(allChecks.map((entry) => entry.id))),
  blockingFailureCount: blockingFailures.length,
  blockingFailures,
  cycles
};

console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
