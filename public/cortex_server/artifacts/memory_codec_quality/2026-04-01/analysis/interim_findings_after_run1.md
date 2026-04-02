# Interim findings after durability run 1

- The winning packet strategy held steady for the full first 30-minute durability window (1800s, 7782 corpus rounds).
- Loop A accounted for the largest gain by fixing preference revision handling and project-noise extraction.
- Loop B converted stale-memory failures from 11.4% at baseline to 0.0% in the tuned candidate.
- The only remaining benchmark misses are the five tiny preference-memory compression-ratio cases, which are a rubric/packet-overhead tradeoff rather than a continuity miss.
- Broad and focused regression suites stayed green during the concurrent durability window.
