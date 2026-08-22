# VM102 rollout — MiroFish + OpenViking for Cortex

## Status
Prepared locally in `/root/clawd`. Not yet applied to VM102 because current SSH access to `root@10.0.0.52` fails with `Permission denied (publickey)`.

## Architecture decision
- Keep **Cortex** as the primary reasoning/routing/memory brain.
- Keep **OpenClaw** as mediator/runtime.
- Add **MiroFish** as an on-demand forecasting backend for:
  - L30 Seer
  - L20 Simulator
- Add **OpenViking** as a sidecar context-lab service for comparative evaluation against current Cortex memory, not as immediate production replacement.

## Rollout phases

### Phase 1 — MiroFish on VM102
- Deploy MiroFish service/container on VM102.
- Expose only on VM-local network.
- Add Cortex-side adapter config:
  - `MIROFISH_BASE_URL`
  - `MIROFISH_TIMEOUT_MS`
  - `MIROFISH_ENABLED`
- Route prediction/scenario prompts from Seer/Simulator to MiroFish.
- Keep fallback to native Seer/Simulator behavior.

### Phase 2 — OpenViking sidecar on VM102
- Deploy OpenViking separately on VM102.
- Ingest controlled subset only:
  - curated durable memory
  - curated project/priority/anti-drift memory
  - selected hybrid slice
- Compare OpenViking retrieval quality against current Cortex memory on fixed query set.
- Do not switch production memory path until it clearly wins.

## Acceptance tests

### MiroFish
- forecasting prompts produce richer scenario outputs
- Seer/Simulator fallback still works when disabled/unreachable
- Validator can still critique prediction outputs
- no regression in non-prediction prompts

### OpenViking
- better or equal recall on:
  - "What should be prioritized?"
  - "What durable facts do you know about Jake?"
  - "What is Cortex supposed to be architecturally?"
  - "What are current blockers?"
- improved retrieval observability
- no split-brain production cutover until proven

## Needed access to finish deployment
- Working SSH auth to VM102 (`10.0.0.52`) for the deployment user
- Optional: preferred deploy user/path if not `root`
- If VM102 uses different host/path, update the scripts before run
