#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CLOS_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
REPO_ROOT="$(cd -- "$CLOS_ROOT/.." && pwd -P)"
SOURCE_REF="refs/heads/feat/cortex-learning-os-validity-288-20260811"
REMOTE_HOST="jake@37.27.129.239"
REMOTE_MIRROR="/home/jake/clawd-remote"
APPROVED_BINDING="/root/.openclaw/cortex-learning-os/approved-model-executable.json"
STATE_ROOT="/root/.openclaw/cortex-learning-os"
AUTHORITY_ROOT="$STATE_ROOT/production-authorities/clos-phd-production-20260802-v1"
NOTIFIER="/root/clawd/scripts/detached_job_notifier.py"
ARTIFACT_PARENT="/root/clawd/artifacts/cortex-learning-os-continuous-math"
CAMPAIGN_ID="validity-288-$(date -u +%Y%m%dT%H%M%SZ)"
COMMISSION_CONCURRENCY=4
ASSESSMENT_CONCURRENCY=8
NOTIFY=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --campaign-id) CAMPAIGN_ID="${2:-}"; shift 2 ;;
    --source-ref) SOURCE_REF="${2:-}"; shift 2 ;;
    --remote-host) REMOTE_HOST="${2:-}"; shift 2 ;;
    --remote-mirror) REMOTE_MIRROR="${2:-}"; shift 2 ;;
    --approved-model-executable-binding) APPROVED_BINDING="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; AUTHORITY_ROOT="$STATE_ROOT/production-authorities/clos-phd-production-20260802-v1"; shift 2 ;;
    --authority-root) AUTHORITY_ROOT="${2:-}"; shift 2 ;;
    --artifact-parent) ARTIFACT_PARENT="${2:-}"; shift 2 ;;
    --commission-concurrency) COMMISSION_CONCURRENCY="${2:-}"; shift 2 ;;
    --assessment-concurrency) ASSESSMENT_CONCURRENCY="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$CAMPAIGN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] || { echo "invalid campaign identity" >&2; exit 2; }
[[ "$SOURCE_REF" =~ ^refs/heads/[A-Za-z0-9._/-]+$ && "$SOURCE_REF" != *..* ]] || { echo "unsafe source ref" >&2; exit 2; }
[[ "$REMOTE_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe remote host" >&2; exit 2; }
for target in "$REMOTE_MIRROR" "$APPROVED_BINDING" "$STATE_ROOT" "$AUTHORITY_ROOT" "$ARTIFACT_PARENT"; do
  [[ "$target" =~ ^/[A-Za-z0-9._/-]+$ && "$target" != *..* ]] || { echo "unsafe absolute path: $target" >&2; exit 2; }
done
[[ "$COMMISSION_CONCURRENCY" =~ ^[1-8]$ && "$ASSESSMENT_CONCURRENCY" =~ ^[1-8]$ ]] || { echo "concurrency must be 1..8" >&2; exit 2; }
[[ -f "$APPROVED_BINDING" && ! -L "$APPROVED_BINDING" ]] || { echo "approved model executable binding is unavailable" >&2; exit 3; }
[[ -f "$CLOS_ROOT/scripts/run_continuous_math_validity_pipeline.py" && ! -L "$CLOS_ROOT/scripts/run_continuous_math_validity_pipeline.py" && -r "$CLOS_ROOT/scripts/run_continuous_math_validity_pipeline.py" ]] || { echo "validity pipeline supervisor is unavailable" >&2; exit 3; }
if [[ "$NOTIFY" == true ]]; then
  [[ -x "$NOTIFIER" ]] || { echo "control-plane direct notifier is unavailable" >&2; exit 3; }
fi

SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD^{commit})"
SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse HEAD^{tree})"
PRODUCT_TREE="$(git -C "$REPO_ROOT" rev-parse HEAD:cortex-learning-os)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ && "$SOURCE_TREE" =~ ^[0-9a-f]{40}$ && "$PRODUCT_TREE" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid local source identity" >&2; exit 3; }
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "validity source worktree must be clean" >&2; exit 3; }
PUSHED_COMMIT="$(git -C "$REPO_ROOT" ls-remote origin "$SOURCE_REF" | awk 'NR==1 {print $1}')"
[[ "$PUSHED_COMMIT" == "$SOURCE_COMMIT" ]] || { echo "exact source commit is not pushed to the approved ref" >&2; exit 3; }

ARTIFACT_ROOT="$ARTIFACT_PARENT/$CAMPAIGN_ID"
STATE_FILE="$ARTIFACT_ROOT/state.json"
SAFE_UNIT="clos-${CAMPAIGN_ID//[^A-Za-z0-9-]/-}"
PIPELINE_UNIT="$SAFE_UNIT-pipeline"
NOTIFIER_UNIT="$SAFE_UNIT-notify"
[[ ! -e "$ARTIFACT_ROOT" ]] || { echo "campaign artifact root already exists" >&2; exit 3; }

python3 - "$CAMPAIGN_ID" "$ARTIFACT_ROOT" "$STATE_FILE" "$PIPELINE_UNIT" "$NOTIFIER_UNIT" "$SOURCE_REF" "$SOURCE_COMMIT" "$SOURCE_TREE" "$PRODUCT_TREE" "$REMOTE_HOST" "$NOTIFY" "$DRY_RUN" <<'PY'
import json, sys
(campaign, artifacts, state, pipeline, notifier, source_ref, commit, tree, product_tree,
 remote_host, notify, dry_run) = sys.argv[1:]
print(json.dumps({
    "ok": True,
    "dryRun": dry_run == "true",
    "campaignId": campaign,
    "artifactRoot": artifacts,
    "stateFile": state,
    "sourceRef": source_ref,
    "source": {"sourceCommit": commit, "sourceTree": tree, "productTree": product_tree},
    "remoteHost": remote_host,
    "units": {"pipeline": pipeline, "notifier": notifier if notify == "true" else None},
    "placement": {
        "controlPlane": "lightweight pipeline supervisor, independent verifier/grader, and direct notifier",
        "executionPlane": "detached Hetzner author/reviewer commissioning and 288-session candidate farm",
    },
    "truthBoundary": "Launch proves placement and frozen source only. Validity requires returned trusted execution replay and grader-attested per-concept state; retention and utility remain separate.",
}, indent=2))
PY
[[ "$DRY_RUN" == true ]] && exit 0

install -d -m 700 "$ARTIFACT_PARENT"
systemd-run --user \
  --unit="$PIPELINE_UNIT" --collect --quiet \
  --working-directory="$REPO_ROOT" \
  /usr/bin/python3 "$CLOS_ROOT/scripts/run_continuous_math_validity_pipeline.py" \
    --campaign-id "$CAMPAIGN_ID" \
    --artifact-root "$ARTIFACT_ROOT" \
    --state-file "$STATE_FILE" \
    --repo-root "$REPO_ROOT" \
    --source-ref "$SOURCE_REF" \
    --remote-host "$REMOTE_HOST" \
    --remote-mirror "$REMOTE_MIRROR" \
    --state-root "$STATE_ROOT" \
    --authority-root "$AUTHORITY_ROOT" \
    --approved-model-executable-binding "$APPROVED_BINDING" \
    --commission-concurrency "$COMMISSION_CONCURRENCY" \
    --assessment-concurrency "$ASSESSMENT_CONCURRENCY"

if [[ "$NOTIFY" == true ]]; then
  systemd-run --user \
    --unit="$NOTIFIER_UNIT" --collect --quiet \
    --working-directory="/root/clawd" \
    /usr/bin/python3 "$NOTIFIER" \
      --state-file "$STATE_FILE" \
      --job-label "Cortex Learning OS 288-concept near-term validity $CAMPAIGN_ID" \
      --terminal-status completed \
      --terminal-status blocked \
      --terminal-grace-seconds 10 \
      --poll-seconds 30 \
      --exit-after-delivery
fi

PIPELINE_ACTIVE="$(systemctl --user show "$PIPELINE_UNIT.service" --property=ActiveState --value)"
[[ "$PIPELINE_ACTIVE" =~ ^(activating|active)$ ]] || { echo "pipeline unit did not become active: $PIPELINE_ACTIVE" >&2; exit 4; }
if [[ "$NOTIFY" == true ]]; then
  NOTIFIER_ACTIVE="$(systemctl --user show "$NOTIFIER_UNIT.service" --property=ActiveState --value)"
  [[ "$NOTIFIER_ACTIVE" =~ ^(activating|active)$ ]] || { echo "notifier unit did not become active: $NOTIFIER_ACTIVE" >&2; exit 4; }
fi
