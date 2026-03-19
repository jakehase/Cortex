# Cortex Smartness Automation (2026-02-19)

Implemented automatic intelligence upgrades (no manual activation required):

1. **Routing autotune loop** (`modules/routing_autotune.py`)
   - Tracks route quality and L9 utilization
   - Auto-adjusts thresholds:
     - `complexity_hard_threshold`
     - `l9_auto_activation_threshold`
     - `fastlane_escalation_threshold`

2. **Automatic second-pass repair for marginal fastlane answers**
   - Triggered when constraints are missing / answers are short / confidence is marginal
   - Re-verifies and keeps repaired answer only when confidence improves

3. **Automatic L9 activation policy**
   - Explicit architecture chain: `l9_chain_forced`
   - Complexity-driven L9 injection: `l9_complexity`
   - Coding chain now marks L9 activation metadata consistently

4. **Micro-retrieval reranking**
   - Source trust + lexical relevance + freshness scoring

5. **Automatic nightly intelligence checks**
   - Script: `scripts/nightly_intelligence_checks.sh`
   - Runs enforced replay + extended replay and appends summary to:
     - `docs/NIGHTLY_INTELLIGENCE_LOG.md`

6. **Autotune status endpoint**
   - `GET /nexus/autotune/status`
