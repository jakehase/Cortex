# Window 2 load-stability note

Broad repo suite executed while durability run 2 was active:
- `pytest -q tests` → `457 passed in 52.92s`

Interpretation:
- post-final-rerun code/config remained stable under concurrent durability run 2 load
- repeated broad repo suite pass 1: `457 passed in 54.79s`
- repeated broad repo suite pass 2: `457 passed in 56.16s`

This gives three clean broad-suite runs total in window 2 (including the earlier 52.92s pass).
- sustained broad repo suite stress pass 1: `457 passed in 56.87s`
- sustained broad repo suite stress pass 2: `457 passed in 58.84s`
- sustained broad repo suite stress pass 3: `457 passed in 66.45s`
- extended stress pass 1: `457 passed in 62.97s`
- extended stress pass 2: `457 passed in 63.98s`
- extended stress pass 3: `457 passed in 64.17s`
- extended stress pass 4: `457 passed in 72.70s`
- extended stress pass 5: `457 passed in 67.91s`
- late-window stress pass 1: `457 passed in 68.88s`
- late-window stress pass 2: `457 passed in 71.02s`
- late-window stress pass 3: `457 passed in 78.78s`
- late-window stress pass 4: `457 passed in 69.74s`
- end-of-window sweep 1: `457 passed in 54.17s`
- end-of-window sweep 2: `457 passed in 54.16s`
- end-of-window sweep 3: `457 passed in 56.59s`
- end-of-window sweep 4: `457 passed in 58.23s`
