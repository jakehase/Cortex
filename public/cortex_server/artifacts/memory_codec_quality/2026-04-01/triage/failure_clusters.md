# Memory/Codec Failure Clusters

- generated_at: 2026-04-01T23:28:38Z
- cluster_count: 20

## Clusters

### preference_memory::compression_ratio
- label: preference_memory
- failure_kind: compression_ratio
- count: 45
- runs: baseline_current, cfg_balanced_280, cfg_balanced_320, cfg_balanced_roomy, cfg_compact_220, cfg_goals_patterns_on, cfg_legacy_roomy, cfg_no_promotion, cfg_stale_allowed
- case_ids: pref_memory_01, pref_memory_02, pref_memory_03, pref_memory_04, pref_memory_05
  - example: baseline_current / pref_memory_01 / {"observed": 0.438, "min": 1.0}
  - example: baseline_current / pref_memory_02 / {"observed": 0.236, "min": 1.0}
  - example: baseline_current / pref_memory_03 / {"observed": 0.383, "min": 1.0}

### stale_memory_suppression::packet_unexpected
- label: stale_memory_suppression
- failure_kind: packet_unexpected
- count: 14
- runs: baseline_current, cfg_goals_patterns_on, cfg_legacy_roomy, cfg_stale_allowed
- case_ids: stale_01, stale_02, stale_03, stale_04
  - example: baseline_current / stale_01 / ["Important decision: old path is default."]
  - example: baseline_current / stale_02 / ["Prefer markdown tables."]
  - example: baseline_current / stale_03 / ["Need to fix the old scroll bug?"]

### preference_memory::active_projects::unexpected
- label: preference_memory
- failure_kind: state_unexpected
- count: 5
- runs: baseline_current
- case_ids: pref_memory_01, pref_memory_02, pref_memory_03, pref_memory_04, pref_memory_05
  - example: baseline_current / pref_memory_01 / {"bucket": "active_projects", "present": ["preference", "Start"]}
  - example: baseline_current / pref_memory_02 / {"bucket": "active_projects", "present": ["Call", "Jake", "preference"]}
  - example: baseline_current / pref_memory_03 / {"bucket": "active_projects", "present": ["Prefer", "preference"]}

### preference_override::packet_unexpected
- label: preference_override
- failure_kind: packet_unexpected
- count: 5
- runs: baseline_current
- case_ids: pref_override_01, pref_override_02, pref_override_03, pref_override_04, pref_override_05
  - example: baseline_current / pref_override_01 / ["Start replies with [Cortex]."]
  - example: baseline_current / pref_override_02 / ["Call me Jake."]
  - example: baseline_current / pref_override_03 / ["Prefer concise answers."]

### preference_override::preferences::unexpected
- label: preference_override
- failure_kind: state_unexpected
- count: 5
- runs: baseline_current
- case_ids: pref_override_01, pref_override_02, pref_override_03, pref_override_04, pref_override_05
  - example: baseline_current / pref_override_01 / {"bucket": "preferences", "present": ["Start replies with [Cortex]."]}
  - example: baseline_current / pref_override_02 / {"bucket": "preferences", "present": ["Call me Jake."]}
  - example: baseline_current / pref_override_03 / {"bucket": "preferences", "present": ["Prefer concise answers."]}

### active_project_continuity::active_projects::unexpected
- label: active_project_continuity
- failure_kind: state_unexpected
- count: 5
- runs: baseline_current
- case_ids: project_01, project_02, project_03, project_04, project_05
  - example: baseline_current / project_01 / {"bucket": "active_projects", "present": ["preference", "Start"]}
  - example: baseline_current / project_02 / {"bucket": "active_projects", "present": ["Need", "planning"]}
  - example: baseline_current / project_03 / {"bucket": "active_projects", "present": ["We", "planning"]}

### long_sequence_durability::packet_unexpected
- label: long_sequence_durability
- failure_kind: packet_unexpected
- count: 5
- runs: baseline_current, cfg_legacy_roomy, cfg_stale_allowed
- case_ids: durability_01, durability_02, durability_03
  - example: baseline_current / durability_01 / ["Start replies with [Cortex]."]
  - example: baseline_current / durability_02 / ["legacy bridge is default."]
  - example: baseline_current / durability_03 / ["Call me Jake."]

### false_memory_trap::packet_unexpected
- label: false_memory_trap
- failure_kind: packet_unexpected
- count: 4
- runs: baseline_current
- case_ids: false_memory_01, false_memory_02, false_memory_03, false_memory_04
  - example: baseline_current / false_memory_01 / ["Projects:", "Thanks", "note"]
  - example: baseline_current / false_memory_02 / ["Projects:", "We", "planning"]
  - example: baseline_current / false_memory_03 / ["Actually | feedback"]

### false_memory_trap::active_projects::unexpected
- label: false_memory_trap
- failure_kind: state_unexpected
- count: 4
- runs: baseline_current
- case_ids: false_memory_01, false_memory_02, false_memory_03, false_memory_04
  - example: baseline_current / false_memory_01 / {"bucket": "active_projects", "present": ["Thanks", "note"]}
  - example: baseline_current / false_memory_02 / {"bucket": "active_projects", "present": ["We", "planning"]}
  - example: baseline_current / false_memory_03 / {"bucket": "active_projects", "present": ["Actually", "feedback"]}

### long_sequence_durability::preferences::unexpected
- label: long_sequence_durability
- failure_kind: state_unexpected
- count: 2
- runs: baseline_current
- case_ids: durability_01, durability_03
  - example: baseline_current / durability_01 / {"bucket": "preferences", "present": ["Start replies with [Cortex]."]}
  - example: baseline_current / durability_03 / {"bucket": "preferences", "present": ["Call me Jake."]}

### long_sequence_durability::active_projects::unexpected
- label: long_sequence_durability
- failure_kind: state_unexpected
- count: 2
- runs: baseline_current
- case_ids: durability_01, durability_04
  - example: baseline_current / durability_01 / {"bucket": "active_projects", "present": ["Start", "preference"]}
  - example: baseline_current / durability_04 / {"bucket": "active_projects", "present": ["Actually", "feedback"]}

### long_sequence_durability::packet_missing
- label: long_sequence_durability
- failure_kind: packet_missing
- count: 2
- runs: cfg_compact_220
- case_ids: durability_01, durability_04
  - example: cfg_compact_220 / durability_01 / ["Memory Codec Lab"]
  - example: cfg_compact_220 / durability_04 / ["Runtime Watcher"]

### preference_memory::packet_missing
- label: preference_memory
- failure_kind: packet_missing
- count: 1
- runs: baseline_current
- case_ids: pref_memory_04
  - example: baseline_current / pref_memory_04 / ["Begin replies with [Memoria]."]

### preference_memory::preferences::missing
- label: preference_memory
- failure_kind: state_missing
- count: 1
- runs: baseline_current
- case_ids: pref_memory_04
  - example: baseline_current / pref_memory_04 / {"bucket": "preferences", "missing": ["Begin replies with [Memoria]."]}

### active_project_continuity::packet_unexpected
- label: active_project_continuity
- failure_kind: packet_unexpected
- count: 1
- runs: baseline_current
- case_ids: project_01
  - example: baseline_current / project_01 / ["preference | Start"]

### false_memory_trap::preferences::missing
- label: false_memory_trap
- failure_kind: state_missing
- count: 1
- runs: baseline_current
- case_ids: false_memory_04
  - example: baseline_current / false_memory_04 / {"bucket": "preferences", "missing": ["Begin replies with [Memoria]."]}

### cross_turn_followup::packet_unexpected
- label: cross_turn_followup
- failure_kind: packet_unexpected
- count: 1
- runs: baseline_current
- case_ids: followup_03
  - example: baseline_current / followup_03 / ["Prefer concise answers."]

### cross_turn_followup::preferences::unexpected
- label: cross_turn_followup
- failure_kind: state_unexpected
- count: 1
- runs: baseline_current
- case_ids: followup_03
  - example: baseline_current / followup_03 / {"bucket": "preferences", "present": ["Prefer concise answers."]}

### cross_turn_followup::active_projects::unexpected
- label: cross_turn_followup
- failure_kind: state_unexpected
- count: 1
- runs: baseline_current
- case_ids: followup_04
  - example: baseline_current / followup_04 / {"bucket": "active_projects", "present": ["Thanks", "note"]}

### stale_memory_suppression::packet_missing
- label: stale_memory_suppression
- failure_kind: packet_missing
- count: 1
- runs: cfg_stale_allowed
- case_ids: stale_03
  - example: cfg_stale_allowed / stale_03 / ["Build the fresh verifier loop now."]
