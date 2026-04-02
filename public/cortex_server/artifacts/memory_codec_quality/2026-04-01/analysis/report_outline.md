# Final report outline draft

## Sections to fill
1. Stage checklist
2. Corpus summary
3. Baseline metrics
4. Config matrix summary
5. Triage queue summary
6. Tuning loop A changes/results
7. Tuning loop B changes/results
8. Durability run results
9. Foreground concurrent work by window
10. Final benchmark results
11. Before/after summary
12. Remaining weaknesses
13. Recommended defaults
14. Exact validation run

## Known points
- Baseline failure modes were dominated by noisy project extraction, missing preference-form coverage, lack of preference revision resolution, and stale packet retention.
- Loop A fixed phrase coverage/revisions/project filtering.
- Loop B fixed packet packing priority and stale suppression.
- Remaining misses are only the tiny single-preference compression-ratio cases in the corpus.
