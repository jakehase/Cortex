# Baseline Memory/Codec Quality Report

- generated_at: 2026-04-01T23:23:03Z
- run_path: artifacts/memory_codec_quality/2026-04-01/baseline/baseline.memory_codec.json
- config: {"name": "baseline_current", "max_items_per_bucket": 8, "packet_chars": 320, "codec_globals": {}}
- case_count: 44
- overall_pass_rate: 0.341
- false_memory_rate: 0.659
- stale_memory_failure_rate: 0.114
- omission_rate: 0.045
- preference_recall_accuracy: 0.0
- open_loop_continuity_accuracy: 0.538
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- latency_ms: {"avg": 0.573, "p95_approx": 1.238, "max": 1.749}

## Category summary
- active_project_continuity: pass_rate=0.0 count=5
- codec_harmful: pass_rate=1.0 count=2
- codec_helpful: pass_rate=1.0 count=2
- cross_turn_followup: pass_rate=0.5 count=4
- explanation_memory_used: pass_rate=1.0 count=4
- false_memory_trap: pass_rate=0.0 count=4
- long_sequence_durability: pass_rate=0.0 count=4
- open_loop_continuity: pass_rate=1.0 count=5
- preference_memory: pass_rate=0.0 count=5
- preference_override: pass_rate=0.0 count=5
- stale_memory_suppression: pass_rate=0.0 count=4

## Failing cases

### pref_memory_01 — Retain reply prefix preference
- category: preference_memory
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["preference", "Start"]}, "cluster": "preference_memory::active_projects::unexpected"}, {"kind": "compression_ratio", "detail": {"observed": 0.438, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Start replies with [Cortex].
Projects: preference | Start
- state_excerpt: {"preferences": ["Start replies with [Cortex]."], "active_projects": ["preference", "Start"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_02 — Retain call-me preference
- category: preference_memory
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Call", "Jake", "preference"]}, "cluster": "preference_memory::active_projects::unexpected"}, {"kind": "compression_ratio", "detail": {"observed": 0.236, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Call me Jake.
Projects: Call | Jake | preference
- state_excerpt: {"preferences": ["Call me Jake."], "active_projects": ["Call", "Jake", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_03 — Retain concise-answer preference
- category: preference_memory
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Prefer", "preference"]}, "cluster": "preference_memory::active_projects::unexpected"}, {"kind": "compression_ratio", "detail": {"observed": 0.383, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Prefer concise answers.
Projects: Prefer | preference
- state_excerpt: {"preferences": ["Prefer concise answers."], "active_projects": ["Prefer", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_04 — Recognize begin-replies preference form
- category: preference_memory
- failures: [{"kind": "packet_missing", "detail": ["Begin replies with [Memoria]."], "cluster": "preference_memory::packet_missing"}, {"kind": "state_missing", "detail": {"bucket": "preferences", "missing": ["Begin replies with [Memoria]."]}, "cluster": "preference_memory::preferences::missing"}, {"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Begin", "Memoria", "preference"]}, "cluster": "preference_memory::active_projects::unexpected"}, {"kind": "compression_ratio", "detail": {"observed": 0.763, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Projects: Begin | Memoria | preference
- state_excerpt: {"preferences": [], "active_projects": ["Begin", "Memoria", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_memory_05 — Retain multi-part preference sentence
- category: preference_memory
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Prefer", "preference"]}, "cluster": "preference_memory::active_projects::unexpected"}, {"kind": "compression_ratio", "detail": {"observed": 0.549, "min": 1.0}, "cluster": "preference_memory::compression_ratio"}]
- packet: Prefs: Prefer short answers and begin with [Cortex].
Projects: Prefer | preference
- state_excerpt: {"preferences": ["Prefer short answers and begin with [Cortex]."], "active_projects": ["Prefer", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_override_01 — New reply prefix supersedes old prefix
- category: preference_override
- failures: [{"kind": "packet_unexpected", "detail": ["Start replies with [Cortex]."], "cluster": "preference_override::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "preferences", "present": ["Start replies with [Cortex]."]}, "cluster": "preference_override::preferences::unexpected"}]
- packet: Prefs: Start replies with [Cortex]. | Start replies with [Neural] instead.
Projects: preference | Start | Neural
- state_excerpt: {"preferences": ["Start replies with [Cortex].", "Start replies with [Neural] instead."], "active_projects": ["preference", "Start", "Neural"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_override_02 — Call-me alias supersedes old alias
- category: preference_override
- failures: [{"kind": "packet_unexpected", "detail": ["Call me Jake."], "cluster": "preference_override::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "preferences", "present": ["Call me Jake."]}, "cluster": "preference_override::preferences::unexpected"}]
- packet: Prefs: Call me Jake. | Call me J instead.
Projects: Call | Jake | preference
- state_excerpt: {"preferences": ["Call me Jake.", "Call me J instead."], "active_projects": ["Call", "Jake", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_override_03 — Detailed answer preference supersedes concise
- category: preference_override
- failures: [{"kind": "packet_unexpected", "detail": ["Prefer concise answers."], "cluster": "preference_override::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "preferences", "present": ["Prefer concise answers."]}, "cluster": "preference_override::preferences::unexpected"}]
- packet: Prefs: Prefer concise answers. | Prefer detailed answers now.
Projects: Prefer | preference
- state_excerpt: {"preferences": ["Prefer concise answers.", "Prefer detailed answers now."], "active_projects": ["Prefer", "preference"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_override_04 — Negative preference revision removes prior positive
- category: preference_override
- failures: [{"kind": "packet_unexpected", "detail": ["Start replies with [Alpha]."], "cluster": "preference_override::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "preferences", "present": ["Start replies with [Alpha]."]}, "cluster": "preference_override::preferences::unexpected"}]
- packet: Prefs: Start replies with [Alpha]. | Do not start replies with [Alpha]. Start replies with [Beta].
Projects: Alpha | preference | Start | Beta | Do
- state_excerpt: {"preferences": ["Start replies with [Alpha].", "Do not start replies with [Alpha]. Start replies with [Beta]."], "active_projects": ["Alpha", "preference", "Start", "Beta"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### pref_override_05 — Revision with correction phrasing replaces old preference
- category: preference_override
- failures: [{"kind": "packet_unexpected", "detail": ["Prefer markdown tables."], "cluster": "preference_override::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "preferences", "present": ["Prefer markdown tables."]}, "cluster": "preference_override::preferences::unexpected"}]
- packet: Prefs: Prefer markdown tables. | Correction: prefer bullet lists instead of markdown tables.
Projects: Prefer | preference | Correction
- state_excerpt: {"preferences": ["Prefer markdown tables.", "Correction: prefer bullet lists instead of markdown tables."], "active_projects": ["Prefer", "preference", "Correction"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### project_01 — Metadata project retained without preference noise
- category: active_project_continuity
- failures: [{"kind": "packet_unexpected", "detail": ["preference | Start"], "cluster": "active_project_continuity::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["preference", "Start"]}, "cluster": "active_project_continuity::active_projects::unexpected"}]
- packet: Prefs: Start replies with [Cortex].
Projects: Cortex Memory | preference | Start
- state_excerpt: {"preferences": ["Start replies with [Cortex]."], "active_projects": ["Cortex Memory", "preference", "Start"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### project_02 — Kebab-case project retained without leading-verb noise
- category: active_project_continuity
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Need", "planning"]}, "cluster": "active_project_continuity::active_projects::unexpected"}]
- packet: Projects: memory-codec-lab | Need | planning
Goals: Need to ship memory-codec-lab soon.
Open: Need to ship memory-codec-lab soon.
- state_excerpt: {"preferences": [], "active_projects": ["memory-codec-lab", "Need", "planning"], "active_goals": ["Need to ship memory-codec-lab soon."], "open_loops": ["Need to ship memory-codec-lab soon."], "durable_facts": [], "patterns": [], "lessons": []}

### project_03 — Title-case project retained without pronoun noise
- category: active_project_continuity
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["We", "planning"]}, "cluster": "active_project_continuity::active_projects::unexpected"}]
- packet: Projects: Nexus Router | planning | We
- state_excerpt: {"preferences": [], "active_projects": ["Nexus Router", "planning", "We"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### project_04 — Topic metadata retained without generic tag noise
- category: active_project_continuity
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["planning", "Need"]}, "cluster": "active_project_continuity::active_projects::unexpected"}]
- packet: Projects: Memory Supervisor | Need | planning
Open: Need to tighten memory supervisor heuristics.
- state_excerpt: {"preferences": [], "active_projects": ["Memory Supervisor", "Need", "planning"], "active_goals": [], "open_loops": ["Need to tighten memory supervisor heuristics."], "durable_facts": [], "patterns": [], "lessons": []}

### project_05 — Project persists across unrelated follow-up without new noise
- category: active_project_continuity
- failures: [{"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Thanks", "note"]}, "cluster": "active_project_continuity::active_projects::unexpected"}]
- packet: Projects: OpenClaw Bridge | note | Thanks
Goals: Build the OpenClaw Bridge retry policy.
- state_excerpt: {"preferences": [], "active_projects": ["OpenClaw Bridge", "note", "Thanks"], "active_goals": ["Build the OpenClaw Bridge retry policy."], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}

### stale_01 — Stale durable fact should not crowd out fresh preference
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Important decision: old path is default."], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Prefs: Jake prefers concise answers.
Projects: decision | Important | Need | planning | Jake | preference
Open: Need to finish old task?
Facts: Important decision: old path is default.
- state_excerpt: {"preferences": ["Jake prefers concise answers."], "active_projects": ["decision", "Important", "Need", "planning"], "active_goals": [], "open_loops": ["Need to finish old task?"], "durable_facts": ["Important decision: old path is default."], "patterns": [], "lessons": []}

### stale_02 — Stale preference should not appear ahead of fresh open loop
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Prefer markdown tables."], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Prefs: Prefer markdown tables.
Projects: Prefer | preference | Need | planning
Open: Need to finish the new benchmark summary?
- state_excerpt: {"preferences": ["Prefer markdown tables."], "active_projects": ["Prefer", "preference", "Need", "planning"], "active_goals": [], "open_loops": ["Need to finish the new benchmark summary?"], "durable_facts": [], "patterns": [], "lessons": []}

### stale_03 — Stale open loop should not appear once fresher goal arrives
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Need to fix the old scroll bug?"], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Projects: Need | planning | Verifier Loop
Goals: Build the fresh verifier loop now.
Open: Need to fix the old scroll bug?
FailurePatterns: Need to fix the old scroll bug?
- state_excerpt: {"preferences": [], "active_projects": ["Need", "planning", "Verifier Loop"], "active_goals": ["Build the fresh verifier loop now."], "open_loops": ["Need to fix the old scroll bug?"], "durable_facts": [], "patterns": ["Need to fix the old scroll bug?"], "lessons": []}

### stale_04 — Stale project should not dominate fresh fact packet
- category: stale_memory_suppression
- failures: [{"kind": "packet_unexpected", "detail": ["Legacy Bridge"], "cluster": "stale_memory_suppression::packet_unexpected"}]
- packet: Projects: Legacy Bridge | decision | Important
Goals: Build the Legacy Bridge rollout.
Facts: Important decision: use the verifier loop.
- state_excerpt: {"preferences": [], "active_projects": ["Legacy Bridge", "decision", "Important"], "active_goals": ["Build the Legacy Bridge rollout."], "open_loops": [], "durable_facts": ["Important decision: use the verifier loop."], "patterns": [], "lessons": []}

### false_memory_01 — Generic thanks should not invent a project
- category: false_memory_trap
- failures: [{"kind": "packet_unexpected", "detail": ["Projects:", "Thanks", "note"], "cluster": "false_memory_trap::packet_unexpected"}, {"kind": "state_unexpected", "detail": {"bucket": "active_projects", "present": ["Thanks", "note"]}, "cluster": "false_memory_trap::active_projects::unexpected"}]
- packet: Projects: note | Thanks
- state_excerpt: {"preferences": [], "active_projects": ["note", "Thanks"], "active_goals": [], "open_loops": [], "durable_facts": [], "patterns": [], "lessons": []}
