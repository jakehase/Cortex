# Cortex Deploy (Canonical)

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
