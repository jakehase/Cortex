# Cortex Deploy (Canonical)

## Immutable post-audit release contract

Path-scoped and in-place deployment is not an acceptance path for the October
2026 repair. The existing q9 envelope/controller is authoritative. It fails
closed unless source, tests, release contents, deployment, rollback/redeploy,
the repair surface matrix, and the authoritative remote accepted ref identify
one commit and tree.

The qualification runners must emit `cortex.qualification-receipt.v1` JSON for
`full-suite` and `focused-gates`. Each receipt records `sourceCommit`,
`sourceTree`, `exitCode: 0`, timestamps, a replay argv, and at least one hashed
artifact. The focused receipt must cover every ID declared in
`ops/release/runtime-surfaces.json`, including `BROWSER-1` and `OPS-2`.

Build and immutable archive replay (run only after the final candidate commit):

```bash
set -euo pipefail
SOURCE_ROOT=/root/clawd/_worktrees/cortex-repair-20261011
EVIDENCE_ROOT=/root/clawd/artifacts/cortex-repair-20261011/release
RELEASE_ID=cortex-q9-repair-20261011
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$SOURCE_ROOT" rev-parse 'HEAD^{tree}')"
test -z "$(git -C "$SOURCE_ROOT" status --porcelain=v1 --untracked-files=all)"
python3 "$SOURCE_ROOT/scripts/build-release-envelope.py" \
  --root "$SOURCE_ROOT" \
  --output "$EVIDENCE_ROOT/release-envelope.json" \
  --release-id "$RELEASE_ID" \
  --surface-contract "$SOURCE_ROOT/ops/release/runtime-surfaces.json" \
  --qualification-receipt "full-suite=$EVIDENCE_ROOT/full-suite-receipt.json" \
  --qualification-receipt "focused-gates=$EVIDENCE_ROOT/focused-gates-receipt.json" \
  --require-clean
git -C "$SOURCE_ROOT" archive --format=tar --prefix="$RELEASE_ID/" "$SOURCE_COMMIT" \
  | gzip -n >"$EVIDENCE_ROOT/$RELEASE_ID.tar.gz"
sha256sum "$EVIDENCE_ROOT/$RELEASE_ID.tar.gz"
```

Run the established OpenClaw gateway code-manifest preflight against that
archive/envelope next. Its immutable receipt must use schema
`cortex.gateway-code-manifest-preflight.v1`, bind the same release ID, commit,
tree, and envelope digest, record `manifestMatched: true`,
`inaccessiblePathCount: 0`, and include `codeManifestSha256`.

The deployment contract then supplies the archive and digest, envelope,
pending environment/configuration, graph backup, rendered unit, evidence root,
gateway receipt, source root, surface matrix, surface-evidence receipt paths,
authoritative remote URL, and `refs/heads/accepted/...` ref. Execute in this
order on the control plane:

```bash
sudo python3 scripts/deploy-q9-release.py preflight --contract "$EVIDENCE_ROOT/deployment-contract.json"
sudo python3 scripts/deploy-q9-release.py activate --contract "$EVIDENCE_ROOT/deployment-contract.json"
sudo python3 scripts/deploy-q9-release.py rollback --contract "$EVIDENCE_ROOT/deployment-contract.json"
sudo python3 scripts/deploy-q9-release.py redeploy --contract "$EVIDENCE_ROOT/deployment-contract.json"
git push origin "$SOURCE_COMMIT:refs/heads/accepted/cortex-repair-20261011"
sudo python3 scripts/deploy-q9-release.py supervise --contract "$EVIDENCE_ROOT/deployment-contract.json"
python3 scripts/detached_job_notifier.py \
  --state-file "$EVIDENCE_ROOT/state.json" \
  --required-producer cortex.release-supervisor.v1 \
  --job-label "Cortex post-audit repair release" \
  --exit-after-delivery
```

`supervise` is read-only with respect to services and refs. It queries the
authoritative remote directly with `git ls-remote`; a missing local tracking ref
therefore cannot mask either success or failure. The notifier accepts only that
supervisor producer and uses its durable delivery ledger to deduplicate.

Rollback recovery remains available after a failed activation or redeploy via
the same `rollback` action and captured preimage. Do not remove the prior
release, preimage, graph backup, or `rollback.json` until supervisor state is
green and the accepted ref has been independently observed.

Use only this path:
- Compose file: `/opt/clawdbot/docker-compose.yml`

## Deterministic release pipeline (recommended)
```bash
cd /opt/clawdbot
./scripts/release_pipeline.sh
```

Pipeline order:
1. preflight CI gate (`./scripts/ci_gate.sh`)
2. build + recreate `cortex-brain`
3. health wait (`/health`)
4. post-deploy CI gate

## Fast deploy wrapper
```bash
cd /opt/clawdbot
./scripts/deploy_cortex.sh
```

## Manual restart only
```bash
cd /opt/clawdbot
docker compose up -d --build cortex-brain
```

## Verify
```bash
curl -s http://10.0.0.52:8888/health
curl -s http://10.0.0.52:8888/metrics
```

## Notes
- tinyllama is Q&A-only by policy.
- MiniMax is disabled by policy.
- Browser search requires Playwright browser + deps in container.
- Lockfile: `/opt/clawdbot/cortex_server/requirements.lock.txt`

- Replay regression is enforced in CI using /opt/clawdbot/benchmarks/replay_enforced_seed.jsonl (default max-fail-rate 0.0).
