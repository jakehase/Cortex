#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CLOS_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
REPO_ROOT="$(cd -- "$CLOS_ROOT/.." && pwd -P)"
PIPELINE_SUPERVISOR="$CLOS_ROOT/scripts/run_continuous_math_validity_pipeline.py"
EXPECTED_SOURCE_COMMIT="93486b4a88cb6d6981b4db6c780eb7dbb3e4f98c"
FROZEN_SOURCE_REPO_ROOT=""
SOURCE_REF="refs/heads/feat/cortex-learning-os-validity-288-20260811"
REMOTE_HOST="jake@37.27.129.239"
REMOTE_MIRROR="/home/jake/clawd-remote"
REMOTE_SOURCE_BASE="/home/jake/cortex-learning-os-validity-sources"
REMOTE_RUNTIME_BASE="/home/jake/.local/state/cortex-learning-os/validity"
APPROVED_BINDING="/root/.openclaw/cortex-learning-os/approved-model-executable.json"
STATE_ROOT="/root/.openclaw/cortex-learning-os"
AUTHORITY_ROOT="$STATE_ROOT/production-authorities/clos-phd-production-20260802-v1"
NOTIFIER="/root/clawd/scripts/detached_job_notifier.py"
ARTIFACT_PARENT="/root/clawd/artifacts/cortex-learning-os-continuous-math"
CAMPAIGN_ID="validity-288-$(date -u +%Y%m%dT%H%M%SZ)"
COMMISSION_CONCURRENCY=4
ASSESSMENT_CONCURRENCY=8
PRIOR_BLOCKED_COMMISSIONING_ROOT=""
PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256=""
ADOPT_COMMISSIONING_CONTINUATION_ROOT=""
ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256=""
ADOPT_COMMISSIONED_CONTENT_SHA256=""
ADOPTION_RUNTIME_ROOT=""
NOTIFY=true
DRY_RUN=false
RESUME=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --campaign-id) CAMPAIGN_ID="${2:-}"; shift 2 ;;
    --source-ref) SOURCE_REF="${2:-}"; shift 2 ;;
    --frozen-source-repo-root) FROZEN_SOURCE_REPO_ROOT="${2:-}"; shift 2 ;;
    --remote-host) REMOTE_HOST="${2:-}"; shift 2 ;;
    --remote-mirror) REMOTE_MIRROR="${2:-}"; shift 2 ;;
    --remote-source-base) REMOTE_SOURCE_BASE="${2:-}"; shift 2 ;;
    --remote-runtime-base) REMOTE_RUNTIME_BASE="${2:-}"; shift 2 ;;
    --approved-model-executable-binding) APPROVED_BINDING="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; AUTHORITY_ROOT="$STATE_ROOT/production-authorities/clos-phd-production-20260802-v1"; shift 2 ;;
    --authority-root) AUTHORITY_ROOT="${2:-}"; shift 2 ;;
    --artifact-parent) ARTIFACT_PARENT="${2:-}"; shift 2 ;;
    --commission-concurrency) COMMISSION_CONCURRENCY="${2:-}"; shift 2 ;;
    --assessment-concurrency) ASSESSMENT_CONCURRENCY="${2:-}"; shift 2 ;;
    --prior-blocked-commissioning-root) PRIOR_BLOCKED_COMMISSIONING_ROOT="${2:-}"; shift 2 ;;
    --prior-blocked-commissioning-state-sha256) PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256="${2:-}"; shift 2 ;;
    --adopt-commissioning-continuation-root) ADOPT_COMMISSIONING_CONTINUATION_ROOT="${2:-}"; shift 2 ;;
    --adopt-commissioning-continuation-state-sha256) ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256="${2:-}"; shift 2 ;;
    --adopt-commissioned-content-sha256) ADOPT_COMMISSIONED_CONTENT_SHA256="${2:-}"; shift 2 ;;
    --adoption-runtime-root) ADOPTION_RUNTIME_ROOT="${2:-}"; shift 2 ;;
    --resume) RESUME=true; shift ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$CAMPAIGN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] || { echo "invalid campaign identity" >&2; exit 2; }
[[ "$SOURCE_REF" =~ ^refs/heads/[A-Za-z0-9._/-]+$ && "$SOURCE_REF" != *..* ]] || { echo "unsafe source ref" >&2; exit 2; }
[[ "$REMOTE_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe remote host" >&2; exit 2; }
[[ -n "$FROZEN_SOURCE_REPO_ROOT" ]] || { echo "--frozen-source-repo-root is required" >&2; exit 2; }
for target in "$FROZEN_SOURCE_REPO_ROOT" "$REMOTE_MIRROR" "$REMOTE_SOURCE_BASE" "$REMOTE_RUNTIME_BASE" "$APPROVED_BINDING" "$STATE_ROOT" "$AUTHORITY_ROOT" "$ARTIFACT_PARENT"; do
  [[ "$target" =~ ^/[A-Za-z0-9._/-]+$ && "$target" != *..* ]] || { echo "unsafe absolute path: $target" >&2; exit 2; }
done
[[ -d "$FROZEN_SOURCE_REPO_ROOT" && ! -L "$FROZEN_SOURCE_REPO_ROOT" ]] || { echo "frozen source repository is unavailable or symlinked" >&2; exit 3; }
CANONICAL_FROZEN_SOURCE_REPO_ROOT="$(cd -- "$FROZEN_SOURCE_REPO_ROOT" && pwd -P)"
[[ "$CANONICAL_FROZEN_SOURCE_REPO_ROOT" == "$FROZEN_SOURCE_REPO_ROOT" ]] || { echo "frozen source repository path must be canonical" >&2; exit 2; }
FROZEN_SOURCE_REPO_ROOT="$CANONICAL_FROZEN_SOURCE_REPO_ROOT"
[[ "$COMMISSION_CONCURRENCY" =~ ^[1-8]$ && "$ASSESSMENT_CONCURRENCY" =~ ^[1-8]$ ]] || { echo "concurrency must be 1..8" >&2; exit 2; }
ADOPTION_ARGUMENTS=0
[[ -n "$PRIOR_BLOCKED_COMMISSIONING_ROOT" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ -n "$PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ -n "$ADOPT_COMMISSIONING_CONTINUATION_ROOT" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ -n "$ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ -n "$ADOPT_COMMISSIONED_CONTENT_SHA256" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ -n "$ADOPTION_RUNTIME_ROOT" ]] && ADOPTION_ARGUMENTS=$((ADOPTION_ARGUMENTS + 1))
[[ "$ADOPTION_ARGUMENTS" -eq 0 || "$ADOPTION_ARGUMENTS" -eq 6 ]] || { echo "continuation adoption requires prior/continuation/runtime roots and exact prior/continuation/content SHA-256 values" >&2; exit 2; }
if [[ "$ADOPTION_ARGUMENTS" -eq 6 ]]; then
  for target in "$PRIOR_BLOCKED_COMMISSIONING_ROOT" "$ADOPT_COMMISSIONING_CONTINUATION_ROOT" "$ADOPTION_RUNTIME_ROOT"; do
    [[ "$target" =~ ^/[A-Za-z0-9._/-]+$ && "$target" != *..* && "$target" != *//* && "$target" != */ ]] || { echo "unsafe continuation adoption path: $target" >&2; exit 2; }
  done
  for digest in "$PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256" "$ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256" "$ADOPT_COMMISSIONED_CONTENT_SHA256"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid continuation adoption SHA-256" >&2; exit 2; }
  done
  HISTORICAL_RUNTIME_ROOT="$REMOTE_RUNTIME_BASE/$CAMPAIGN_ID"
  [[ "$PRIOR_BLOCKED_COMMISSIONING_ROOT" == "$HISTORICAL_RUNTIME_ROOT/commissioning" \
    && "$HISTORICAL_RUNTIME_ROOT" != "$ADOPTION_RUNTIME_ROOT" \
    && "$HISTORICAL_RUNTIME_ROOT" != "$ADOPTION_RUNTIME_ROOT"/* \
    && "$ADOPTION_RUNTIME_ROOT" != "$HISTORICAL_RUNTIME_ROOT"/* \
    && "$ADOPT_COMMISSIONING_CONTINUATION_ROOT" == "$ADOPTION_RUNTIME_ROOT/commissioning" ]] || { echo "continuation adoption runtime must be fresh/disjoint and contain the continuation root" >&2; exit 2; }
fi
[[ -f "$APPROVED_BINDING" && ! -L "$APPROVED_BINDING" ]] || { echo "approved model executable binding is unavailable" >&2; exit 3; }
[[ -f "$PIPELINE_SUPERVISOR" && ! -L "$PIPELINE_SUPERVISOR" && -r "$PIPELINE_SUPERVISOR" ]] || { echo "validity pipeline supervisor is unavailable" >&2; exit 3; }
[[ "$PIPELINE_SUPERVISOR" != "$FROZEN_SOURCE_REPO_ROOT" && "$PIPELINE_SUPERVISOR" != "$FROZEN_SOURCE_REPO_ROOT"/* ]] || { echo "repaired pipeline supervisor must remain external to the frozen source checkout" >&2; exit 3; }
PIPELINE_SUPERVISOR_SHA256="$(sha256sum -- "$PIPELINE_SUPERVISOR" | awk '{print $1}')"
[[ "$PIPELINE_SUPERVISOR_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid external supervisor SHA-256" >&2; exit 3; }
if [[ "$NOTIFY" == true ]]; then
  [[ -x "$NOTIFIER" ]] || { echo "control-plane direct notifier is unavailable" >&2; exit 3; }
fi

SOURCE_COMMIT="$(git -C "$FROZEN_SOURCE_REPO_ROOT" rev-parse HEAD^{commit})"
SOURCE_TREE="$(git -C "$FROZEN_SOURCE_REPO_ROOT" rev-parse HEAD^{tree})"
PRODUCT_TREE="$(git -C "$FROZEN_SOURCE_REPO_ROOT" rev-parse HEAD:cortex-learning-os)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ && "$SOURCE_TREE" =~ ^[0-9a-f]{40}$ && "$PRODUCT_TREE" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid local source identity" >&2; exit 3; }
[[ "$SOURCE_COMMIT" == "$EXPECTED_SOURCE_COMMIT" ]] || { echo "frozen source checkout is not the approved repair baseline commit" >&2; exit 3; }
[[ -z "$(git -C "$FROZEN_SOURCE_REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "validity source worktree must be clean" >&2; exit 3; }
PUSHED_COMMIT="$(git -C "$FROZEN_SOURCE_REPO_ROOT" ls-remote origin "$SOURCE_REF" | awk 'NR==1 {print $1}')"
[[ "$PUSHED_COMMIT" == "$SOURCE_COMMIT" ]] || { echo "exact source commit is not pushed to the approved ref" >&2; exit 3; }

ARTIFACT_ROOT="$ARTIFACT_PARENT/$CAMPAIGN_ID"
STATE_FILE="$ARTIFACT_ROOT/state.json"
SAFE_UNIT="clos-${CAMPAIGN_ID//[^A-Za-z0-9-]/-}"
PIPELINE_UNIT="$SAFE_UNIT-pipeline"
NOTIFIER_UNIT="$SAFE_UNIT-notify"
if [[ "$RESUME" == true ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "resumable campaign state is unavailable" >&2; exit 3; }
else
  [[ ! -e "$ARTIFACT_ROOT" ]] || { echo "campaign artifact root already exists" >&2; exit 3; }
fi

python3 - "$CAMPAIGN_ID" "$ARTIFACT_ROOT" "$STATE_FILE" "$PIPELINE_UNIT" "$NOTIFIER_UNIT" "$SOURCE_REF" "$SOURCE_COMMIT" "$SOURCE_TREE" "$PRODUCT_TREE" "$REMOTE_HOST" "$NOTIFY" "$DRY_RUN" "$RESUME" "$FROZEN_SOURCE_REPO_ROOT" "$PIPELINE_SUPERVISOR" "$PIPELINE_SUPERVISOR_SHA256" "$PRIOR_BLOCKED_COMMISSIONING_ROOT" "$PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256" "$ADOPT_COMMISSIONING_CONTINUATION_ROOT" "$ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256" "$ADOPT_COMMISSIONED_CONTENT_SHA256" "$ADOPTION_RUNTIME_ROOT" <<'PY'
import json, sys
(campaign, artifacts, state, pipeline, notifier, source_ref, commit, tree, product_tree,
 remote_host, notify, dry_run, resume, source_repo_root, supervisor_path, supervisor_sha256,
 prior_root, prior_state_sha256, continuation_root, continuation_state_sha256,
 commissioned_content_sha256, adoption_runtime_root) = sys.argv[1:]
print(json.dumps({
    "ok": True,
    "dryRun": dry_run == "true",
    "resume": resume == "true",
    "campaignId": campaign,
    "artifactRoot": artifacts,
    "stateFile": state,
    "sourceRef": source_ref,
    "source": {"sourceCommit": commit, "sourceTree": tree, "productTree": product_tree},
    "frozenSourceRepoRoot": source_repo_root,
    "externalSupervisor": {"path": supervisor_path, "sha256": supervisor_sha256},
    "remoteHost": remote_host,
    "commissioningAdoption": ({
        "mode": "completed_continuation_only",
        "priorBlockedRoot": prior_root,
        "priorStateSha256": prior_state_sha256,
        "continuationRoot": continuation_root,
        "continuationStateSha256": continuation_state_sha256,
        "commissionedContentSha256": commissioned_content_sha256,
        "runtimeRoot": adoption_runtime_root,
    } if prior_root else None),
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
PIPELINE_ARGUMENTS=(
  --campaign-id "$CAMPAIGN_ID"
  --artifact-root "$ARTIFACT_ROOT"
  --state-file "$STATE_FILE"
  --repo-root "$FROZEN_SOURCE_REPO_ROOT"
  --expected-source-commit "$EXPECTED_SOURCE_COMMIT"
  --external-supervisor-path "$PIPELINE_SUPERVISOR"
  --external-supervisor-sha256 "$PIPELINE_SUPERVISOR_SHA256"
  --source-ref "$SOURCE_REF"
  --remote-host "$REMOTE_HOST"
  --remote-mirror "$REMOTE_MIRROR"
  --remote-source-base "$REMOTE_SOURCE_BASE"
  --remote-runtime-base "$REMOTE_RUNTIME_BASE"
  --state-root "$STATE_ROOT"
  --authority-root "$AUTHORITY_ROOT"
  --approved-model-executable-binding "$APPROVED_BINDING"
  --commission-concurrency "$COMMISSION_CONCURRENCY"
  --assessment-concurrency "$ASSESSMENT_CONCURRENCY"
)
if [[ "$ADOPTION_ARGUMENTS" -eq 6 ]]; then
  PIPELINE_ARGUMENTS+=(
    --prior-blocked-commissioning-root "$PRIOR_BLOCKED_COMMISSIONING_ROOT"
    --prior-blocked-commissioning-state-sha256 "$PRIOR_BLOCKED_COMMISSIONING_STATE_SHA256"
    --adopt-commissioning-continuation-root "$ADOPT_COMMISSIONING_CONTINUATION_ROOT"
    --adopt-commissioning-continuation-state-sha256 "$ADOPT_COMMISSIONING_CONTINUATION_STATE_SHA256"
    --adopt-commissioned-content-sha256 "$ADOPT_COMMISSIONED_CONTENT_SHA256"
    --adoption-runtime-root "$ADOPTION_RUNTIME_ROOT"
  )
fi
if [[ "$RESUME" == true ]]; then
  PIPELINE_ARGUMENTS+=(--resume)
fi
systemd-run --user \
  --unit="$PIPELINE_UNIT" --collect --quiet \
  --working-directory="$FROZEN_SOURCE_REPO_ROOT" \
  /usr/bin/python3 "$PIPELINE_SUPERVISOR" \
    "${PIPELINE_ARGUMENTS[@]}"

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
