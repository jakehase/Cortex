#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="${1:-/root/clawd/artifacts/openclaw-upgrade-guard/latest-manifest.json}"
PACKAGE_DIR="/usr/lib/node_modules/openclaw"
CONFIG_PATH="/root/.openclaw/openclaw.json"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Manifest not found: $MANIFEST_PATH" >&2
  echo "Tip: run /root/clawd/scripts/openclaw-upgrade-snapshot.sh first" >&2
  exit 2
fi

node - "$MANIFEST_PATH" <<'NODE'
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const configPath = manifest.configPath || '/root/.openclaw/openclaw.json';
const packageDir = manifest.packageDir || '/usr/lib/node_modules/openclaw';

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function cmd(s) { try { return cp.execSync(s, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (err) { return null; } }
function findDistJsFiles(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'dist'))
      .filter(name => name.endsWith('.js'))
      .map(name => path.join(dir, 'dist', name));
  } catch {
    return [];
  }
}

const failures = [];
const warnings = [];
const notes = [];

if (!exists(configPath)) failures.push(`missing config: ${configPath}`);
if (!exists(manifest.servicePath)) warnings.push(`missing service file: ${manifest.servicePath}`);
if (!exists(packageDir)) failures.push(`missing package dir: ${packageDir}`);

let cfg = {};
try { cfg = readJson(configPath); } catch (err) { failures.push(`invalid config json: ${configPath}`); }

const loadPaths = (cfg.plugins && cfg.plugins.load && cfg.plugins.load.paths) || [];
const allow = (cfg.plugins && cfg.plugins.allow) || [];
const entries = Object.keys((cfg.plugins && cfg.plugins.entries) || {});

for (const requiredPath of (manifest.requiredSkillPaths || [])) {
  if (!exists(requiredPath)) failures.push(`missing required skill file: ${requiredPath}`);
}

for (const p of (manifest.pluginLoadPaths || [])) {
  if (!loadPaths.includes(p)) failures.push(`missing plugin load path: ${p}`);
}

for (const name of (manifest.requiredCustomPlugins || [])) {
  if (!allow.includes(name)) failures.push(`plugin not allowed in config: ${name}`);
  if (!entries.includes(name)) failures.push(`plugin entry missing in config: ${name}`);
}

const distFiles = findDistJsFiles(packageDir);
if (distFiles.length === 0) failures.push('no dist/*.js runtime files found');

for (const patch of (manifest.patchMarkers || [])) {
  let found = false;
  for (const file of distFiles) {
    const text = fs.readFileSync(file, 'utf8');
    if (patch.markers.every(marker => text.includes(marker))) {
      found = true;
      notes.push(`patch present: ${patch.name} -> ${path.basename(file)}`);
      break;
    }
  }
  if (!found) failures.push(`patch markers missing: ${patch.name}`);
}

const version = cmd('openclaw --version');
if (version) notes.push(`openclaw version: ${version}`);
const gatewayStatus = cmd('openclaw gateway status');
if (gatewayStatus) {
  notes.push('gateway status: ok');
} else {
  warnings.push('gateway status check failed');
}

const result = {
  manifestPath,
  ok: failures.length === 0,
  failures,
  warnings,
  notes
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.ok ? 0 : 1);
NODE
