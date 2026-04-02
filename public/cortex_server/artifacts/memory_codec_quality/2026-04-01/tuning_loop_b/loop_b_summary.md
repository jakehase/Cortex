# Tuning Loop B Summary

- current_pass_rate: 0.886
- previous_pass_rate: 0.773
- pass_rate_delta: 0.113
- false_memory_delta: -0.113
- stale_memory_delta: -0.114
- avg_packet_chars_delta: -14.114

## Changes
- Prompt packing now ranks promoted/fresh memory above raw insertion order.
- Stale cold-memory items are suppressed by default in the packet.
- Goals/patterns are omitted by default unless needed to explain otherwise-missing fresh work.

## Remaining hotspots
- preference_memory::compression_ratio (count=45)
- stale_memory_suppression::packet_unexpected (count=14)
- preference_memory::active_projects::unexpected (count=5)
- preference_override::packet_unexpected (count=5)
- preference_override::preferences::unexpected (count=5)
- active_project_continuity::active_projects::unexpected (count=5)
- long_sequence_durability::packet_unexpected (count=5)
- false_memory_trap::packet_unexpected (count=4)
