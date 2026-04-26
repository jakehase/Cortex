# Assistant Stack Audit, 2026-04-16

This audit is Cortex-first and host-specific.

## Scope of what was actually verified

Observed live in this workspace/session:
- global OpenClaw skill folders on disk under `/usr/lib/node_modules/openclaw/skills/`
- local workspace-authored skills under `/root/clawd/skills/`
- live OpenClaw config at `/root/.openclaw/openclaw.json`
- no confirmed MCP config files found via quick filesystem search in `/root/clawd`, `/root/.config`, or nearby config roots

Important honesty note:
- this is a **skills and connector audit**, not proof that every skill on disk is currently exposed to this agent in every runtime
- this is also **not** proof that all remembered external connectors are currently configured and working

## Executive summary

Best active shape for us:
- a general assistant core should sit above any domain-specific skill cluster
- keep the new `clawd-` local skills as the main workflow layer
- keep a small core connector set centered on systems of record
- demote or ignore broad catalogs of host-mismatched consumer skills unless a real use case appears
- do not add duplicate memory/browser/search layers that compete with Cortex

Important scope correction:
- the currently authored local skills are weighted toward benchmark/orchestration work because that was the hottest recent repetition cluster
- they should be treated as the **first domain slice**, not the whole long-term assistant stack
- that correction has now been acted on with a general-core skill layer

## Live observations

### 1. Local authored skills

Observed under `/root/clawd/skills/`:
- `clawd-benchmark-orchestration`
- `clawd-benchmark-incident-audit`
- `clawd-campaign-truth-audit`
- `clawd-remote-execution-boundary`
- `clawd-brownfield-transfer-benchmark`
- `clawd-workspace-quarantine`
- `clawd-git-auth-and-export-recovery`
- `clawd-personal-ops-routing`

Assessment:
- **keep all**
- these match the actual repeated work in recent conversations
- these are Cortex-compatible overlays, not competing cognition

### 2. Global skill catalog on disk

Observed a broad global catalog under `/usr/lib/node_modules/openclaw/skills/`.
It includes useful infra and assistant skills, but also many platform-specific and lifestyle/device skills that do not belong in our default working set.

### 2b. Live skill enforcement

Observed after apply:
- `/root/.openclaw/openclaw.json` now contains a bundled-skill allowlist under `skills.allowBundled`
- `/root/.openclaw/openclaw.json` now contains a default visible-skill allowlist under `agents.defaults.skills`
- `openclaw gateway status` returned `running` after restart against that config
- `openclaw skills list` shows the local `clawd-` skills as `ready`

Meaning:
- the skill prune is now partially enforced in runtime, not just described in docs
- plugin/connectors were already on a small allowlist, so the new main enforcement work was skill-surface pruning

### 3. MCP/connectors

Observed live config:
- `/root/.openclaw/openclaw.json` confirms plugin usage and Cortex bridges
- Cortex memory and Cortex browser bridges are enabled
- no separate MCP server config inventory was positively verified from config files during this pass

So the MCP section below is a **policy audit plus best current inference**, not a claim that every connector is already wired and healthy.

## Recommended skill buckets

## A. Keep in the active working set

### Local `clawd-` skills

Keep:
- `clawd-task-intake-routing`
- `clawd-research-and-synthesis`
- `clawd-external-action-guardrails`
- `clawd-status-memory-handoff`
- `clawd-benchmark-orchestration`
- `clawd-benchmark-incident-audit`
- `clawd-campaign-truth-audit`
- `clawd-remote-execution-boundary`
- `clawd-brownfield-transfer-benchmark`
- `clawd-workspace-quarantine`
- `clawd-git-auth-and-export-recovery`
- `clawd-personal-ops-routing`

Reason:
- directly aligned with actual work
- Cortex-compatible
- collision-safe naming
- high reuse value

### Global skills to keep close

Keep:
- `skill-creator`
- `healthcheck`
- `node-connect`
- `taskflow`
- `taskflow-inbox-triage`
- `tmux`
- `video-frames`
- `weather`
- `github`

Reason:
- they solve real workflow or infrastructure needs in this environment
- they do not obviously compete with Cortex cognition when used correctly

## B. Keep, but situational only

These are fine to keep installed, but they should not be part of the mental default.

### Research / fallback tools
- `clawhub`
- `mcporter`
- `oracle`
- `summarize`
- `gemini`
- `session-logs`
- `model-usage`

Reason:
- can be useful, but easy to overuse or duplicate native/Cortex paths

### External-workspace / collaboration tools
- `discord`
- `slack`
- `notion`
- `trello`
- `gh-issues`
- `himalaya`
- `gog`
- `wacli`

Reason:
- only worth active attention when those systems are live systems of record for the task

### Device/media/specialized utilities
- `camsnap`
- `canvas`
- `nano-pdf`
- `openai-whisper`
- `openai-whisper-api`
- `sag`
- `sherpa-onnx-tts`
- `songsee`
- `gifgrep`
- `peekaboo`
- `voice-call`

Reason:
- useful, but not part of the default workstream

## C. Retire from the default surface

These do not need urgent removal, but they should not be part of our active stack plan unless a real use case appears.

### Platform-mismatched or likely irrelevant here
- `apple-notes`
- `apple-reminders`
- `bear-notes`
- `things-mac`
- `imsg`
- `bluebubbles`

Reason:
- macOS / Apple messaging specific
- no evidence they belong in the Linux control-plane default set

### Lifestyle / consumer-device tools with no current work signal
- `blucli`
- `eightctl`
- `openhue`
- `sonoscli`
- `spotify-player`
- `ordercli`
- `goplaces`
- `blogwatcher`
- `obsidian`
- `1password`
- `xurl`
- `gog` if Google Workspace is not actively needed through that path

Reason:
- possibly useful someday, but not justified as part of the core working set today

### Coding delegation tools to use very carefully
- `coding-agent`

Reason:
- powerful, but easy to misuse in this workspace
- its own description says not to use it in `~/clawd`
- should remain explicitly situational, not a default helper

## Connector / MCP audit

## Confirmed live Cortex-first connectors

Observed from `/root/.openclaw/openclaw.json`:
- `cortex-memory-bridge` enabled
- `cortex-browser-bridge` enabled
- `cortex-route-gate` enabled

Assessment:
- **keep**
- these are part of the Cortex-first architecture, not something to replace

## Recommended core connector set

Treat these as the desired core external systems of record:
- GitHub
- Google Workspace
- Home Assistant

Assessment:
- **keep core small**
- if a connector is not one of these and not tied to a live workflow, it should be situational at best

## Situational connectors

Use only when a task clearly needs them:
- Slack
- Notion
- browser-use / cloud browser fallback
- external search connectors
- direct MCP routing tools like `mcporter`

Assessment:
- **situational only**
- should not become the default path when Cortex-native browsing/search or normal tools already solve the task

## Connectors to avoid duplicating

Do not expand with extra MCP/server layers for:
- memory/RAG
- browser/search
- filesystem access
- shell execution
- process management
- lightweight web fetch

Reason:
- these are already covered by Cortex-first bridges or native tools
- duplicates create confusion, auth sprawl, and routing mistakes

## Recommended decisions

## General-core skills still missing

These are now authored so the architecture is general rather than benchmark-only:
- `clawd-task-intake-routing`
- `clawd-research-and-synthesis`
- `clawd-external-action-guardrails`
- `clawd-status-memory-handoff`

Recommendation:
- treat these as the general assistant core above the domain-specific benchmark/orchestration layer

### Keep
- all `clawd-` local skills
- Cortex bridges and route gate
- small core connector concept: GitHub, Google Workspace, Home Assistant
- a short list of global utility skills: `skill-creator`, `healthcheck`, `node-connect`, `taskflow`, `tmux`, `weather`, `video-frames`, `github`

### Enforced now
- bundled keep-close skills are allowlisted in config
- default visible skills are narrowed to the authored `clawd-` layer plus the short bundled utility set
- gateway restart verified the config is live

### Situational
- `mcporter`, `clawhub`, `oracle`, `summarize`, collaboration tools, device/media utilities, browser fallback paths

### Retire from default surface
- Apple/macOS-specific skills
- consumer/lifestyle/device skills without a current work signal
- any connector or skill that duplicates Cortex-native cognition or tool paths

## What I would do next

1. Keep the `clawd-` skill set as the default local overlay library.
2. Treat most of the global skill catalog as available but not mentally active.
3. Keep connector policy small and Cortex-first.
4. Only promote another skill or connector after repeated real use proves it belongs.
5. If desired, do a second pass that edits config or docs to reflect these active/situational/retired buckets explicitly.

## Bottom line

The right shape for us is not "more tools".
It is:
- Cortex as the brain
- a small `clawd-` procedural layer
- a tiny connector core
- everything else demoted until it earns its place
