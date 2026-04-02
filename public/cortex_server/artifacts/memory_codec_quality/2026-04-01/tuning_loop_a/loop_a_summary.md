# Tuning Loop A Summary

- current_pass_rate: 0.773
- previous_pass_rate: 0.341
- pass_rate_delta: 0.432
- false_memory_delta: -0.432
- stale_memory_delta: 0.0
- avg_packet_chars_delta: -30.932

## Changes
- Preference phrases expanded to recognize begin replies with and similar reply-prefix forms.
- Preference claims now use revision resolution so newer preference statements replace older ones.
- Project extraction now rejects generic tags and sentence-leading verb noise unless metadata or a strong project token supports the candidate.

## Remaining hotspots
- preference_memory::compression_ratio (count=45)
- stale_memory_suppression::packet_unexpected (count=14)
- preference_memory::active_projects::unexpected (count=5)
- preference_override::packet_unexpected (count=5)
- preference_override::preferences::unexpected (count=5)
- active_project_continuity::active_projects::unexpected (count=5)
- long_sequence_durability::packet_unexpected (count=5)
- false_memory_trap::packet_unexpected (count=4)
