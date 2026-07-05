# Game 100-Agent Readiness

This is the launch scaffold for the MapleStory-like 3D side-scrolling Godot vertical-slice goal.

## What it implements

- 100 low-overlap Godot product surfaces.
- Remote-only execution boundary.
- Isolated worker workspace policy.
- Scheduler policy for leases, retries, stale-worker recovery, active Codex throttling, usage-limit backoff, work stealing, and no fake-done terminal state.
- Admission gates for empty diffs, docs/tests-only changes, assigned product-file touch, verifier evidence, merge conflicts, canonical landing evidence, and marker-only deltas.
- Godot/game verifier hooks:
  - project/import gate
  - headless scene-load hook
  - movement/combat harness hook
  - asset manifest check
  - optional screenshot capture hook
- Automatic repair lane policy for compile/import, scene, harness, collision, test, asset, integration-wire, and no-op/marker-only failures.
- 10/25/50/100 proof ladder.
- `tier3_game_vertical_slice_100agent` threshold rules.

## Scoring rubric

The 100-agent game tier no longer treats 100/100 as the only useful success state.

- **Green:** at least 95/100 verified productive surfaces, 100-agent Codex/worker scale proof, required Godot gates, no truth contradictions/fake-green incidents, and every residual failure classified as non-systemic.
- **Yellow / near-green:** at least 90/100 verified productive surfaces with classified residual failures, but below the green floor.
- **Perfect:** 100/100 verified productive surfaces.
- **Red:** below 90/100, missing verifier/product-diff evidence, unclassified/systemic failures, state loss, fake-green risk, or missing scale proof.

Reports must keep these labels separate. A green tolerant run is not a perfect 100/100 run.

## Commands

Initialize the scaffold:

```bash
npm run benchmark:game100:init
```

Verify a run contract without requiring the game repo to exist yet:

```bash
npm run benchmark:game100:verify-readiness -- <run_contract.json> --contract-only
```

Launch/readiness preflight on the execution plane only:

```bash
BENCHMARK_HOST_ROLE=execution_plane GAME_100_AGENT_REPO_PATH=/path/to/godot-game \
  npm run benchmark:game100:verify-readiness -- <run_contract.json> --launch
```

## Important boundary

Do not launch the 100-agent run on the OpenClaw/control-plane host. The contract is intentionally `remote_execution_required` and should run on the Hetzner execution plane or an equivalent worker host.

A missing Godot repo is a blocker, not a reason to downgrade the claim. Use `--contract-only` only to validate the scaffold shape; do not treat it as launch readiness.
