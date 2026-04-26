# Assistant Stack Inventory

This is the working source of truth for how we should organize skills and MCP servers in this workspace.

Current audit artifact:
- `/root/clawd/docs/assistant-stack-audit-2026-04-16.md`

## Why this exists

Our actual work is not generic assistant work. The repeating pattern is:
- long-run orchestration and benchmark design
- benchmark failure triage and artifact forensics
- Mailchimp parity and control-plane truth work
- brownfield transfer benchmarks like PMHNP
- repo hygiene, quarantine, and execution-boundary decisions
- occasional personal ops across GitHub, Google Workspace, and Home Assistant

That means we get more leverage from a small set of strong reusable skills than from piling on more servers.

Important correction:
- this stack plan is meant to be **general**, not just a benchmark/orchestration playbook
- benchmark and orchestration skills were authored first because they were the hottest recent repetition cluster
- they are the **first domain slice**, not the whole assistant architecture

## Decisions

- Organize **skills first**, then prune MCP servers.
- Keep **core MCPs to 3 to 5 max**.
- Do **not** add MCP servers that duplicate native tools we already have, especially file IO, shell, browser, memory, and lightweight web fetch.
- Treat MCPs as **system connectors**, not as a replacement for workflows.
- Treat skills as **repeatable operating procedures** for work we already do often.
- Default every new skill or MCP to **proposed**, not permanent. It has to earn its slot.

## Cortex compatibility rules

This plan has to support Cortex, not compete with it.

- Cortex remains the primary layer for reasoning, memory, browsing, routing, and user-facing identity.
- Local skills should add **procedure**, **guardrails**, and **workspace-specific operating knowledge**, not a second brain.
- Local MCP servers should add **connectivity to external systems**, not alternate memory/search/browser stacks.
- Avoid new local skill names that pretend to be platform capabilities, especially names like `memory`, `browser`, `planner`, `router`, `oracle`, `research`, or `cortex`.
- Avoid MCPs that try to supersede Cortex-first paths for browser, memory, search, or lightweight web access.
- Namespace local skills with a workspace prefix so they are clearly subordinate helpers, not peer system layers.

### Local naming rule

Use the prefix `clawd-` for workspace-authored skills.

Reason:
- avoids collisions with built-in skills
- avoids collisions with future Cortex/system concepts
- makes it obvious these are local operating overlays, not core cognition

## What counts as a skill vs an MCP

Use a **skill** when the value is mostly:
- judgment
- sequencing
- artifact interpretation
- repo-specific workflow
- honesty rules and reporting shape
- reusable checklists and bundled scripts

Use an **MCP server** when the value is mostly:
- access to an external system
- authenticated API calls
- live state outside the workspace
- actions on systems of record

## Recommended skill taxonomy

## General foundation, should exist regardless of domain

These are the general-purpose skills the overall stack should center on over time.

### G0, universal core

#### 1. `clawd-task-intake-routing`
Use for:
- turning vague asks into the right action surface
- deciding between chat-only, internal workspace action, external read, and external write
- keeping Cortex-first routing consistent across domains

Status:
- **authored** at `/root/clawd/skills/clawd-task-intake-routing/`

#### 2. `clawd-research-and-synthesis`
Use for:
- current-info research
- source comparison
- separating observed facts from inference
- concise answer shaping after research

Status:
- **authored** at `/root/clawd/skills/clawd-research-and-synthesis/`

#### 3. `clawd-external-action-guardrails`
Use for:
- deciding when approval is needed
- distinguishing drafts from sends
- preventing accidental outbound actions
- keeping external actions deliberate

Status:
- **authored** at `/root/clawd/skills/clawd-external-action-guardrails/`

#### 4. `clawd-status-memory-handoff`
Use for:
- updating memory after meaningful work
- turning work artifacts into durable summaries
- handing off ongoing work cleanly across sessions

Status:
- **authored** at `/root/clawd/skills/clawd-status-memory-handoff/`

These are broader than any single project area and should eventually sit above domain-specific skills.

### P0, author first

This current authored wave is domain-specific and benchmark-heavy because that was the most repeated active workstream.
It should be understood as one important cluster inside a more general assistant stack.

#### 1. `clawd-benchmark-orchestration`
Use for:
- bootstrapping benchmark contracts
- surface matrices
- threshold evaluation
- scoreboard and artifact interpretation
- benchmark rerun discipline

Why first:
- this is the most repeated workflow in recent conversations
- it touches PMHNP, Mailchimp, and the shared stack

Should include:
- contract checklist
- stop condition rules
- fake-green detection rules
- verifier evidence rules
- references to benchmark artifact files and common commands

Status:
- **authored** at `/root/clawd/skills/clawd-benchmark-orchestration/`

#### 2. `clawd-benchmark-incident-audit`
Use for:
- “why did this run fail?”
- failed orchestrator reruns
- shard loss / lease churn / verifier failures
- artifact-root based root-cause analysis

Why first:
- we keep doing this live
- it is a distinct workflow from normal benchmark authoring

Should include:
- failure family classification
- artifact inspection order
- blocker report template
- rules for separating observed facts from inference

#### 3. `clawd-campaign-truth-audit`
Use for:
- separating mechanical green from real completion
- parity ceiling vs orchestration truth
- notifier/supervisor honesty checks
- completion claim audits

Why first:
- truth discipline is a stable priority across conversations
- we repeatedly need the same claim-control lens

Should include:
- claim ladder
- contradiction checklist
- fake-green rules
- parity-for-scope vs full-clone wording guardrails

#### 4. `clawd-remote-execution-boundary`
Use for:
- deciding when a task must leave the control plane
- remote worker sync validation
- launcher/supervisor/notifier placement
- “stop local and write blocker” decisions

Why first:
- this is a standing rule for the 100-agent workstream
- it prevents expensive local misfires

Should include:
- control-plane vs execution-plane rules
- remote sync checklist
- failure escalation rules
- evidence needed before launch

### P1, author next

#### 5. `clawd-brownfield-transfer-benchmark`
Use for:
- selecting a transfer repo
- building low-overlap surfaces
- choosing baseline vs orchestrator verification
- adapting the benchmark pattern to non-Mailchimp repos

#### 6. `clawd-workspace-quarantine`
Use for:
- selecting the active repo/path
- moving stale runtimes and scratch outputs into `_quarantine/`
- recording what moved and why

#### 7. `clawd-git-auth-and-export-recovery`
Use for:
- repeated git auth / push failures
- backup/export sync repair
- distinguishing local-save success from remote-sync failure

#### 8. `clawd-personal-ops-routing`
Use for:
- deciding whether something belongs in Google Workspace, Home Assistant, or chat only
- batching routine checks without adding clutter

### P2, only if repetition proves it

- `clawd-mailchimp-parity-surface-audit`
- `clawd-pmhnp-functional-scenarios`
- `clawd-home-assistant-routines`
- `clawd-calendar-inbox-triage`

These are worth creating only if the generic P0/P1 skills are not enough.

## Current authored skills

Authored now under `/root/clawd/skills/`:
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

These are intended as Cortex-compatible local overlays, not parallel cognition.

## Enforced default working set

Applied live in `/root/.openclaw/openclaw.json`:
- `skills.allowBundled` now restricts bundled skills to:
  - `github`
  - `healthcheck`
  - `node-connect`
  - `skill-creator`
  - `taskflow`
  - `taskflow-inbox-triage`
  - `tmux`
  - `video-frames`
  - `weather`
- `agents.defaults.skills` now restricts visible default skills to:
  - all current local `clawd-` skills
  - the bundled keep-close set above

Observed after apply:
- gateway restarted cleanly against the updated config
- the `clawd-` skills show as `ready` in `openclaw skills list`

Interpretation:
- this is now a real default-surface prune, not just a doc preference
- situational skills can still be revisited later, but they are no longer part of the default visible set

## Recommended MCP tiers

## Core, keep enabled by default

### 1. GitHub
Reason:
- high leverage for repo, issue, PR, and CI state
- external system of record
- not well replaced by local shell alone when collaboration or PR metadata matters

### 2. Google Workspace
Reason:
- covers email, calendar, docs, drive
- broad day-to-day value
- strong fit for a personal assistant role

### 3. Home Assistant
Reason:
- already part of the environment
- useful daily, not just occasionally
- real external state and action surface

## Situational, enable when needed

### Browser-use / cloud browser
Reason:
- useful fallback when the native browser path is not enough
- not core because Cortex already has strong browser capability

### Slack
Reason:
- useful if we are actively operating in Slack
- not enough evidence yet to keep always-on

### Notion
Reason:
- valuable if it is an active source of truth
- otherwise just more surface area and auth burden

### Tavily or other external search connectors
Reason:
- useful as fallback or research enhancement
- not core because Cortex browse plus web fetch already cover a lot

## Experimental, keep quarantined

- generic MCP routers/callers
- marketplace/discovery tools
- repo-local ad hoc MCP servers
- any connector without a clear repeated use case

Rule:
- experimental servers should be off by default and reviewed after real use

## MCPs we should avoid or demote

Avoid dedicated MCPs for capabilities already covered well by native tools here:
- filesystem browsing
- shell execution
- process management
- basic web fetch
- generic browser automation when Cortex browser is enough
- memory/RAG lookup

Adding duplicates here mostly increases noise, auth sprawl, and tool selection mistakes.

## Recommended rollout order

### Step 1
Author these two skills first:
- `clawd-benchmark-orchestration`
- `clawd-benchmark-incident-audit`

### Step 2
Author:
- `clawd-campaign-truth-audit`
- `clawd-remote-execution-boundary`

Current state:
- all planned P0 and P1 skills are now authored
- the next work is not more skill creation by default, it is audit, pruning, and refinement from real use

### Step 3
Audit all currently installed skills and mark each as:
- keep
- situational
- retire
- replace with native tool

### Step 4
Audit MCP servers and split them into:
- core
- situational
- experimental

### Step 5
Disable or stop auto-loading anything outside core unless a task explicitly calls for it.

## What I think is best for us right now

If we do only a few things, the best near-term stack is:
- a small **general-purpose assistant core**
- a small **benchmark and orchestration skill library**
- **GitHub + Google Workspace + Home Assistant** as the default MCP core
- browser/search extras kept **situational**
- no new duplicate infra MCPs

And all of that should stay **Cortex-first**:
- Cortex does the thinking and routing
- local skills provide sharp reusable procedures
- MCPs connect systems of record without trying to replace Cortex-native paths

Near-term interpretation:
- current authored local skills now include both a **general assistant core** and a strong **domain slice**
- the next expansion should favor **general assistant primitives**, not more benchmark-only specialization by default

That setup matches the work we actually do and keeps the control surface small.

## Important note

Right now this document is the organizational source of truth. It does **not** claim that local workspace skills are automatically wired into the OpenClaw loader yet. We should treat this as the plan and inventory first, then author the highest-value skills deliberately.

Audit status:
- completed once on 2026-04-16 against live on-disk skills, the current OpenClaw config, and a best-effort MCP/config search
- use the audit artifact above for keep/situational/retire buckets
