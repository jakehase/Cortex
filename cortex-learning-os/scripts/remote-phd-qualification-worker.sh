#!/usr/bin/env bash
set -Eeuo pipefail

JOB_ID="${1:-}"
EXPECTED_COMMIT="${2:-}"
EXPECTED_TREE="${3:-}"
EXPECTED_PRODUCT_TREE="${4:-}"
JOB_PATH="${5:-}"
FINAL_ARTIFACT_ROOT="${6:-}"
EXPECTED_JOB_FILE_SHA256="${7:-}"
EXPECTED_PLAN_DIGEST="${8:-}"
EXPECTED_CAMPAIGN_DIGEST="${9:-}"
EXPECTED_DESCRIPTOR_SET_SHA256="${10:-}"
EXPECTED_RUNTIME_SHA256="${11:-}"
EXPECTED_CLOSURE_SHA256="${12:-}"
REPO_ROOT="${13:-}"
WORKER_MODE="${14:-execute}"
CLOS_ROOT="$REPO_ROOT/cortex-learning-os"

[[ "$EUID" -eq 0 ]] || { echo "qualification terminal publisher must run as root" >&2; exit 2; }
[[ "$WORKER_MODE" == execute || "$WORKER_MODE" == reconcile-only ]] \
  || { echo "invalid qualification worker mode" >&2; exit 2; }
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] \
  || { echo "invalid job ID" >&2; exit 2; }
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ && "$EXPECTED_TREE" =~ ^[0-9a-f]{40}$ \
  && "$EXPECTED_PRODUCT_TREE" =~ ^[0-9a-f]{40}$ ]] \
  || { echo "invalid source identity" >&2; exit 2; }
for EXPECTED_DIGEST in \
  "$EXPECTED_JOB_FILE_SHA256" "$EXPECTED_PLAN_DIGEST" "$EXPECTED_CAMPAIGN_DIGEST" \
  "$EXPECTED_DESCRIPTOR_SET_SHA256" "$EXPECTED_RUNTIME_SHA256" "$EXPECTED_CLOSURE_SHA256"; do
  [[ "$EXPECTED_DIGEST" =~ ^[0-9a-f]{64}$ ]] \
    || { echo "invalid authenticated plan or closure digest" >&2; exit 2; }
done
[[ "$JOB_PATH" =~ ^/[A-Za-z0-9._/-]+$ \
  && "$FINAL_ARTIFACT_ROOT" =~ ^/[A-Za-z0-9._/-]+$ \
  && "$REPO_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] \
  || { echo "unsafe worker path" >&2; exit 2; }

[[ -d "$REPO_ROOT" && ! -L "$REPO_ROOT" && "$(stat -c %u "$REPO_ROOT")" == 0 ]] \
  || { echo "frozen execution checkout is unsafe" >&2; exit 2; }
CHECKOUT_ANCESTOR="$REPO_ROOT"
while :; do
  [[ -d "$CHECKOUT_ANCESTOR" && ! -L "$CHECKOUT_ANCESTOR" ]] \
    || { echo "frozen execution checkout ancestor is unsafe" >&2; exit 2; }
  read -r ANCESTOR_UID ANCESTOR_GID ANCESTOR_MODE < <(
    stat -c '%u %g %a' "$CHECKOUT_ANCESTOR"
  )
  [[ "$ANCESTOR_UID" == 0 && "$ANCESTOR_GID" == 0 \
    && $((8#$ANCESTOR_MODE & 8#022)) -eq 0 ]] \
    || { echo "frozen execution checkout ancestor is not root-owned immutable material" >&2; exit 2; }
  [[ "$CHECKOUT_ANCESTOR" == / ]] && break
  CHECKOUT_ANCESTOR="$(dirname -- "$CHECKOUT_ANCESTOR")"
done

[[ -f "$JOB_PATH" && ! -L "$JOB_PATH" ]] || { echo "job is not a regular file" >&2; exit 2; }
read -r JOB_OWNER JOB_GROUP JOB_MODE JOB_LINKS < <(stat -c '%U %G %a %h' "$JOB_PATH")
[[ "$JOB_OWNER" == root && "$JOB_GROUP" == jake && "$JOB_MODE" == 440 && "$JOB_LINKS" == 1 ]] \
  || { echo "job is not root-owned single-link read-only material" >&2; exit 2; }
[[ "$(sha256sum "$JOB_PATH" | awk '{print $1}')" == "$EXPECTED_JOB_FILE_SHA256" ]] \
  || { echo "authenticated job bytes changed in transit" >&2; exit 3; }
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.deployment.sourceCommit)' "$JOB_PATH")" == "$EXPECTED_COMMIT" ]]
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.deployment.sourceTree)' "$JOB_PATH")" == "$EXPECTED_TREE" ]]
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.deployment.productTree)' "$JOB_PATH")" == "$EXPECTED_PRODUCT_TREE" ]]
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.deployment.runtimeSha256)' "$JOB_PATH")" == "$EXPECTED_RUNTIME_SHA256" ]]
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.deployment.closureSha256)' "$JOB_PATH")" == "$EXPECTED_CLOSURE_SHA256" ]]
[[ "$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.campaignDigest)' "$JOB_PATH")" == "$EXPECTED_CAMPAIGN_DIGEST" ]]

DEPENDENCY_ROOT="$(dirname -- "$FINAL_ARTIFACT_ROOT")"
CAMPAIGN_ROOT="$(dirname -- "$DEPENDENCY_ROOT")"
ARTIFACT_STAGING_ROOT="$CAMPAIGN_ROOT/artifact-staging"
QUARANTINE_ROOT="$CAMPAIGN_ROOT/quarantine/artifacts"
PRODUCER_STAGE="$ARTIFACT_STAGING_ROOT/$JOB_ID.producer"
PUBLISHER_STAGE="$ARTIFACT_STAGING_ROOT/$JOB_ID.publisher"
PUBLICATION_JOURNAL="$ARTIFACT_STAGING_ROOT/$JOB_ID.publication.json"
PUBLICATION_LOCK="$ARTIFACT_STAGING_ROOT/$JOB_ID.exclusion"
PUBLISHER="$CLOS_ROOT/src/phd-terminal-publication.mjs"
PRODUCER_UID="$(id -u jake)"
PRODUCER_GID="$(id -g jake)"

[[ "$(stat -c '%U:%G:%a' "$DEPENDENCY_ROOT")" == "root:root:755" \
  && ! -L "$DEPENDENCY_ROOT" ]] \
  || { echo "terminal artifact namespace is not root-owned read-only-to-producer material" >&2; exit 5; }
[[ "$(stat -c '%U:%G:%a' "$ARTIFACT_STAGING_ROOT")" == "root:jake:710" \
  && ! -L "$ARTIFACT_STAGING_ROOT" ]] \
  || { echo "qualification artifact staging root is unsafe" >&2; exit 5; }
[[ "$(stat -c '%U:%G:%a' "$QUARANTINE_ROOT")" == "root:root:700" \
  && ! -L "$QUARANTINE_ROOT" ]] \
  || { echo "qualification quarantine root is unsafe" >&2; exit 5; }

if mkdir --mode=700 -- "$PUBLICATION_LOCK" 2>/dev/null; then
  sync -d "$ARTIFACT_STAGING_ROOT"
fi
[[ -d "$PUBLICATION_LOCK" && ! -L "$PUBLICATION_LOCK" \
  && "$(stat -c '%U:%G:%a' "$PUBLICATION_LOCK")" == "root:root:700" ]] \
  || { echo "qualification publication exclusion inode is unsafe" >&2; exit 5; }
exec {PUBLICATION_LOCK_FD}<"$PUBLICATION_LOCK"
LOCK_PATH_IDENTITY="$(stat -c '%d:%i' "$PUBLICATION_LOCK")"
LOCK_DESCRIPTOR_IDENTITY="$(stat -Lc '%d:%i' "/proc/self/fd/$PUBLICATION_LOCK_FD")"
[[ "$LOCK_PATH_IDENTITY" == "$LOCK_DESCRIPTOR_IDENTITY" ]] \
  || { echo "qualification publication exclusion pathname changed" >&2; exit 5; }
[[ -f /usr/bin/flock && ! -L /usr/bin/flock ]] \
  || { echo "qualification publication kernel helper is unsafe" >&2; exit 5; }
read -r FLOCK_UID FLOCK_GID FLOCK_MODE FLOCK_LINKS FLOCK_PATH_IDENTITY < <(
  stat -c '%u %g %a %h %d:%i' /usr/bin/flock
)
[[ "$FLOCK_UID" == 0 && "$FLOCK_GID" == 0 && "$FLOCK_LINKS" == 1 \
  && $((8#$FLOCK_MODE & 8#7022)) -eq 0 && $((8#$FLOCK_MODE & 8#100)) -ne 0 ]] \
  || { echo "qualification publication kernel helper metadata is unsafe" >&2; exit 5; }
exec {KERNEL_FLOCK_FD}</usr/bin/flock
[[ "$(stat -Lc '%d:%i' "/proc/self/fd/$KERNEL_FLOCK_FD")" == "$FLOCK_PATH_IDENTITY" ]] \
  || { echo "qualification publication kernel helper changed" >&2; exit 5; }
if ! "/proc/self/fd/$KERNEL_FLOCK_FD" \
  --exclusive --nonblock "$PUBLICATION_LOCK_FD"; then
  echo "exact authenticated qualification job is active; archival publication deferred" >&2
  exit 8
fi
[[ "$(stat -c '%d:%i' "$PUBLICATION_LOCK")" == "$LOCK_DESCRIPTOR_IDENTITY" \
  && "$(stat -Lc '%U:%G:%a' "/proc/self/fd/$PUBLICATION_LOCK_FD")" == "root:root:700" ]] \
  || { echo "qualification publication exclusion changed during acquisition" >&2; exit 5; }

publish_or_recover() {
  node "$PUBLISHER" \
    --job "$JOB_PATH" \
    --producer-stage "$PRODUCER_STAGE" \
    --publisher-stage "$PUBLISHER_STAGE" \
    --final-root "$FINAL_ARTIFACT_ROOT" \
    --journal "$PUBLICATION_JOURNAL" \
    --quarantine-root "$QUARANTINE_ROOT" \
    --lock-path "$PUBLICATION_LOCK" \
    --lock-fd "$PUBLICATION_LOCK_FD" \
    --producer-uid "$PRODUCER_UID" \
    --producer-gid "$PRODUCER_GID" \
    --expected-job-file-sha256 "$EXPECTED_JOB_FILE_SHA256" \
    --plan-digest "$EXPECTED_PLAN_DIGEST" \
    --campaign-digest "$EXPECTED_CAMPAIGN_DIGEST" \
    --descriptor-set-sha256 "$EXPECTED_DESCRIPTOR_SET_SHA256" \
    --product-tree "$EXPECTED_PRODUCT_TREE" \
    --runtime-sha256 "$EXPECTED_RUNTIME_SHA256" \
    --closure-sha256 "$EXPECTED_CLOSURE_SHA256" \
    --checkout-root "$REPO_ROOT"
}

RECOVERY="$(publish_or_recover)"
RECOVERY_STATUS="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.status)' "$RECOVERY")"
if [[ "$RECOVERY_STATUS" == published ]]; then
  exit 0
fi
[[ "$RECOVERY_STATUS" == needs_execution ]] \
  || { echo "terminal publication recovery returned an invalid state" >&2; exit 5; }
if [[ "$WORKER_MODE" == reconcile-only ]]; then
  echo "no durable terminal publication is recoverable; archival mode will not execute work" >&2
  exit 7
fi

node -e '
  const job = require(process.argv[1]);
  if (Date.now() <= Date.parse(job.expiresAt)) process.exit(0);
  console.error("no durable terminal survived authorization expiry; a new campaign is required");
  process.exit(6);
' "$JOB_PATH"

while IFS= read -r DEPENDENCY_ID; do
  [[ "$DEPENDENCY_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] \
    || { echo "invalid dependency ID" >&2; exit 2; }
  DEPENDENCY_MANIFEST="$DEPENDENCY_ROOT/$DEPENDENCY_ID/artifact-manifest.json"
  for _ in $(seq 1 720); do
    [[ -f "$DEPENDENCY_MANIFEST" && ! -L "$DEPENDENCY_MANIFEST" ]] && break
    sleep 5
  done
  [[ -f "$DEPENDENCY_MANIFEST" && ! -L "$DEPENDENCY_MANIFEST" ]] \
    || { echo "dependency wait timed out" >&2; exit 4; }
done < <(node -e 'const j=require(process.argv[1]);for(const id of (j.dependencies||[]))console.log(id)' "$JOB_PATH")

[[ ! -e "$PRODUCER_STAGE" && ! -e "$PUBLISHER_STAGE" ]] \
  || { echo "publication reconciliation left an unsafe staging remnant" >&2; exit 5; }
install -d -m 700 -o jake -g jake "$PRODUCER_STAGE"
sync -d "$ARTIFACT_STAGING_ROOT"

WORKER_STATUS=0
cd "$CLOS_ROOT"
/usr/sbin/runuser --user jake --group jake -- \
  node src/run-phd-worker.mjs \
    --job "$JOB_PATH" \
    --expected-job-file-sha256 "$EXPECTED_JOB_FILE_SHA256" \
    --plan-digest "$EXPECTED_PLAN_DIGEST" \
    --campaign-digest "$EXPECTED_CAMPAIGN_DIGEST" \
    --descriptor-set-sha256 "$EXPECTED_DESCRIPTOR_SET_SHA256" \
    --product-tree "$EXPECTED_PRODUCT_TREE" \
    --runtime-sha256 "$EXPECTED_RUNTIME_SHA256" \
    --closure-sha256 "$EXPECTED_CLOSURE_SHA256" \
    --checkout-root "$REPO_ROOT" \
    --artifact-root "$PRODUCER_STAGE" \
    --dependency-root "$DEPENDENCY_ROOT" \
    --job-root "$(dirname -- "$JOB_PATH")" \
  || WORKER_STATUS=$?

PUBLICATION="$(publish_or_recover)"
PUBLICATION_STATUS="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.status)' "$PUBLICATION")"
[[ "$PUBLICATION_STATUS" == published ]] \
  || { echo "worker result was not durably published" >&2; exit 5; }
exit "$WORKER_STATUS"
