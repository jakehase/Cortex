#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BASE_DIR="/root/clawd/artifacts/openclaw-upgrade-guard"
SNAPSHOT_DIR="$BASE_DIR/baseline-$STAMP"
PACKAGE_DIR="/usr/lib/node_modules/openclaw"
CONFIG_PATH="/root/.openclaw/openclaw.json"
SERVICE_PATH="/root/.config/systemd/user/openclaw-gateway.service"
PLUGINS_DIR="/root/clawd/plugins"
SKILLS_DIR="/root/.openclaw/skills"
STATE_DIR="/root/clawd/state"

mapfile -t RISKY_FILES < <(node <<'NODE'
const fs = require('fs');
const path = require('path');

const packageDir = '/usr/lib/node_modules/openclaw';
const distDir = path.join(packageDir, 'dist');
const markers = [
  {
    name: 'whatsapp_thread_binding_patch',
    markers: [
      'prepareCurrentConversationThreadBinding',
      'bindCurrentConversationThreadBinding',
      'thread=true requires an active channel conversation context.',
      'This ${prepared.preparedBinding.channel} conversation is already bound to another session.'
    ]
  },
  {
    name: 'legacy_assistant_content_patch',
    markers: [
      'annotateInterSessionUserMessages(params.messages).map',
      'message.role !== "assistant"',
      'sanitizeSessionMessagesImages',
      'session:history'
    ]
  }
];

let files = [];
try {
  files = fs.readdirSync(distDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(distDir, name));
} catch {
  files = [];
}

const out = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const patch of markers) {
    if (patch.markers.every((marker) => text.includes(marker))) out.add(file);
  }
}
for (const file of [...out].sort()) console.log(file);
NODE
)

mkdir -p "$SNAPSHOT_DIR"
mkdir -p "$SNAPSHOT_DIR/package-dist" "$SNAPSHOT_DIR/config" "$SNAPSHOT_DIR/custom"

cp -a "$CONFIG_PATH" "$SNAPSHOT_DIR/config/openclaw.json"
if [ -f "$SERVICE_PATH" ]; then
  cp -a "$SERVICE_PATH" "$SNAPSHOT_DIR/config/openclaw-gateway.service"
fi
cp -a "$PLUGINS_DIR" "$SNAPSHOT_DIR/custom/plugins"
if [ -d "$SKILLS_DIR" ]; then
  cp -a "$SKILLS_DIR" "$SNAPSHOT_DIR/custom/skills"
fi

for risky in "${RISKY_FILES[@]:-}"; do
  if [ -f "$risky" ]; then
    cp -a "$risky" "$SNAPSHOT_DIR/package-dist/"
  fi
done
find "$PACKAGE_DIR/dist" -maxdepth 1 -type f -name 'pi-embedded-*.js.bak*' -exec cp -a {} "$SNAPSHOT_DIR/package-dist/" \;
find "$BASE_DIR" -maxdepth 1 -type f -name '*.diff' -exec cp -a {} "$SNAPSHOT_DIR/package-dist/" \;

sha_targets=("$CONFIG_PATH")
[ -f "$SERVICE_PATH" ] && sha_targets+=("$SERVICE_PATH")
for risky in "${RISKY_FILES[@]:-}"; do
  [ -f "$risky" ] && sha_targets+=("$risky")
done
sha256sum "${sha_targets[@]}" > "$SNAPSHOT_DIR/checksums.sha256" 2>/dev/null || true

node > "$SNAPSHOT_DIR/manifest.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function maybeReadJson(p) { try { return readJson(p); } catch { return null; } }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function cmd(s) { try { return cp.execSync(s, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } }
function findDistJsFiles(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'dist'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(dir, 'dist', name));
  } catch {
    return [];
  }
}

const configPath = '/root/.openclaw/openclaw.json';
const cfg = maybeReadJson(configPath) || {};
const pluginEntries = Object.keys((cfg.plugins && cfg.plugins.entries) || {});
const allow = (cfg.plugins && cfg.plugins.allow) || [];
const loadPaths = (cfg.plugins && cfg.plugins.load && cfg.plugins.load.paths) || [];
const packageDir = '/usr/lib/node_modules/openclaw';
const patchMarkers = [
  {
    name: 'whatsapp_thread_binding_patch',
    fileGlobHint: 'dist/*.js',
    markers: [
      'prepareCurrentConversationThreadBinding',
      'bindCurrentConversationThreadBinding',
      'thread=true requires an active channel conversation context.',
      'This ${prepared.preparedBinding.channel} conversation is already bound to another session.'
    ]
  },
  {
    name: 'legacy_assistant_content_patch',
    fileGlobHint: 'dist/*.js',
    markers: [
      'annotateInterSessionUserMessages(params.messages).map',
      'message.role !== "assistant"',
      'sanitizeSessionMessagesImages',
      'session:history'
    ]
  }
];
const directPackageRisk = [];
for (const file of findDistJsFiles(packageDir)) {
  const text = fs.readFileSync(file, 'utf8');
  if (patchMarkers.some((patch) => patch.markers.every((marker) => text.includes(marker)))) {
    directPackageRisk.push(file);
  }
}

const manifest = {
  capturedAt: new Date().toISOString(),
  host: cmd('hostname') || null,
  openclawVersion: cmd('openclaw --version') || null,
  packageVersion: maybeReadJson('/usr/lib/node_modules/openclaw/package.json')?.version || null,
  packageDir,
  configPath,
  servicePath: '/root/.config/systemd/user/openclaw-gateway.service',
  directPackageRisk,
  pluginLoadPaths: loadPaths,
  pluginAllow: allow,
  pluginEntries,
  requiredCustomPlugins: [
    'cortex-memory-bridge',
    'cortex-route-gate',
    'cortex-browser-bridge',
    'outbound-dedupe',
    'completion-integrity',
    'reply-reliability'
  ],
  requiredSkillPaths: [
    '/root/.openclaw/skills/cortex_bridge/skill.json',
    '/root/.openclaw/skills/cortex_bridge/tool.py'
  ],
  patchMarkers,
  filesPresent: {
    config: exists('/root/.openclaw/openclaw.json'),
    service: exists('/root/.config/systemd/user/openclaw-gateway.service'),
    pluginsDir: exists('/root/clawd/plugins'),
    skillsDir: exists('/root/.openclaw/skills')
  }
};

process.stdout.write(JSON.stringify(manifest, null, 2));
NODE

cp -f "$SNAPSHOT_DIR/manifest.json" "$BASE_DIR/latest-manifest.json"

cat <<EOF
Created OpenClaw upgrade snapshot:
  $SNAPSHOT_DIR
Updated manifest pointer:
  $BASE_DIR/latest-manifest.json
EOF
