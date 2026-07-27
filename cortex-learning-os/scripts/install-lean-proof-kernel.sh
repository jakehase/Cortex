#!/usr/bin/env bash
set -euo pipefail

LEAN_RELEASE="v4.32.1"
LEAN_TOOLCHAIN="leanprover/lean4:v4.32.1"
LEAN_COMMIT="f054605aea4b840552cca2e725580bffd1e1b704"
LEAN_ARCHIVE_NAME="lean-4.32.1-linux.tar.zst"
LEAN_ARCHIVE_SHA256="57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50"
LEAN_ARCHIVE_URL="https://github.com/leanprover/lean4/releases/download/v4.32.1/lean-4.32.1-linux.tar.zst"
MATHLIB_TAG="v4.32.1"
MATHLIB_COMMIT="520045ab14e26149ee970e2e617ca04b09bde5d6"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CLOS_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
KERNEL_ROOT="$CLOS_ROOT/proof-kernel"
INSTALL_ROOT="$KERNEL_ROOT/.toolchain/lean-4.32.1-linux"
ARCHIVE_PATH=""
CACHE_DIR=""
DOWNLOAD_TO=""

usage() {
  cat <<'EOF'
Usage: install-lean-proof-kernel.sh [options]

Installs the exactly pinned Lean 4/mathlib proof kernel. This script is the only
product path that may download proof-kernel dependencies; verification never
installs, updates, or downloads.

Options:
  --archive PATH       Use an existing official Lean tar.zst.
  --cache-dir DIR      Use DIR/lean-4.32.1-linux.tar.zst and place download caches under DIR.
  --download-to PATH   Explicitly download the official Lean archive to PATH if absent.
  --kernel-root DIR    Override the proof-kernel project root.
  --install-root DIR   Override the Lean installation root.
  --help               Show this help.

If Lean is not already installed, exactly one of --archive, --cache-dir, or
--download-to is required. Existing files are never silently replaced.
EOF
}

while (($#)); do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || { echo "--archive requires a path" >&2; exit 2; }
      ARCHIVE_PATH="$2"
      shift 2
      ;;
    --cache-dir)
      [[ $# -ge 2 ]] || { echo "--cache-dir requires a path" >&2; exit 2; }
      CACHE_DIR="$2"
      shift 2
      ;;
    --download-to)
      [[ $# -ge 2 ]] || { echo "--download-to requires a path" >&2; exit 2; }
      DOWNLOAD_TO="$2"
      shift 2
      ;;
    --kernel-root)
      [[ $# -ge 2 ]] || { echo "--kernel-root requires a path" >&2; exit 2; }
      KERNEL_ROOT="$2"
      shift 2
      ;;
    --install-root)
      [[ $# -ge 2 ]] || { echo "--install-root requires a path" >&2; exit 2; }
      INSTALL_ROOT="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unsupported installer argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

selection_count=0
[[ -n "$ARCHIVE_PATH" ]] && selection_count=$((selection_count + 1))
[[ -n "$CACHE_DIR" ]] && selection_count=$((selection_count + 1))
[[ -n "$DOWNLOAD_TO" ]] && selection_count=$((selection_count + 1))
((selection_count <= 1)) || { echo "choose only one of --archive, --cache-dir, or --download-to" >&2; exit 2; }

KERNEL_ROOT="$(realpath -m -- "$KERNEL_ROOT")"
INSTALL_ROOT="$(realpath -m -- "$INSTALL_ROOT")"
[[ -d "$KERNEL_ROOT" && ! -L "$KERNEL_ROOT" ]] || { echo "proof-kernel root must be a non-symlink directory: $KERNEL_ROOT" >&2; exit 2; }
[[ "$INSTALL_ROOT" != "/" && "$INSTALL_ROOT" != "$KERNEL_ROOT" ]] || { echo "unsafe Lean installation root" >&2; exit 2; }

if [[ -n "$CACHE_DIR" ]]; then
  CACHE_DIR="$(realpath -m -- "$CACHE_DIR")"
  mkdir -p -- "$CACHE_DIR"
  [[ -d "$CACHE_DIR" && ! -L "$CACHE_DIR" ]] || { echo "cache directory must be a non-symlink directory" >&2; exit 2; }
  ARCHIVE_PATH="$CACHE_DIR/$LEAN_ARCHIVE_NAME"
  export XDG_CACHE_HOME="$CACHE_DIR/xdg"
fi

if [[ -n "$DOWNLOAD_TO" ]]; then
  DOWNLOAD_TO="$(realpath -m -- "$DOWNLOAD_TO")"
  ARCHIVE_PATH="$DOWNLOAD_TO"
  if [[ ! -e "$DOWNLOAD_TO" ]]; then
    command -v curl >/dev/null || { echo "curl is required for --download-to" >&2; exit 5; }
    mkdir -p -- "$(dirname -- "$DOWNLOAD_TO")"
    download_tmp="${DOWNLOAD_TO}.partial.$$"
    [[ ! -e "$download_tmp" ]] || { echo "refusing to replace existing partial download: $download_tmp" >&2; exit 5; }
    trap 'rm -f -- "${download_tmp:-}"' EXIT
    echo "Downloading explicitly requested pinned Lean archive to $DOWNLOAD_TO"
    curl --fail --location --proto '=https' --tlsv1.2 \
      --output "$download_tmp" "$LEAN_ARCHIVE_URL"
    observed_download_sha="$(sha256sum -- "$download_tmp" | awk '{print $1}')"
    [[ "$observed_download_sha" == "$LEAN_ARCHIVE_SHA256" ]] || {
      echo "downloaded Lean archive SHA-256 mismatch" >&2
      exit 5
    }
    mv -- "$download_tmp" "$DOWNLOAD_TO"
    download_tmp=""
    trap - EXIT
  fi
fi

validate_existing_install() {
  local receipt="$INSTALL_ROOT/cortex-proof-kernel-installation.json"
  local lean_bin="$INSTALL_ROOT/bin/lean"
  local lake_bin="$INSTALL_ROOT/bin/lake"
  [[ -d "$INSTALL_ROOT" && ! -L "$INSTALL_ROOT" ]] || return 1
  [[ -f "$receipt" && ! -L "$receipt" && -f "$lean_bin" && ! -L "$lean_bin" && -x "$lean_bin" ]] || return 1
  [[ -f "$lake_bin" && ! -L "$lake_bin" && -x "$lake_bin" ]] || return 1
  node - "$receipt" "$lean_bin" "$lake_bin" \
    "$LEAN_RELEASE" "$LEAN_TOOLCHAIN" "$LEAN_COMMIT" "$LEAN_ARCHIVE_SHA256" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [receiptPath, leanPath, lakePath, release, toolchain, commit, archiveSha] = process.argv.slice(2);
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const keys = [
  'schemaVersion', 'leanRelease', 'leanToolchain', 'leanCommit',
  'leanArchiveSha256', 'leanExecutableSha256', 'lakeExecutableSha256',
];
if (Object.keys(receipt).length !== keys.length || !keys.every((key) => Object.hasOwn(receipt, key))
    || receipt.schemaVersion !== 'cortex.learning_os.lean_proof_installation.v1'
    || receipt.leanRelease !== release || receipt.leanToolchain !== toolchain
    || receipt.leanCommit !== commit || receipt.leanArchiveSha256 !== archiveSha
    || receipt.leanExecutableSha256 !== hash(leanPath)
    || receipt.lakeExecutableSha256 !== hash(lakePath)) process.exit(1);
NODE
}

if [[ -e "$INSTALL_ROOT" ]]; then
  validate_existing_install || {
    echo "existing Lean installation is incomplete or invalid; refusing to overwrite $INSTALL_ROOT" >&2
    exit 6
  }
  echo "Exact Lean installation already present at $INSTALL_ROOT"
else
  [[ -n "$ARCHIVE_PATH" ]] || {
    echo "Lean is absent; provide --archive, --cache-dir, or --download-to" >&2
    exit 3
  }
  ARCHIVE_PATH="$(realpath -m -- "$ARCHIVE_PATH")"
  [[ -f "$ARCHIVE_PATH" && ! -L "$ARCHIVE_PATH" ]] || {
    echo "Lean archive must be an existing regular non-symlink file: $ARCHIVE_PATH" >&2
    exit 3
  }
  observed_archive_sha="$(sha256sum -- "$ARCHIVE_PATH" | awk '{print $1}')"
  [[ "$observed_archive_sha" == "$LEAN_ARCHIVE_SHA256" ]] || {
    echo "Lean archive SHA-256 mismatch: expected $LEAN_ARCHIVE_SHA256, observed $observed_archive_sha" >&2
    exit 5
  }

  while IFS= read -r archive_entry; do
    [[ -n "$archive_entry" ]] || continue
    case "/$archive_entry/" in
      *"/../"*|*"/./"*|//*)
        echo "Lean archive contains an unsafe path: $archive_entry" >&2
        exit 5
        ;;
    esac
  done < <(tar --zstd -tf "$ARCHIVE_PATH")

  install_parent="$(dirname -- "$INSTALL_ROOT")"
  mkdir -p -- "$install_parent"
  staging_root="$(mktemp -d "$install_parent/.lean-proof-install.XXXXXX")"
  cleanup_staging() {
    [[ -n "${staging_root:-}" && -d "$staging_root" ]] && rm -rf -- "$staging_root"
  }
  trap cleanup_staging EXIT
  tar --zstd -xf "$ARCHIVE_PATH" -C "$staging_root" --no-same-owner --no-same-permissions
  extracted_root="$staging_root/lean-4.32.1-linux"
  [[ -d "$extracted_root" && ! -L "$extracted_root" ]] || {
    echo "Lean archive did not contain the expected top-level directory" >&2
    exit 5
  }
  [[ "$(find "$staging_root" -mindepth 1 -maxdepth 1 -printf '.' | wc -c)" -eq 1 ]] || {
    echo "Lean archive contained unexpected top-level entries" >&2
    exit 5
  }
  lean_bin="$extracted_root/bin/lean"
  lake_bin="$extracted_root/bin/lake"
  [[ -f "$lean_bin" && ! -L "$lean_bin" && -x "$lean_bin" ]] || { echo "Lean executable is invalid" >&2; exit 5; }
  [[ -f "$lake_bin" && ! -L "$lake_bin" && -x "$lake_bin" ]] || { echo "Lake executable is invalid" >&2; exit 5; }
  expected_version="Lean (version 4.32.1, x86_64-unknown-linux-gnu, commit $LEAN_COMMIT, Release)"
  [[ "$("$lean_bin" --version)" == "$expected_version" ]] || { echo "Lean executable version/commit mismatch" >&2; exit 5; }
  lean_sha="$(sha256sum -- "$lean_bin" | awk '{print $1}')"
  lake_sha="$(sha256sum -- "$lake_bin" | awk '{print $1}')"
  receipt="$extracted_root/cortex-proof-kernel-installation.json"
  node - "$receipt" "$lean_sha" "$lake_sha" \
    "$LEAN_RELEASE" "$LEAN_TOOLCHAIN" "$LEAN_COMMIT" "$LEAN_ARCHIVE_SHA256" <<'NODE'
const fs = require('node:fs');
const [receiptPath, leanSha, lakeSha, release, toolchain, commit, archiveSha] = process.argv.slice(2);
const receipt = {
  schemaVersion: 'cortex.learning_os.lean_proof_installation.v1',
  leanRelease: release,
  leanToolchain: toolchain,
  leanCommit: commit,
  leanArchiveSha256: archiveSha,
  leanExecutableSha256: leanSha,
  lakeExecutableSha256: lakeSha,
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
NODE
  mv -- "$extracted_root" "$INSTALL_ROOT"
  rmdir -- "$staging_root"
  staging_root=""
  trap - EXIT
  echo "Installed exact Lean $LEAN_RELEASE at $INSTALL_ROOT"
fi

lean_bin="$INSTALL_ROOT/bin/lean"
lake_bin="$INSTALL_ROOT/bin/lake"
expected_version="Lean (version 4.32.1, x86_64-unknown-linux-gnu, commit $LEAN_COMMIT, Release)"
[[ "$("$lean_bin" --version)" == "$expected_version" ]] || { echo "installed Lean version/commit mismatch" >&2; exit 6; }

echo "Resolving exact mathlib commit $MATHLIB_COMMIT (operator-invoked network access may occur)"
(
  cd -- "$KERNEL_ROOT"
  "$lake_bin" update mathlib
)

mathlib_root="$KERNEL_ROOT/.lake/packages/mathlib"
[[ -d "$mathlib_root" && ! -L "$mathlib_root" ]] || { echo "mathlib checkout is absent after Lake update" >&2; exit 7; }
git -C "$mathlib_root" fetch --force origin \
  "refs/tags/$MATHLIB_TAG:refs/tags/$MATHLIB_TAG"
[[ "$(git -C "$mathlib_root" rev-parse HEAD)" == "$MATHLIB_COMMIT" ]] || { echo "mathlib HEAD mismatch" >&2; exit 7; }
[[ "$(git -C "$mathlib_root" rev-parse "$MATHLIB_TAG^{commit}")" == "$MATHLIB_COMMIT" ]] || { echo "mathlib tag mismatch" >&2; exit 7; }
[[ -z "$(git -C "$mathlib_root" status --porcelain=v1 --untracked-files=no)" ]] || { echo "mathlib tracked worktree is dirty" >&2; exit 7; }

echo "Installing pinned mathlib compiled cache and building the immutable proof project"
(
  cd -- "$KERNEL_ROOT"
  "$lake_bin" exe cache get
  "$lake_bin" build ProofKernel
)

"$SCRIPT_DIR/preflight-lean-proof-kernel.sh" \
  --kernel-root "$KERNEL_ROOT" \
  --lean-root "$INSTALL_ROOT"
echo "Pinned Lean proof kernel installation is ready"
