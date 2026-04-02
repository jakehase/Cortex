# Final Memory/Codec Rerun Report

- generated_at: 2026-04-02T00:03:05Z
- run_path: artifacts/memory_codec_quality/2026-04-01/final/final.memory_codec.json
- config: {"name": "cfg_balanced_roomy", "max_items_per_bucket": 8, "packet_chars": 420, "codec_globals": {"CODEC_PACKET_MAX_ITEMS_PER_BUCKET": 2, "CODEC_PACKET_INCLUDE_STALE": false, "CODEC_PACKET_USE_PROMOTION": true, "CODEC_PACKET_INCLUDE_GOALS": false, "CODEC_PACKET_INCLUDE_PATTERNS": false}}
- case_count: 44
- overall_pass_rate: 0.886
- false_memory_rate: 0.114
- stale_memory_failure_rate: 0.0
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 1.0
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- latency_ms: {"avg": 0.579, "p95_approx": 1.238, "max": 1.744}

## Category summary
- active_project_continuity: pass_rate=1.0 count=5
- codec_harmful: pass_rate=1.0 count=2
- codec_helpful: pass_rate=1.0 count=2
- cross_turn_followup: pass_rate=1.0 count=4
- explanation_memory_used: pass_rate=1.0 count=4
- false_memory_trap: pass_rate=1.0 count=4
- long_sequence_durability: pass_rate=1.0 count=4
- open_loop_continuity: pass_rate=1.0 count=5
- preference_memory: pass_rate=0.0 count=5
- preference_override: pass_rate=1.0 count=5
- stale_memory_suppression: pass_rate=1.0 count=4

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
