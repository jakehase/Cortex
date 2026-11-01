# Cortex-Native OpenClaw Runtime Decisions

## 2026-11-01, extend OpenClaw instead of replacing it

Decision: keep OpenClaw as the hardened runtime shell and make Cortex the native cognitive lifecycle through plugins.

Reason: OpenClaw already supplies channels, authentication, sessions, transcripts, tools, approvals, scheduling, media, and delivery. Rebuilding those would add risk without improving Cortex cognition.

## 2026-11-01, extend existing Cortex plugins

Decision: `extend_existing`.

Evidence: `/tmp/cortex-harness-prior-art.json` returned `green_prior_art_gate` with required action `extend_existing_or_adapter_required`. Existing route, memory, identity, browser, learning, and completion plugins already form the canonical Cortex integration path.

Rejected alternatives:

- New standalone harness
- Parallel memory or routing primitive
- OpenClaw core fork
- Duplicating the bundled Codex or embedded executor

## 2026-11-01, bind implementation to the exact configured live source

Decision: implement in `/root/clawd/worktrees/cortex-openclaw-runtime-20261101`, created directly from live release commit `1de5218d2807f577b5dd1ec3a8d92985d084347b`.

Reason: direct inspection proved that `/root/clawd/plugins` differed from the configured plugin release. The initial stale-path adapter draft was quarantined and the root index refactor was reversed exactly before implementation continued.

## 2026-11-01, first milestone is a compatibility adapter

Decision: isolate OpenClaw hook names and event shapes behind `cortex.openclaw.compat.v1` before moving additional lifecycle ownership.

Reason: the live Cortex route gate already participates in the full cognitive lifecycle, but OpenClaw-specific assumptions are spread through direct hook callbacks. A versioned adapter provides the smallest meaningful upgrade-safe product transaction.

## 2026-11-01, preserve OpenClaw safety ownership

Decision: OpenClaw remains authoritative for tool policy, approvals, provider/model authentication, session transcript, and outbound delivery.

Reason: Cortex cognition must not silently widen external-action authority or bypass existing safety controls.
