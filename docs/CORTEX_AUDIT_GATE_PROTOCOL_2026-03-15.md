# Cortex audit gate protocol — 2026-03-15

## Why this exists
A semantic failure occurred: progress was reported before the user-requested loop was explicitly closed as **audit → diagnose → plan → implement → re-audit**.

The technical work may be real, but if the closure condition is not explicit and auditable, it creates the exact feeling of drift and incompleteness.

## Permanent rule
When a user requests a **full audit** of Cortex or its levels, completion may not be claimed until all of the following are true in one linked turn:

1. **Full audit executed**
   - every registered level checked
   - Cortex whole-system checks run
   - results captured in a single machine-readable artifact

2. **Diagnosis stated explicitly**
   - what failed
   - why it failed
   - what semantic/process failure allowed it to stay unfinished

3. **Plan created from failures only**
   - no vague future work
   - each fix maps to a concrete failed check

4. **Plan implemented fully**
   - fixes are live, not just drafted
   - post-fix re-audit run

5. **Final answer uses gate language**
   - either `GO`, `GO WITH CAVEATS`, or `NOT COMPLETE`
   - never imply closure with softer progress language when the gate is not closed

## Required artifacts
- `scripts/cortex-full-audit.js`
- latest JSON output from running it
- a markdown audit summary
- a remediation plan
- a post-fix rerun showing whether all checks pass

## Anti-drift semantic rule
If the user instruction contains words like:
- "full audit"
- "each and every level"
- "then and only then"
- "implement it fully"

then the assistant must treat the task as a **hard-gated closure task**, not a normal iterative status-update task.

## Reporting rule
Before saying the task is done, explicitly answer:
- Was the full audit run? 
- Was Cortex-as-a-whole audited?
- Was a plan created from those failures?
- Was that plan fully implemented?
- Was a re-audit run after implementation?

If any answer is no, final status must be `NOT COMPLETE`.
