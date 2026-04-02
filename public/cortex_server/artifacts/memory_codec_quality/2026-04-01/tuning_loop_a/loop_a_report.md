# Tuning Loop A Candidate Report

- generated_at: 2026-04-01T23:28:58Z
- run_path: artifacts/memory_codec_quality/2026-04-01/tuning_loop_a/loop_a_candidate.memory_codec.json
- config: {"name": "loop_a_candidate", "max_items_per_bucket": 8, "packet_chars": 320, "codec_globals": {}}
- case_count: 44
- overall_pass_rate: 0.773
- false_memory_rate: 0.227
- stale_memory_failure_rate: 0.114
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 0.923
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- latency_ms: {"avg": 0.637, "p95_approx": 1.175, "max": 7.39}

## Category summary
- active_project_continuity: pass_rate=1.0 count=5
- codec_harmful: pass_rate=1.0 count=2
- codec_helpful: pass_rate=1.0 count=2
- cross_turn_followup: pass_rate=1.0 count=4
- explanation_memory_used: pass_rate=1.0 count=4
- false_memory_trap: pass_rate=1.0 count=4
- long_sequence_durability: pass_rate=0.75 count=4
- open_loop_continuity: pass_rate=1.0 count=5
- preference_memory: pass_rate=0.0 count=5
- preference_override: pass_rate=1.0 count=5
- stale_memory_suppression: pass_rate=0.0 count=4

## Failing cases

### pref_memory_01 — Retain reply prefix preference
- category: preference_memory
- failures: [{"kind": "compression_ratio", "detail": {"observed": 0.8, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Start replies with [Cortex].
- state_excerpt: {"preferences": ["Start replies with [Cortex]."], "active_projects": [], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_02 — Retain call-me preference
- category: preference_memory
- failures: [{"kind": "compression_ratio", "detail": {"observed": 0.65, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Call me Jake.
- state_excerpt: {"preferences": ["Call me Jake."], "active_projects": [], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_03 — Retain concise-answer preference
- category: preference_memory
- failures: [{"kind": "compression_ratio", "detail": {"observed": 0.767, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Prefer concise answers.
- state_excerpt: {"preferences": ["Prefer concise answers."], "active_projects": [], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_04 — Recognize begin-replies preference form
- category: preference_memory
- failures: [{"kind": "compression_ratio", "detail": {"observed": 0.806, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Begin replies with [Memoria].
- state_excerpt: {"preferences": ["Begin replies with [Memoria]."], "active_projects": [], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_05 — Retain multi-part preference sentence
- category: preference_memory
- failures: [{"kind": "compression_ratio", "detail": {"observed": 0.865, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Prefer short answers and begin with [Cortex].
- state_excerpt: {"preferences": ["Prefer short answers and begin with [Cortex]."], "active_projects": [], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### stale_01 — Stale durable fact should not crowd out fresh preference
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Important decision: old path is default."], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Prefs: Jake prefers concise answers.
Open: Need to finish old task?
Facts: Important decision: old path is default.
- state_excerpt: {"preferences": ["Jake prefers concise answers."], "active_projects": [], "active_goals": [], "open_loops": ["Need to finish old task?"], "durable_facts": ["Important decision: old path is default."], "patterns": [], "lessons": []}

### stale_02 — Stale preference should not appear ahead of fresh open loop
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Prefer markdown tables."], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Prefs: Prefer markdown tables.
Open: Need to finish the new benchmark summary?
- state_excerpt: {"preferences": ["Prefer markdown tables."], "active_projects": [], "active_goals": [], "open_loops": ["Need to finish the new benchmark summary?"], "durable_facts": [], "patterns": [], "lessons": []}

### stale_03 — Stale open loop should not appear once fresher goal arrives
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Need to fix the old scroll bug?"], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Projects: Verifier Loop
Goals: Build the fresh verifier loop now.
Open: Need to fix the old scroll bug?
FailurePatterns: Need to fix the old scroll bug?
- state_excerpt: {"preferences": [], "active_projects": ["Verifier Loop"], "active_goals": ["Build the fresh verifier loop now."], "open_loops": ["Need to fix the old scroll bug?"], "durable_facts": [], "patterns": ["Need to fix the old scroll bug?"], "lessons": []}

### stale_04 — Stale project should not dominate fresh fact packet
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Legacy Bridge"], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Projects: Legacy Bridge
Goals: Build the Legacy Bridge rollout.
Facts: Important decision: use the verifier loop.
- state_excerpt: {"preferences": [], "active_projects": ["Legacy Bridge"], "active_goals": ["Build the Legacy Bridge rollout."], "open_loops": [], "durable_facts": ["Important decision: use the verifier loop."], "patterns": [], "lessons": []}

### durability_02 — Long sequence suppresses stale fact and keeps fresh loop
- category: long_sequence_durability
- failures: [{"kind": "packet_unexpected", "detail": ["legacy bridge is default."], "cluster": "long_sequence_durability::packet_unexpected"}]
- packet: Projects: Bridge Verifier
Goals: Build the Bridge Verifier now.
Open: Need to validate the fresh bridge rollback?
Facts: Important decision: legacy bridge is default.
- state_excerpt: {"preferences": [], "active_projects": ["Bridge Verifier"], "active_goals": ["Build the Bridge Verifier now."], "open_loops": ["Need to validate the fresh bridge rollback?"], "durable_facts": ["Important decision: legacy bridge is default."], "patterns": [], "lessons": []}
