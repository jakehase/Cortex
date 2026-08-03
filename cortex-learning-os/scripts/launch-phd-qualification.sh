#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"
if [[ "${CLOS_LOCAL_STATE_SUPERVISED:-}" != 1 ]]; then
  exec node "$SCRIPT_DIR/../src/local-state-root-supervisor.mjs" "$SCRIPT_PATH" "$@"
fi
DEFAULT_LOCAL_REPO="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
JOBS_PATH=""
SSH_HOST="root@37.27.129.239"
REMOTE_REPO="/home/jake/clawd-remote"
REMOTE_STATE_ROOT="/var/lib/cortex-learning-os/phd"
LOCAL_REPO="$DEFAULT_LOCAL_REPO"
STATE_ROOT="/root/.openclaw/cortex-learning-os/phd"
QUALIFICATION_SECRET_PATH=""
EXPECTED_SUBJECT_ID=""
EXPECTED_CAMPAIGN_ID=""
EXPECTED_CAMPAIGN_DIGEST=""
EXPECTED_DEPLOYMENT_DIGEST=""
EXPECTED_KEY_ID=""
NOTIFY=true
ARCHIVAL_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --jobs) JOBS_PATH="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --remote-repo) REMOTE_REPO="${2:-}"; shift 2 ;;
    --remote-state-root) REMOTE_STATE_ROOT="${2:-}"; shift 2 ;;
    --local-repo) LOCAL_REPO="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --secret) QUALIFICATION_SECRET_PATH="${2:-}"; shift 2 ;;
    --expected-subject-id) EXPECTED_SUBJECT_ID="${2:-}"; shift 2 ;;
    --expected-campaign-id) EXPECTED_CAMPAIGN_ID="${2:-}"; shift 2 ;;
    --expected-campaign-digest) EXPECTED_CAMPAIGN_DIGEST="${2:-}"; shift 2 ;;
    --expected-deployment-digest) EXPECTED_DEPLOYMENT_DIGEST="${2:-}"; shift 2 ;;
    --expected-key-id) EXPECTED_KEY_ID="${2:-}"; shift 2 ;;
    --archival-only) ARCHIVAL_ONLY=true; shift ;;
    --no-notify) NOTIFY=false; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$EUID" -eq 0 ]] || { echo "PhD qualification launch must run as root" >&2; exit 2; }
[[ "$EXPECTED_SUBJECT_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$
  && "$EXPECTED_CAMPAIGN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$
  && "$EXPECTED_CAMPAIGN_DIGEST" =~ ^[0-9a-f]{64}$
  && "$EXPECTED_DEPLOYMENT_DIGEST" =~ ^[0-9a-f]{64}$
  && "$EXPECTED_KEY_ID" =~ ^[0-9a-f]{16}$ ]] \
  || { echo "independent subject, campaign, deployment, and key identities are required" >&2; exit 2; }
[[ "$JOBS_PATH" =~ ^/[A-Za-z0-9._/-]+$ && -f "$JOBS_PATH" && ! -L "$JOBS_PATH" ]] || { echo "--jobs must be an absolute regular file" >&2; exit 2; }
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe SSH host" >&2; exit 2; }
[[ "$REMOTE_REPO" =~ ^/[A-Za-z0-9._/-]+$ && "$REMOTE_STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ \
  && "$LOCAL_REPO" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe repository or state path" >&2; exit 2; }
[[ "$STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe state root" >&2; exit 2; }
[[ "${CLOS_LOCAL_STATE_ROOT_PATH:-}" == "$STATE_ROOT"
  && "${CLOS_LOCAL_STATE_ROOT_FD:-}" == 9
  && -d "/proc/self/fd/$CLOS_LOCAL_STATE_ROOT_FD" ]] \
  || { echo "local state root is not descriptor-supervised" >&2; exit 3; }
read -r STATE_DEVICE STATE_INODE STATE_UID STATE_GID < <(
  stat -Lc '%d %i %u %g' "/proc/self/fd/$CLOS_LOCAL_STATE_ROOT_FD"
)
[[ "$CLOS_LOCAL_STATE_ROOT_IDENTITY" == "$STATE_DEVICE:$STATE_INODE:$STATE_UID:$STATE_GID"
  && "$STATE_UID" == 0 && "$STATE_GID" == 0 ]] \
  || { echo "local state root descriptor identity changed" >&2; exit 3; }
STATE_ROOT_STABLE="$STATE_ROOT"
STATE_ROOT="/proc/self/fd/$CLOS_LOCAL_STATE_ROOT_FD"
JOBS_PATH_STABLE="$JOBS_PATH"
if [[ "$JOBS_PATH" == "$STATE_ROOT_STABLE/"* ]]; then
  JOBS_PATH="$STATE_ROOT/${JOBS_PATH#"$STATE_ROOT_STABLE/"}"
fi
if [[ -z "$QUALIFICATION_SECRET_PATH" ]]; then
  QUALIFICATION_SECRET_PATH="$STATE_ROOT/qualification.hmac"
  QUALIFICATION_SECRET_STABLE_PATH="$STATE_ROOT_STABLE/qualification.hmac"
else
  QUALIFICATION_SECRET_STABLE_PATH="$QUALIFICATION_SECRET_PATH"
  if [[ "$QUALIFICATION_SECRET_PATH" == "$STATE_ROOT_STABLE/"* ]]; then
    QUALIFICATION_SECRET_PATH="$STATE_ROOT/${QUALIFICATION_SECRET_PATH#"$STATE_ROOT_STABLE/"}"
  fi
fi
[[ "$QUALIFICATION_SECRET_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe qualification secret path" >&2; exit 2; }

VERIFIER="$LOCAL_REPO/cortex-learning-os/src/phd-qualification-launch.mjs"
DURABLE_PUBLISHER="$SCRIPT_DIR/durable-qualification-publication.py"
[[ -f "$DURABLE_PUBLISHER" && ! -L "$DURABLE_PUBLISHER" ]] \
  || { echo "durable qualification publisher is absent or unsafe" >&2; exit 3; }
durable_digest_local() {
  python3 "$DURABLE_PUBLISHER" digest "$1" "$2"
}
durable_publish_local() {
  python3 "$DURABLE_PUBLISHER" publish "$1" "$2" "$3" "$4" >/dev/null
}
durable_digest_remote() {
  ssh -o BatchMode=yes "$SSH_HOST" python3 - digest "$1" "$2" < "$DURABLE_PUBLISHER"
}
durable_publish_remote() {
  ssh -o BatchMode=yes "$SSH_HOST" python3 - publish "$1" "$2" "$3" "$4" \
    < "$DURABLE_PUBLISHER" >/dev/null
}
PLAN_VERIFICATION_COMMAND="verify-plan"
if [[ "$ARCHIVAL_ONLY" == true ]]; then
  PLAN_VERIFICATION_COMMAND="verify-harvest-plan"
fi
VERIFIED_PLAN="$(node "$VERIFIER" "$PLAN_VERIFICATION_COMMAND" \
  --plan "$JOBS_PATH" \
  --secret "$QUALIFICATION_SECRET_PATH" \
  --expected-subject-id "$EXPECTED_SUBJECT_ID" \
  --expected-campaign-id "$EXPECTED_CAMPAIGN_ID" \
  --expected-campaign-digest "$EXPECTED_CAMPAIGN_DIGEST" \
  --expected-deployment-digest "$EXPECTED_DEPLOYMENT_DIGEST" \
  --expected-key-id "$EXPECTED_KEY_ID")"
SUBJECT_ID="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.subjectId)' "$VERIFIED_PLAN")"
CAMPAIGN_ID="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.campaignId)' "$VERIFIED_PLAN")"
CAMPAIGN_DIGEST="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.campaignDigest)' "$VERIFIED_PLAN")"
SOURCE_COMMIT="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.sourceCommit)' "$VERIFIED_PLAN")"
SOURCE_TREE="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.sourceTree)' "$VERIFIED_PLAN")"
PRODUCT_TREE="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.productTree)' "$VERIFIED_PLAN")"
PLAN_DIGEST="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.planDigest)' "$VERIFIED_PLAN")"
DEPLOYMENT_DIGEST="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.deploymentDigest)' "$VERIFIED_PLAN")"
DESCRIPTOR_SET_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.descriptorSetSha256)' "$VERIFIED_PLAN")"
JOB_COUNT="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(v.jobCount))' "$VERIFIED_PLAN")"
JOB_SET_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.jobSetSha256)' "$VERIFIED_PLAN")"
RUNTIME_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.runtimeSha256)' "$VERIFIED_PLAN")"
CLOSURE_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.closureSha256)' "$VERIFIED_PLAN")"
APPROVED_CODEX_PATH="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedModelExecutable?.path || "")' "$VERIFIED_PLAN")"
APPROVED_CODEX_BYTES="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(v.approvedModelExecutable?.bytes || ""))' "$VERIFIED_PLAN")"
APPROVED_CODEX_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedModelExecutable?.sha256 || "")' "$VERIFIED_PLAN")"
APPROVED_CODEX_CLOSURE_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedModelExecutable?.runtimeClosureSha256 || "")' "$VERIFIED_PLAN")"
APPROVED_RESEARCH_PATH="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedResearchRuntime?.path || "")' "$VERIFIED_PLAN")"
APPROVED_RESEARCH_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedResearchRuntime?.sha256 || "")' "$VERIFIED_PLAN")"
APPROVED_RESEARCH_CLOSURE_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedResearchRuntime?.runtimeClosureSha256 || "")' "$VERIFIED_PLAN")"
APPROVED_RESEARCH_DAEMON_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.approvedResearchRuntime?.daemonClosureSha256 || "")' "$VERIFIED_PLAN")"
[[ "$CAMPAIGN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] || { echo "invalid campaign ID" >&2; exit 2; }
[[ "$SUBJECT_ID" == "$EXPECTED_SUBJECT_ID"
  && "$CAMPAIGN_ID" == "$EXPECTED_CAMPAIGN_ID"
  && "$CAMPAIGN_DIGEST" == "$EXPECTED_CAMPAIGN_DIGEST"
  && "$DEPLOYMENT_DIGEST" == "$EXPECTED_DEPLOYMENT_DIGEST" ]] \
  || { echo "authenticated plan differs from independent launch identity" >&2; exit 3; }
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ && "$SOURCE_TREE" =~ ^[0-9a-f]{40}$ && "$PRODUCT_TREE" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid job deployment" >&2; exit 2; }
for DIGEST_VALUE in "$PLAN_DIGEST" "$CAMPAIGN_DIGEST" "$DEPLOYMENT_DIGEST" \
  "$DESCRIPTOR_SET_SHA256" "$JOB_SET_SHA256" "$RUNTIME_SHA256" "$CLOSURE_SHA256" \
  "$APPROVED_CODEX_SHA256" "$APPROVED_CODEX_CLOSURE_SHA256"; do
  [[ "$DIGEST_VALUE" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid authenticated plan or closure digest" >&2; exit 2; }
done
if [[ -n "$APPROVED_RESEARCH_PATH" || -n "$APPROVED_RESEARCH_SHA256" \
  || -n "$APPROVED_RESEARCH_CLOSURE_SHA256" || -n "$APPROVED_RESEARCH_DAEMON_SHA256" ]]; then
  for DIGEST_VALUE in "$APPROVED_RESEARCH_SHA256" \
    "$APPROVED_RESEARCH_CLOSURE_SHA256" "$APPROVED_RESEARCH_DAEMON_SHA256"; do
    [[ "$DIGEST_VALUE" =~ ^[0-9a-f]{64}$ ]] \
      || { echo "invalid authenticated research runtime digest" >&2; exit 2; }
  done
fi
[[ "$APPROVED_CODEX_PATH" == "/opt/cortex-learning-os/approved-model-executors/$APPROVED_CODEX_SHA256/codex" \
  && "$APPROVED_CODEX_BYTES" =~ ^[1-9][0-9]{0,9}$ ]] \
  || { echo "authenticated plan omits an approved immutable model executable" >&2; exit 2; }
if [[ -n "$APPROVED_RESEARCH_PATH" ]]; then
  [[ "$APPROVED_RESEARCH_PATH" == "/opt/cortex-learning-os/approved-research-runtimes/$APPROVED_RESEARCH_SHA256/runtime" ]] \
    || { echo "authenticated plan binds an invalid immutable research runtime" >&2; exit 2; }
fi
[[ "$JOB_COUNT" =~ ^[1-9][0-9]?$ && "$JOB_COUNT" -le 64 ]] || { echo "invalid authenticated job count" >&2; exit 2; }
if [[ "$ARCHIVAL_ONLY" == false ]]; then
  [[ "$(git -C "$LOCAL_REPO" rev-parse HEAD)" == "$SOURCE_COMMIT" ]] || { echo "local commit drift" >&2; exit 3; }
  [[ "$(git -C "$LOCAL_REPO" rev-parse "HEAD^{tree}")" == "$SOURCE_TREE" ]] || { echo "local tree drift" >&2; exit 3; }
  [[ "$(git -C "$LOCAL_REPO" rev-parse "HEAD:cortex-learning-os")" == "$PRODUCT_TREE" ]] || { echo "local product tree drift" >&2; exit 3; }
  [[ -z "$(git -C "$LOCAL_REPO" status --porcelain=v1 --untracked-files=all -- cortex-learning-os plugins/cortex-learning-os-live)" ]] || { echo "local execution closure is dirty" >&2; exit 3; }
  REMOTE_HEAD="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" rev-parse HEAD)"
  REMOTE_TREE="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" rev-parse "HEAD^{tree}")"
  REMOTE_PRODUCT_TREE="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" rev-parse "HEAD:cortex-learning-os")"
  REMOTE_DIRTY="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" status --porcelain=v1 --untracked-files=all -- cortex-learning-os plugins/cortex-learning-os-live)"
  [[ "$REMOTE_HEAD" == "$SOURCE_COMMIT" && "$REMOTE_TREE" == "$SOURCE_TREE" && "$REMOTE_PRODUCT_TREE" == "$PRODUCT_TREE" && -z "$REMOTE_DIRTY" ]] || { echo "Hetzner source or execution closure drift" >&2; exit 3; }
fi

CAMPAIGN_ROOT="$STATE_ROOT/campaigns/$CAMPAIGN_ID"
CAMPAIGN_ROOT_STABLE="$STATE_ROOT_STABLE/campaigns/$CAMPAIGN_ID"
LOCAL_ARTIFACT_ROOT="$CAMPAIGN_ROOT/artifacts"
LOCAL_ARTIFACT_ROOT_STABLE="$CAMPAIGN_ROOT_STABLE/artifacts"
LOCAL_JOB_ROOT="$CAMPAIGN_ROOT/jobs"
LOCAL_STAGING_ROOT="$CAMPAIGN_ROOT/staging"
LOCAL_HARVEST_STAGING_ROOT="$CAMPAIGN_ROOT/harvest-staging"
LOCAL_HARVEST_STAGING_ROOT_STABLE="$CAMPAIGN_ROOT_STABLE/harvest-staging"
LOCAL_HARVEST_QUARANTINE_ROOT="$CAMPAIGN_ROOT/harvest-quarantine"
LOCAL_HARVEST_QUARANTINE_ROOT_STABLE="$CAMPAIGN_ROOT_STABLE/harvest-quarantine"
LOCAL_CHECKOUT_QUARANTINE_ROOT="$LOCAL_HARVEST_QUARANTINE_ROOT/checkout-remnants"
LOCAL_FROZEN_ROOT="$CAMPAIGN_ROOT/checkout"
LOCAL_FROZEN_ROOT_STABLE="$CAMPAIGN_ROOT_STABLE/checkout"
AUTHENTICATED_PLAN="$CAMPAIGN_ROOT/plan.v2.json"
AUTHENTICATED_PLAN_STABLE="$CAMPAIGN_ROOT_STABLE/plan.v2.json"
REMOTE_CAMPAIGN_ROOT="$REMOTE_STATE_ROOT/campaigns/$CAMPAIGN_ID"
REMOTE_JOB_ROOT="$REMOTE_CAMPAIGN_ROOT/jobs"
REMOTE_ARTIFACT_ROOT="$REMOTE_CAMPAIGN_ROOT/artifacts"
REMOTE_STAGING_ROOT="$REMOTE_CAMPAIGN_ROOT/staging"
REMOTE_ARTIFACT_STAGING_ROOT="$REMOTE_CAMPAIGN_ROOT/artifact-staging"
REMOTE_QUARANTINE_ROOT="$REMOTE_CAMPAIGN_ROOT/quarantine"
REMOTE_FROZEN_ROOT="$REMOTE_CAMPAIGN_ROOT/checkout"
REMOTE_AUTHENTICATED_PLAN="$REMOTE_CAMPAIGN_ROOT/plan.v2.json"
STATE_FILE="$CAMPAIGN_ROOT/state.json"
STATE_FILE_STABLE="$CAMPAIGN_ROOT_STABLE/state.json"
CAMPAIGN_HARVEST_LOCK_STABLE="$CAMPAIGN_ROOT_STABLE/.harvest.lock"
if [[ "$ARCHIVAL_ONLY" == false ]]; then
  install -d -m 700 -o root -g root \
    "$CAMPAIGN_ROOT" "$LOCAL_ARTIFACT_ROOT" "$LOCAL_JOB_ROOT" "$LOCAL_STAGING_ROOT" \
    "$LOCAL_HARVEST_STAGING_ROOT" "$LOCAL_HARVEST_QUARANTINE_ROOT" \
    "$LOCAL_CHECKOUT_QUARANTINE_ROOT"
else
  [[ "$JOBS_PATH_STABLE" == "$AUTHENTICATED_PLAN_STABLE" ]] \
    || { echo "archival-only resume requires the exact saved campaign plan path" >&2; exit 3; }
fi
for LOCAL_PROTECTED_DIRECTORY in \
  "$CAMPAIGN_ROOT" "$LOCAL_ARTIFACT_ROOT" "$LOCAL_JOB_ROOT" "$LOCAL_STAGING_ROOT" \
  "$LOCAL_HARVEST_STAGING_ROOT" "$LOCAL_HARVEST_QUARANTINE_ROOT" \
  "$LOCAL_CHECKOUT_QUARANTINE_ROOT"; do
  [[ -d "$LOCAL_PROTECTED_DIRECTORY" && ! -L "$LOCAL_PROTECTED_DIRECTORY" \
    && "$(stat -c '%U:%G:%a' "$LOCAL_PROTECTED_DIRECTORY")" == "root:root:700" ]] \
    || { echo "local campaign directory is not root-owned and owner-only" >&2; exit 3; }
done
if [[ "$ARCHIVAL_ONLY" == false ]]; then
  SNAPSHOT="$(node "$VERIFIER" snapshot-plan \
    --plan "$JOBS_PATH" \
    --secret "$QUALIFICATION_SECRET_PATH" \
    --expected-subject-id "$SUBJECT_ID" \
    --expected-campaign-id "$CAMPAIGN_ID" \
    --expected-campaign-digest "$CAMPAIGN_DIGEST" \
    --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
    --expected-key-id "$EXPECTED_KEY_ID" \
    --expected-plan-digest "$PLAN_DIGEST" \
    --out "$AUTHENTICATED_PLAN")"
  [[ "$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.planDigest)' "$SNAPSHOT")" == "$PLAN_DIGEST" ]] || { echo "authenticated plan snapshot mismatch" >&2; exit 3; }
  JOBS_PATH="$AUTHENTICATED_PLAN"
fi
AUTHENTICATED_PLAN_SHA256="$(sha256sum "$JOBS_PATH" | awk '{print $1}')"

LOCAL_FROZEN_STAGE="$CAMPAIGN_ROOT/.checkout.publish"
quarantine_local_frozen_stage() {
  [[ "$ARCHIVAL_ONLY" == false ]] \
    || { echo "archival-only resume found an incomplete local checkout stage" >&2; exit 3; }
  [[ -d "$LOCAL_CHECKOUT_QUARANTINE_ROOT" \
    && ! -L "$LOCAL_CHECKOUT_QUARANTINE_ROOT" \
    && "$(stat -c '%u:%g:%a' "$LOCAL_CHECKOUT_QUARANTINE_ROOT")" == "0:0:700" \
    && -d "$LOCAL_FROZEN_STAGE" && ! -L "$LOCAL_FROZEN_STAGE" \
    && "$(stat -c '%u:%g' "$LOCAL_FROZEN_STAGE")" == "0:0" \
    && "$(stat -c '%d' "$LOCAL_FROZEN_STAGE")" \
      == "$(stat -c '%d' "$LOCAL_CHECKOUT_QUARANTINE_ROOT")" ]] \
    || { echo "incomplete local checkout stage is unsafe to quarantine" >&2; exit 3; }
  local REMNANT
  REMNANT="$LOCAL_CHECKOUT_QUARANTINE_ROOT/$(
    date -u +%Y%m%dT%H%M%S%NZ
  ).$SOURCE_COMMIT.$$.partial"
  mv -T -- "$LOCAL_FROZEN_STAGE" "$REMNANT"
  python3 - "$CAMPAIGN_ROOT" "$LOCAL_CHECKOUT_QUARANTINE_ROOT" <<'PY'
import os
import sys

for directory in sys.argv[1:]:
    descriptor = os.open(
        directory,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
}

build_local_frozen_stage() {
  install -d -m 700 -o root -g root "$LOCAL_FROZEN_STAGE"
  git -C "$LOCAL_REPO" archive --format=tar "$SOURCE_COMMIT" \
    | tar -xf - -C "$LOCAL_FROZEN_STAGE"
  chown -R root:root "$LOCAL_FROZEN_STAGE"
  chmod -R a-w "$LOCAL_FROZEN_STAGE"
  chmod 555 "$LOCAL_FROZEN_STAGE"
}

if [[ -e "$LOCAL_FROZEN_STAGE" ]] \
    && [[ ! -d "$LOCAL_FROZEN_STAGE" || -L "$LOCAL_FROZEN_STAGE" \
      || "$(stat -c '%U:%G:%a' "$LOCAL_FROZEN_STAGE")" != "root:root:555" ]]; then
  quarantine_local_frozen_stage
fi
if [[ ! -e "$LOCAL_FROZEN_ROOT" && ! -e "$LOCAL_FROZEN_STAGE" ]]; then
  [[ "$ARCHIVAL_ONLY" == false ]] \
    || { echo "local frozen checkout is absent; archival-only resume has no staged publication to adopt" >&2; exit 3; }
  build_local_frozen_stage
fi
LOCAL_FROZEN_CANDIDATE="$LOCAL_FROZEN_ROOT"
[[ -e "$LOCAL_FROZEN_CANDIDATE" ]] || LOCAL_FROZEN_CANDIDATE="$LOCAL_FROZEN_STAGE"
[[ -d "$LOCAL_FROZEN_CANDIDATE" && ! -L "$LOCAL_FROZEN_CANDIDATE" \
  && "$(stat -c '%U:%G:%a' "$LOCAL_FROZEN_CANDIDATE")" == "root:root:555" ]] \
  || { echo "local frozen checkout publication is unsafe" >&2; exit 3; }
CHECKOUT_VERIFICATION_COMMAND="verify-checkout"
if [[ "$ARCHIVAL_ONLY" == true ]]; then
  CHECKOUT_VERIFICATION_COMMAND="verify-harvest-checkout"
fi
verify_local_frozen_candidate() {
  node "$LOCAL_FROZEN_CANDIDATE/cortex-learning-os/src/phd-qualification-launch.mjs" \
    "$CHECKOUT_VERIFICATION_COMMAND" \
    --plan "$JOBS_PATH" --secret "$QUALIFICATION_SECRET_PATH" \
    --expected-subject-id "$SUBJECT_ID" --expected-campaign-id "$CAMPAIGN_ID" \
    --expected-campaign-digest "$CAMPAIGN_DIGEST" \
    --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
    --expected-key-id "$EXPECTED_KEY_ID" --expected-plan-digest "$PLAN_DIGEST" \
    --checkout-root "$LOCAL_FROZEN_CANDIDATE" >/dev/null
}
if ! verify_local_frozen_candidate; then
  [[ "$LOCAL_FROZEN_CANDIDATE" == "$LOCAL_FROZEN_STAGE" ]] \
    || { echo "published local frozen checkout failed exact verification" >&2; exit 3; }
  quarantine_local_frozen_stage
  build_local_frozen_stage
  LOCAL_FROZEN_CANDIDATE="$LOCAL_FROZEN_STAGE"
  verify_local_frozen_candidate \
    || { echo "rebuilt local frozen checkout failed exact verification" >&2; exit 3; }
fi
LOCAL_FROZEN_PUBLICATION_SHA256="$(
  durable_digest_local immutable-tree "$LOCAL_FROZEN_CANDIDATE"
)"
if [[ -e "$LOCAL_FROZEN_ROOT" && -e "$LOCAL_FROZEN_STAGE" ]]; then
  LOCAL_FROZEN_STAGE_SHA256=""
  if ! LOCAL_FROZEN_STAGE_SHA256="$(
      durable_digest_local immutable-tree "$LOCAL_FROZEN_STAGE"
    )" || [[ "$LOCAL_FROZEN_STAGE_SHA256" \
      != "$LOCAL_FROZEN_PUBLICATION_SHA256" ]]; then
    quarantine_local_frozen_stage
  fi
fi
durable_publish_local immutable-tree "$LOCAL_FROZEN_STAGE" "$LOCAL_FROZEN_ROOT" \
  "$LOCAL_FROZEN_PUBLICATION_SHA256"
node "$LOCAL_FROZEN_ROOT/cortex-learning-os/src/phd-qualification-launch.mjs" "$CHECKOUT_VERIFICATION_COMMAND" \
  --plan "$JOBS_PATH" --secret "$QUALIFICATION_SECRET_PATH" \
  --expected-subject-id "$SUBJECT_ID" --expected-campaign-id "$CAMPAIGN_ID" \
  --expected-campaign-digest "$CAMPAIGN_DIGEST" --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
  --expected-key-id "$EXPECTED_KEY_ID" --expected-plan-digest "$PLAN_DIGEST" \
  --checkout-root "$LOCAL_FROZEN_ROOT" >/dev/null

if [[ "$ARCHIVAL_ONLY" == false ]]; then
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 755 -o root -g root \
    "$REMOTE_STATE_ROOT" "$REMOTE_STATE_ROOT/campaigns" "$REMOTE_CAMPAIGN_ROOT"
fi
ssh -o BatchMode=yes "$SSH_HOST" /bin/bash -s -- "$REMOTE_CAMPAIGN_ROOT" <<'REMOTE_ANCESTOR_CHECK'
set -Eeuo pipefail
ANCESTOR="$1"
while :; do
  [[ -d "$ANCESTOR" && ! -L "$ANCESTOR" ]] || exit 1
  read -r OWNER GROUP MODE < <(stat -c '%u %g %a' "$ANCESTOR")
  [[ "$OWNER" == 0 && "$GROUP" == 0 && $((8#$MODE & 8#022)) -eq 0 ]] || exit 1
  [[ "$ANCESTOR" == / ]] && break
  ANCESTOR="$(dirname -- "$ANCESTOR")"
done
REMOTE_ANCESTOR_CHECK
if [[ "$ARCHIVAL_ONLY" == false ]]; then
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 750 -o root -g jake "$REMOTE_JOB_ROOT"
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 755 -o root -g root "$REMOTE_ARTIFACT_ROOT"
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 750 -o root -g jake "$REMOTE_STAGING_ROOT"
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 710 -o root -g jake "$REMOTE_ARTIFACT_STAGING_ROOT"
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 700 -o root -g root "$REMOTE_QUARANTINE_ROOT" \
      "$REMOTE_QUARANTINE_ROOT/artifacts" "$REMOTE_QUARANTINE_ROOT/checkouts"
fi
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_CAMPAIGN_ROOT")" == "root:root:755" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_CAMPAIGN_ROOT" \
  || { echo "remote campaign root ownership, mode, or type mismatch" >&2; exit 3; }
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_JOB_ROOT")" == "root:jake:750" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_JOB_ROOT" \
  || { echo "remote job root ownership, mode, or type mismatch" >&2; exit 3; }
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_ARTIFACT_ROOT")" == "root:root:755" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_ARTIFACT_ROOT" \
  || { echo "remote artifact root ownership, mode, or type mismatch" >&2; exit 3; }
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_STAGING_ROOT")" == "root:jake:750" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_STAGING_ROOT" \
  || { echo "remote staging root ownership, mode, or type mismatch" >&2; exit 3; }
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_ARTIFACT_STAGING_ROOT")" == "root:jake:710" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_ARTIFACT_STAGING_ROOT" \
  || { echo "remote artifact staging root ownership, mode, or type mismatch" >&2; exit 3; }
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_QUARANTINE_ROOT")" == "root:root:700" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_QUARANTINE_ROOT" \
  && [[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_QUARANTINE_ROOT/artifacts")" == "root:root:700" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_QUARANTINE_ROOT/artifacts" \
  && [[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_QUARANTINE_ROOT/checkouts")" == "root:root:700" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_QUARANTINE_ROOT/checkouts" \
  || { echo "remote quarantine root ownership, mode, or type mismatch" >&2; exit 3; }
REMOTE_FROZEN_STAGE="$REMOTE_CAMPAIGN_ROOT/.checkout.publish"
quarantine_remote_frozen_stage() {
  [[ "$ARCHIVAL_ONLY" == false ]] \
    || { echo "archival-only resume found an incomplete remote checkout stage" >&2; exit 3; }
  ssh -o BatchMode=yes "$SSH_HOST" /bin/bash -s -- \
    "$REMOTE_FROZEN_STAGE" "$REMOTE_QUARANTINE_ROOT/checkouts" \
    "$SOURCE_COMMIT" <<'REMOTE_CHECKOUT_QUARANTINE'
set -Eeuo pipefail
STAGE="$1"
QUARANTINE="$2"
SOURCE_COMMIT="$3"
[[ -d "$STAGE" && ! -L "$STAGE" \
  && "$(stat -c '%u:%g' "$STAGE")" == "0:0" \
  && -d "$QUARANTINE" && ! -L "$QUARANTINE" \
  && "$(stat -c '%u:%g:%a' "$QUARANTINE")" == "0:0:700" \
  && "$(stat -c '%d' "$STAGE")" == "$(stat -c '%d' "$QUARANTINE")" ]] \
  || { echo "incomplete remote checkout stage is unsafe to quarantine" >&2; exit 3; }
REMNANT="$QUARANTINE/$(date -u +%Y%m%dT%H%M%S%NZ).$SOURCE_COMMIT.$$.partial"
mv -T -- "$STAGE" "$REMNANT"
python3 - "$(dirname -- "$STAGE")" "$QUARANTINE" <<'PY'
import os
import sys

for directory in sys.argv[1:]:
    descriptor = os.open(
        directory,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
REMOTE_CHECKOUT_QUARANTINE
}

build_remote_frozen_stage() {
  ssh -o BatchMode=yes "$SSH_HOST" \
    install -d -m 700 -o root -g root "$REMOTE_FROZEN_STAGE"
  rsync -a --delete "$LOCAL_FROZEN_ROOT/" "$SSH_HOST:$REMOTE_FROZEN_STAGE/"
  ssh -o BatchMode=yes "$SSH_HOST" chown -R root:root "$REMOTE_FROZEN_STAGE"
  ssh -o BatchMode=yes "$SSH_HOST" chmod -R a-w "$REMOTE_FROZEN_STAGE"
  ssh -o BatchMode=yes "$SSH_HOST" chmod 555 "$REMOTE_FROZEN_STAGE"
}

remote_frozen_stage_is_sealed() {
  ssh -o BatchMode=yes "$SSH_HOST" /bin/bash -s -- \
    "$REMOTE_FROZEN_STAGE" <<'REMOTE_CHECKOUT_STAGE_VALID'
set -Eeuo pipefail
STAGE="$1"
[[ -d "$STAGE" && ! -L "$STAGE" \
  && "$(stat -c '%u:%g:%a' "$STAGE")" == "0:0:555" ]]
REMOTE_CHECKOUT_STAGE_VALID
}

if ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_STAGE" \
    && ! remote_frozen_stage_is_sealed; then
  quarantine_remote_frozen_stage
fi
if ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_ROOT" \
    && ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_STAGE"; then
  [[ "$ARCHIVAL_ONLY" == false ]] \
    || { echo "remote frozen checkout is absent; archival-only resume has no staged publication to adopt" >&2; exit 3; }
  build_remote_frozen_stage
fi
if ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_ROOT" \
    && ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_STAGE"; then
  REMOTE_FROZEN_STAGE_SHA256=""
  if ! REMOTE_FROZEN_STAGE_SHA256="$(
      durable_digest_remote immutable-tree "$REMOTE_FROZEN_STAGE"
    )" || [[ "$REMOTE_FROZEN_STAGE_SHA256" \
      != "$LOCAL_FROZEN_PUBLICATION_SHA256" ]]; then
    quarantine_remote_frozen_stage
  fi
fi
REMOTE_FROZEN_CANDIDATE="$REMOTE_FROZEN_ROOT"
ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_FROZEN_CANDIDATE" \
  || REMOTE_FROZEN_CANDIDATE="$REMOTE_FROZEN_STAGE"
REMOTE_FROZEN_CANDIDATE_DIGEST=""
if REMOTE_FROZEN_CANDIDATE_DIGEST="$(
    durable_digest_remote immutable-tree "$REMOTE_FROZEN_CANDIDATE"
  )" && [[ "$REMOTE_FROZEN_CANDIDATE_DIGEST" \
    == "$LOCAL_FROZEN_PUBLICATION_SHA256" ]]; then
  :
elif [[ "$REMOTE_FROZEN_CANDIDATE" == "$REMOTE_FROZEN_STAGE" \
    && "$ARCHIVAL_ONLY" == false ]]; then
  quarantine_remote_frozen_stage
  build_remote_frozen_stage
  REMOTE_FROZEN_CANDIDATE="$REMOTE_FROZEN_STAGE"
  [[ "$(durable_digest_remote immutable-tree "$REMOTE_FROZEN_CANDIDATE")" \
    == "$LOCAL_FROZEN_PUBLICATION_SHA256" ]] \
    || { echo "rebuilt remote frozen checkout differs from authenticated local checkout" >&2; exit 3; }
else
  echo "remote frozen checkout publication differs from authenticated local checkout" >&2
  exit 3
fi
durable_publish_remote immutable-tree "$REMOTE_FROZEN_STAGE" "$REMOTE_FROZEN_ROOT" \
  "$LOCAL_FROZEN_PUBLICATION_SHA256"
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_FROZEN_ROOT")" == "root:root:555" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test -d "$REMOTE_FROZEN_ROOT" \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_FROZEN_ROOT" \
  || { echo "remote frozen checkout is unsafe or mutable by the worker" >&2; exit 3; }
REMOTE_PLAN_STAGE="$REMOTE_STAGING_ROOT/plan.v2.json"
if ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_AUTHENTICATED_PLAN" \
    && ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_PLAN_STAGE" \
    && [[ "$ARCHIVAL_ONLY" == false ]]; then
  scp -q "$JOBS_PATH" "$SSH_HOST:$REMOTE_PLAN_STAGE"
  ssh "$SSH_HOST" chown root:root "$REMOTE_PLAN_STAGE"
  ssh "$SSH_HOST" chmod 400 "$REMOTE_PLAN_STAGE"
elif ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_AUTHENTICATED_PLAN" \
    && ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_PLAN_STAGE"; then
  echo "remote authenticated plan is absent; archival-only resume cannot recreate it" >&2
  exit 3
fi
durable_publish_remote file "$REMOTE_PLAN_STAGE" "$REMOTE_AUTHENTICATED_PLAN" \
  "$AUTHENTICATED_PLAN_SHA256"
[[ "$(ssh -o BatchMode=yes "$SSH_HOST" sha256sum "$REMOTE_AUTHENTICATED_PLAN" | awk '{print $1}')" \
  == "$AUTHENTICATED_PLAN_SHA256" \
  && "$(ssh -o BatchMode=yes "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_AUTHENTICATED_PLAN")" \
    == "root:root:400" ]] \
  && ssh -o BatchMode=yes "$SSH_HOST" test -f "$REMOTE_AUTHENTICATED_PLAN" \
  && ssh -o BatchMode=yes "$SSH_HOST" test ! -L "$REMOTE_AUTHENTICATED_PLAN" \
  || { echo "remote authenticated plan snapshot differs on resume" >&2; exit 3; }
ssh -o BatchMode=yes "$SSH_HOST" \
  node "$REMOTE_FROZEN_ROOT/cortex-learning-os/src/phd-qualification-launch.mjs" verify-closure \
  --plan "$REMOTE_AUTHENTICATED_PLAN" \
  --expected-plan-digest "$PLAN_DIGEST" \
  --checkout-root "$REMOTE_FROZEN_ROOT" >/dev/null
if [[ "$ARCHIVAL_ONLY" == false ]]; then
  ssh -o BatchMode=yes "$SSH_HOST" \
    node "$REMOTE_FROZEN_ROOT/cortex-learning-os/src/phd-qualification-launch.mjs" verify-executable \
    --plan "$REMOTE_AUTHENTICATED_PLAN" \
    --expected-plan-digest "$PLAN_DIGEST" >/dev/null
fi

while IFS= read -r JOB_ID; do
  LOCAL_JOB_STAGE="$LOCAL_STAGING_ROOT/$JOB_ID.json"
  LOCAL_JOB="$LOCAL_JOB_ROOT/$JOB_ID.json"
  REMOTE_JOB="$REMOTE_JOB_ROOT/$JOB_ID.json"
  REMOTE_JOB_TEMP="$REMOTE_STAGING_ROOT/$JOB_ID.json"
  if [[ "$ARCHIVAL_ONLY" == true ]]; then
    LOCAL_JOB_CANDIDATE="$LOCAL_JOB"
    [[ -e "$LOCAL_JOB_CANDIDATE" ]] || LOCAL_JOB_CANDIDATE="$LOCAL_JOB_STAGE"
    [[ -f "$LOCAL_JOB_CANDIDATE" && ! -L "$LOCAL_JOB_CANDIDATE" \
      && "$(stat -c '%U:%G:%a' "$LOCAL_JOB_CANDIDATE")" == "root:root:600" ]] \
      || { echo "local archived job is absent or unsafe" >&2; exit 3; }
    VERIFIED_JOB="$(node "$LOCAL_FROZEN_ROOT/cortex-learning-os/src/phd-qualification-launch.mjs" verify-existing-job \
      --plan "$JOBS_PATH" \
      --secret "$QUALIFICATION_SECRET_PATH" \
      --expected-subject-id "$SUBJECT_ID" \
      --expected-campaign-id "$CAMPAIGN_ID" \
      --expected-campaign-digest "$CAMPAIGN_DIGEST" \
      --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
      --expected-key-id "$EXPECTED_KEY_ID" \
      --expected-plan-digest "$PLAN_DIGEST" \
      --job-id "$JOB_ID" \
      --job "$LOCAL_JOB_CANDIDATE")"
  else
    VERIFIED_JOB="$(node "$VERIFIER" materialize-job \
      --plan "$JOBS_PATH" \
      --secret "$QUALIFICATION_SECRET_PATH" \
      --expected-subject-id "$SUBJECT_ID" \
      --expected-campaign-id "$CAMPAIGN_ID" \
      --expected-campaign-digest "$CAMPAIGN_DIGEST" \
      --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
      --expected-key-id "$EXPECTED_KEY_ID" \
      --plan-digest "$PLAN_DIGEST" \
      --job-id "$JOB_ID" \
      --out "$LOCAL_JOB_STAGE")"
  fi
  JOB_FILE_SHA256="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.jobFileSha256)' "$VERIFIED_JOB")"
  [[ "$JOB_FILE_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid authenticated job digest" >&2; exit 2; }
  durable_publish_local file "$LOCAL_JOB_STAGE" "$LOCAL_JOB" "$JOB_FILE_SHA256"
  if ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_JOB" \
      && ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_JOB_TEMP" \
      && [[ "$ARCHIVAL_ONLY" == false ]]; then
    scp -q "$LOCAL_JOB" "$SSH_HOST:$REMOTE_JOB_TEMP"
    ssh "$SSH_HOST" chown root:jake "$REMOTE_JOB_TEMP"
    ssh "$SSH_HOST" chmod 440 "$REMOTE_JOB_TEMP"
  elif ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_JOB" \
      && ! ssh -o BatchMode=yes "$SSH_HOST" test -e "$REMOTE_JOB_TEMP"; then
    echo "remote archived job is absent; archival-only resume cannot materialize it" >&2
    exit 3
  fi
  durable_publish_remote file "$REMOTE_JOB_TEMP" "$REMOTE_JOB" "$JOB_FILE_SHA256"
  [[ "$(ssh -o BatchMode=yes "$SSH_HOST" sha256sum "$REMOTE_JOB" | awk '{print $1}')" \
    == "$JOB_FILE_SHA256" ]] \
    || { echo "remote published job differs from authenticated bytes" >&2; exit 3; }
done < <(node -e 'const v=JSON.parse(process.argv[1]);for(const id of v.jobIds)console.log(id)' "$VERIFIED_PLAN")

EXPECTED_JOB_FILES="$(node -e 'const v=JSON.parse(process.argv[1]);for(const id of [...v.jobIds].sort())console.log(`${id}.json`)' "$VERIFIED_PLAN")"
OBSERVED_JOB_FILES="$(ssh -o BatchMode=yes "$SSH_HOST" find "$REMOTE_JOB_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\\n' | sort)"
[[ "$OBSERVED_JOB_FILES" == "$EXPECTED_JOB_FILES" ]] || { echo "remote authenticated job set is partial, injected, or stale" >&2; exit 3; }
EXPECTED_JOB_METADATA="$(node -e 'const v=JSON.parse(process.argv[1]);for(const id of [...v.jobIds].sort())console.log(`${id}.json root jake 440`)' "$VERIFIED_PLAN")"
OBSERVED_JOB_METADATA="$(ssh -o BatchMode=yes "$SSH_HOST" find "$REMOTE_JOB_ROOT" -mindepth 1 -maxdepth 1 -type f -printf '%f %u %g %m\\n' | sort)"
[[ "$OBSERVED_JOB_METADATA" == "$EXPECTED_JOB_METADATA" ]] || { echo "remote authenticated job ownership, mode, type, or exact set mismatch" >&2; exit 3; }

content_identity_sha256() {
  local VALUE
  for VALUE in "$@"; do
    printf '%s:%s\n' "${#VALUE}" "$VALUE"
  done | sha256sum | awk '{print $1}'
}

command_identity_sha256() {
  printf '%s\0' "$@" | sha256sum | awk '{print $1}'
}

unit_name() {
  local KIND="$1"
  local READABLE="$2"
  local IDENTITY="$3"
  local PREFIX="${READABLE//[^A-Za-z0-9-]/-}"
  PREFIX="${PREFIX:0:40}"
  printf 'clos-phd-%s-%s-%s' "$KIND" "$PREFIX" "$IDENTITY"
}

declare -A OBSERVED_UNIT_BINDINGS=()
assert_unique_unit_binding() {
  local UNIT="$1"
  local BINDING="$2"
  if [[ -n "${OBSERVED_UNIT_BINDINGS[$UNIT]:-}" \
    && "${OBSERVED_UNIT_BINDINGS[$UNIT]}" != "$BINDING" ]]; then
    echo "qualification transient unit identity collision: $UNIT" >&2
    exit 3
  fi
  OBSERVED_UNIT_BINDINGS["$UNIT"]="$BINDING"
}

assert_remote_active_unit() {
  local UNIT="$1" BINDING="$2" COMMAND_SHA="$3" EXPECTED_USER="$4"
  local EXPECTED_GROUP="$5" EXPECTED_CWD="$6"
  local PID USER GROUP CWD ENVIRONMENT OBSERVED_COMMAND_SHA OBSERVED_CWD
  PID="$(ssh -o BatchMode=yes "$SSH_HOST" systemctl show "$UNIT" --property=MainPID --value)"
  USER="$(ssh -o BatchMode=yes "$SSH_HOST" systemctl show "$UNIT" --property=User --value)"
  GROUP="$(ssh -o BatchMode=yes "$SSH_HOST" systemctl show "$UNIT" --property=Group --value)"
  CWD="$(ssh -o BatchMode=yes "$SSH_HOST" systemctl show "$UNIT" --property=WorkingDirectory --value)"
  ENVIRONMENT="$(ssh -o BatchMode=yes "$SSH_HOST" systemctl show "$UNIT" --property=Environment --value)"
  [[ "$PID" =~ ^[1-9][0-9]*$ && "$USER" == "$EXPECTED_USER" \
    && "$GROUP" == "$EXPECTED_GROUP" && "$CWD" == "$EXPECTED_CWD" \
    && "$ENVIRONMENT" == "CLOS_UNIT_BINDING_SHA256=$BINDING" ]] \
    || { echo "active remote qualification unit properties do not match: $UNIT" >&2; return 1; }
  OBSERVED_COMMAND_SHA="$(ssh -o BatchMode=yes "$SSH_HOST" sha256sum "/proc/$PID/cmdline" | awk '{print $1}')"
  OBSERVED_CWD="$(ssh -o BatchMode=yes "$SSH_HOST" readlink -f "/proc/$PID/cwd")"
  [[ "$OBSERVED_COMMAND_SHA" == "$COMMAND_SHA" && "$OBSERVED_CWD" == "$EXPECTED_CWD" ]] \
    || { echo "active remote qualification unit command does not match: $UNIT" >&2; return 1; }
}

assert_local_active_unit() {
  local UNIT="$1" BINDING="$2" COMMAND_SHA="$3" EXPECTED_USER="$4"
  local EXPECTED_GROUP="$5" EXPECTED_CWD="$6"
  local PID USER GROUP CWD ENVIRONMENT OBSERVED_COMMAND_SHA OBSERVED_CWD
  PID="$(systemctl show "$UNIT" --property=MainPID --value)"
  USER="$(systemctl show "$UNIT" --property=User --value)"
  GROUP="$(systemctl show "$UNIT" --property=Group --value)"
  CWD="$(systemctl show "$UNIT" --property=WorkingDirectory --value)"
  ENVIRONMENT="$(systemctl show "$UNIT" --property=Environment --value)"
  [[ "$PID" =~ ^[1-9][0-9]*$ && "$USER" == "$EXPECTED_USER" \
    && "$GROUP" == "$EXPECTED_GROUP" && "$CWD" == "$EXPECTED_CWD" \
    && "$ENVIRONMENT" == "CLOS_UNIT_BINDING_SHA256=$BINDING" ]] \
    || { echo "active local qualification unit properties do not match: $UNIT" >&2; return 1; }
  OBSERVED_COMMAND_SHA="$(sha256sum "/proc/$PID/cmdline" | awk '{print $1}')"
  OBSERVED_CWD="$(readlink -f "/proc/$PID/cwd")"
  [[ "$OBSERVED_COMMAND_SHA" == "$COMMAND_SHA" && "$OBSERVED_CWD" == "$EXPECTED_CWD" ]] \
    || { echo "active local qualification unit command does not match: $UNIT" >&2; return 1; }
}

assert_local_active_harvester() {
  local UNIT="$1" BINDING="$2" COMMAND_SHA="$3"
  shift 3
  local PID USER GROUP CWD ENVIRONMENT OBSERVED_COMMAND_SHA
  PID="$(systemctl show "$UNIT" --property=MainPID --value)"
  USER="$(systemctl show "$UNIT" --property=User --value)"
  GROUP="$(systemctl show "$UNIT" --property=Group --value)"
  CWD="$(systemctl show "$UNIT" --property=WorkingDirectory --value)"
  ENVIRONMENT="$(systemctl show "$UNIT" --property=Environment --value)"
  [[ "$PID" =~ ^[1-9][0-9]*$ && "$USER" == root && "$GROUP" == root \
    && "$CWD" == / && "$ENVIRONMENT" == "CLOS_UNIT_BINDING_SHA256=$BINDING" ]] \
    || { echo "active local qualification harvester properties do not match: $UNIT" >&2; return 1; }
  OBSERVED_COMMAND_SHA="$(sha256sum "/proc/$PID/cmdline" | awk '{print $1}')"
  [[ "$OBSERVED_COMMAND_SHA" == "$COMMAND_SHA" ]] \
    || { echo "active local qualification harvester command digest changed: $UNIT" >&2; return 1; }
  python3 - "$PID" "$@" <<'PY'
import pathlib
import sys

pid = sys.argv[1]
expected = sys.argv[2:]
raw = pathlib.Path(f"/proc/{pid}/cmdline").read_bytes()
actual = [part.decode("utf-8") for part in raw.rstrip(b"\0").split(b"\0")]
if actual != expected:
    raise SystemExit("active harvester full command identity changed")
PY
}

while IFS= read -r JOB_ID; do
  LOCAL_JOB="$LOCAL_JOB_ROOT/$JOB_ID.json"
  REMOTE_JOB="$REMOTE_JOB_ROOT/$JOB_ID.json"
  JOB_FILE_SHA256="$(sha256sum "$LOCAL_JOB" | awk '{print $1}')"
  WORKER_COMMAND=(
    /bin/bash "$REMOTE_FROZEN_ROOT/cortex-learning-os/scripts/remote-phd-qualification-worker.sh"
    "$JOB_ID" "$SOURCE_COMMIT" "$SOURCE_TREE" "$PRODUCT_TREE"
    "$REMOTE_JOB" "$REMOTE_ARTIFACT_ROOT/$JOB_ID"
    "$JOB_FILE_SHA256" "$PLAN_DIGEST" "$CAMPAIGN_DIGEST"
    "$DESCRIPTOR_SET_SHA256" "$RUNTIME_SHA256" "$CLOSURE_SHA256" "$REMOTE_FROZEN_ROOT"
  )
  WORKER_COMMAND_SHA="$(command_identity_sha256 "${WORKER_COMMAND[@]}")"
  WORKER_BINDING="$(content_identity_sha256 \
    worker "$PLAN_DIGEST" "$CAMPAIGN_ID" "$JOB_ID" "$JOB_FILE_SHA256" \
    "$WORKER_COMMAND_SHA" "$REMOTE_FROZEN_ROOT")"
  WORKER_UNIT="$(unit_name worker "$JOB_ID" "$WORKER_BINDING")"
  assert_unique_unit_binding "$WORKER_UNIT" "$WORKER_BINDING"
  if [[ "$ARCHIVAL_ONLY" == true ]]; then
    if ssh -o BatchMode=yes "$SSH_HOST" systemctl is-active --quiet "$WORKER_UNIT"; then
      if assert_remote_active_unit "$WORKER_UNIT" "$WORKER_BINDING" "$WORKER_COMMAND_SHA" \
        root root "$REMOTE_FROZEN_ROOT/cortex-learning-os"; then
        continue
      fi
      ssh -o BatchMode=yes "$SSH_HOST" systemctl is-active --quiet "$WORKER_UNIT" \
        && { echo "active qualification worker identity changed" >&2; exit 3; }
    fi
    WORKER_COMMAND+=(reconcile-only)
    if ssh -o BatchMode=yes "$SSH_HOST" "${WORKER_COMMAND[@]}"; then
      continue
    else
      RECONCILE_STATUS=$?
      [[ "$RECONCILE_STATUS" -eq 7 || "$RECONCILE_STATUS" -eq 8 ]] \
        || { echo "remote archival publication reconciliation failed: $JOB_ID" >&2; exit 3; }
      continue
    fi
  fi
  if ssh -o BatchMode=yes "$SSH_HOST" systemctl is-active --quiet "$WORKER_UNIT"; then
    assert_remote_active_unit "$WORKER_UNIT" "$WORKER_BINDING" "$WORKER_COMMAND_SHA" \
      root root "$REMOTE_FROZEN_ROOT/cortex-learning-os" || exit 3
    continue
  fi
  ssh -o BatchMode=yes "$SSH_HOST" systemctl reset-failed "$WORKER_UNIT" >/dev/null 2>&1 || true
  ssh "$SSH_HOST" systemd-run --unit="$WORKER_UNIT" --collect --quiet \
    --description="Cortex Learning OS qualification worker $WORKER_BINDING" \
    --property=User=root --property=Group=root \
    --property="Environment=CLOS_UNIT_BINDING_SHA256=$WORKER_BINDING" \
    --working-directory="$REMOTE_FROZEN_ROOT/cortex-learning-os" \
    "${WORKER_COMMAND[@]}"
done < <(node -e 'const v=JSON.parse(process.argv[1]);for(const id of v.jobIds)console.log(id)' "$VERIFIED_PLAN")

HARVEST_COMMAND_BASE=(
  /usr/bin/python3 "$LOCAL_FROZEN_ROOT_STABLE/cortex-learning-os/scripts/harvest-phd-qualification.py"
    --jobs "$AUTHENTICATED_PLAN_STABLE" --ssh-host "$SSH_HOST" \
    --secret "$QUALIFICATION_SECRET_STABLE_PATH" \
    --verifier "$LOCAL_FROZEN_ROOT_STABLE/cortex-learning-os/src/phd-qualification-launch.mjs" \
    --checkout-root "$LOCAL_FROZEN_ROOT_STABLE" \
    --expected-plan-digest "$PLAN_DIGEST" \
    --expected-subject-id "$SUBJECT_ID" \
    --expected-campaign-id "$CAMPAIGN_ID" \
    --expected-campaign-digest "$CAMPAIGN_DIGEST" \
    --expected-deployment-digest "$DEPLOYMENT_DIGEST" \
    --expected-key-id "$EXPECTED_KEY_ID" \
    --expected-descriptor-set-sha256 "$DESCRIPTOR_SET_SHA256" \
    --expected-job-count "$JOB_COUNT" \
    --expected-job-set-sha256 "$JOB_SET_SHA256" \
    --expected-product-tree "$PRODUCT_TREE" \
    --expected-runtime-sha256 "$RUNTIME_SHA256" \
    --expected-closure-sha256 "$CLOSURE_SHA256" \
    --remote-checkout-root "$REMOTE_FROZEN_ROOT" \
    --remote-job-root "$REMOTE_JOB_ROOT" \
    --remote-artifact-root "$REMOTE_ARTIFACT_ROOT" \
    --local-artifact-root "$LOCAL_ARTIFACT_ROOT_STABLE" \
    --local-staging-root "$LOCAL_HARVEST_STAGING_ROOT_STABLE" \
    --local-quarantine-root "$LOCAL_HARVEST_QUARANTINE_ROOT_STABLE" \
    --state-file "$STATE_FILE_STABLE" \
    --campaign-lock "$CAMPAIGN_HARVEST_LOCK_STABLE"
)
HARVEST_COMMAND=("${HARVEST_COMMAND_BASE[@]}")
HARVEST_COMMAND_SHA="$(command_identity_sha256 "${HARVEST_COMMAND[@]}")"
HARVEST_BINDING="$(content_identity_sha256 \
  harvester "$PLAN_DIGEST" "$CAMPAIGN_ID" "$CAMPAIGN_DIGEST" "$DEPLOYMENT_DIGEST" \
  "$CAMPAIGN_HARVEST_LOCK_STABLE" "$HARVEST_COMMAND_SHA")"
HARVEST_UNIT="$(unit_name harvest "$CAMPAIGN_ID" "$HARVEST_BINDING")"
assert_unique_unit_binding "$HARVEST_UNIT" "$HARVEST_BINDING"
HARVEST_RESTARTED=false
PRE_HARVEST_STATE_SHA=""
if systemctl is-active --quiet "$HARVEST_UNIT"; then
  assert_local_active_harvester \
    "$HARVEST_UNIT" "$HARVEST_BINDING" "$HARVEST_COMMAND_SHA" \
    "${HARVEST_COMMAND[@]}" || exit 3
else
  if [[ -f "$STATE_FILE_STABLE" && ! -L "$STATE_FILE_STABLE" ]]; then
    PRE_HARVEST_STATE_SHA="$(sha256sum "$STATE_FILE_STABLE" | awk '{print $1}')"
  fi
  systemctl reset-failed "$HARVEST_UNIT" >/dev/null 2>&1 || true
  systemd-run --unit="$HARVEST_UNIT" --collect --quiet \
    --description="Cortex Learning OS qualification harvest $HARVEST_BINDING" \
    --property=User=root --property=Group=root --working-directory=/ \
    --property="Environment=CLOS_UNIT_BINDING_SHA256=$HARVEST_BINDING" \
    "${HARVEST_COMMAND[@]}"
  HARVEST_RESTARTED=true
fi
if [[ "$HARVEST_RESTARTED" == true ]]; then
  HARVEST_STATE_ADVANCED=false
  for _ in $(seq 1 120); do
    if [[ -f "$STATE_FILE_STABLE" && ! -L "$STATE_FILE_STABLE" ]]; then
      CURRENT_HARVEST_STATE_SHA="$(sha256sum "$STATE_FILE_STABLE" | awk '{print $1}')"
      STATE_CHANGED=false
      [[ "$CURRENT_HARVEST_STATE_SHA" != "$PRE_HARVEST_STATE_SHA" ]] \
        && STATE_CHANGED=true
      if python3 - \
        "$STATE_FILE_STABLE" "$QUALIFICATION_SECRET_STABLE_PATH" "$STATE_CHANGED" \
        "$PLAN_DIGEST" "$CAMPAIGN_ID" "$CAMPAIGN_DIGEST" "$DEPLOYMENT_DIGEST" \
        "$DESCRIPTOR_SET_SHA256" "$JOB_SET_SHA256" "$PRODUCT_TREE" \
        "$RUNTIME_SHA256" "$CLOSURE_SHA256" "$JOB_COUNT" <<'PY'
import hashlib
import hmac
import json
import pathlib
import sys

[
    state_path, secret_path, state_changed, plan_digest, campaign_id,
    campaign_digest, deployment_digest, descriptor_set_sha256,
    job_set_sha256, product_tree, runtime_sha256, closure_sha256,
    expected_job_count,
] = sys.argv[1:]
state = json.loads(pathlib.Path(state_path).read_text(encoding="utf-8"))
signature = state.get("controlPlaneSignature")
unsigned = {key: value for key, value in state.items() if key != "controlPlaneSignature"}
secret = pathlib.Path(secret_path).read_text(encoding="utf-8").strip()
expected_signature = hmac.new(
    secret.encode("utf-8"),
    json.dumps(
        unsigned,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8"),
    hashlib.sha256,
).hexdigest()
expected_key_id = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]
expected = {
    "schemaVersion": "cortex.learning_os.phd_harvest_state.v2",
    "planDigest": plan_digest,
    "campaignId": campaign_id,
    "campaignDigest": campaign_digest,
    "deploymentDigest": deployment_digest,
    "descriptorSetSha256": descriptor_set_sha256,
    "jobSetSha256": job_set_sha256,
    "productTree": product_tree,
    "runtimeSha256": runtime_sha256,
    "closureSha256": closure_sha256,
    "expectedJobCount": int(expected_job_count),
}
if (
    not isinstance(signature, dict)
    or signature.get("algorithm") != "hmac-sha256"
    or signature.get("keyId") != expected_key_id
    or not hmac.compare_digest(str(signature.get("digest", "")), expected_signature)
    or any(state.get(key) != value for key, value in expected.items())
    or state.get("status") not in {
        "running", "failed", "ready_for_independent_replay",
    }
    or (state_changed != "true"
        and state.get("status") != "ready_for_independent_replay")
):
    raise SystemExit(1)
PY
      then
        HARVEST_STATE_ADVANCED=true
        break
      fi
    fi
    systemctl is-failed --quiet "$HARVEST_UNIT" \
      && { echo "qualification harvester failed before durable state reconciliation" >&2; exit 3; }
    sleep 1
  done
  [[ "$HARVEST_STATE_ADVANCED" == true ]] \
    || { echo "qualification harvester did not durably advance campaign state" >&2; exit 3; }
fi
if [[ "$NOTIFY" == true ]]; then
  NOTIFY_COMMAND=(
    /usr/bin/python3 "$LOCAL_FROZEN_ROOT_STABLE/cortex-learning-os/scripts/detached_job_notifier.py"
    --state-file "$STATE_FILE_STABLE" --job-label "Cortex Learning OS PhD campaign $CAMPAIGN_ID"
  )
  NOTIFY_COMMAND_SHA="$(command_identity_sha256 "${NOTIFY_COMMAND[@]}")"
  NOTIFY_BINDING="$(content_identity_sha256 \
    notifier "$PLAN_DIGEST" "$CAMPAIGN_ID" "$CAMPAIGN_DIGEST" "$NOTIFY_COMMAND_SHA")"
  NOTIFY_UNIT="$(unit_name notify "$CAMPAIGN_ID" "$NOTIFY_BINDING")"
  assert_unique_unit_binding "$NOTIFY_UNIT" "$NOTIFY_BINDING"
  if systemctl is-active --quiet "$NOTIFY_UNIT"; then
    assert_local_active_unit "$NOTIFY_UNIT" "$NOTIFY_BINDING" "$NOTIFY_COMMAND_SHA" \
      root root / || exit 3
  else
    systemctl reset-failed "$NOTIFY_UNIT" >/dev/null 2>&1 || true
    systemd-run --unit="$NOTIFY_UNIT" --collect --quiet \
      --description="Cortex Learning OS qualification notification $NOTIFY_BINDING" \
      --property=User=root --property=Group=root --working-directory=/ \
      --property="Environment=CLOS_UNIT_BINDING_SHA256=$NOTIFY_BINDING" \
      "${NOTIFY_COMMAND[@]}"
  fi
fi
printf '%s\n' "$STATE_FILE_STABLE"
