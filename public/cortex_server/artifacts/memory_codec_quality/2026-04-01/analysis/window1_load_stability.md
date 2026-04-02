# Window 1 load-stability note

Broad repo suite was executed twice while durability run 1 was active.

- first broad pass: `457 passed in 67.35s`
- second broad pass: `457 passed in 67.43s`

Interpretation:
- the loop A/B codec changes remained stable under concurrent corpus-durability load
- no flaky regressions were observed across the repeated broad test passes
- tail-of-window focused validation rerun: 88 passed in 5.77s
