# Mailchimp next-run go/no-go rubric, 2026-04-20

## Reply anchor
Jake asked whether the 100-agent orchestration project is worth continuing, then asked for a hard go/no-go rubric for the next run so we stop wasting time on fake progress.

## Decision
Continue only if the next serious Mailchimp run proves sustained real-code throughput.
Do not continue on the strength of verifier-only endurance, tiny bounded slices, launcher health, or supervisor green alone.

## Target run this rubric applies to
- **Repo:** `/root/clawd/mailchimp-clone`
- **Benchmark role:** B1 Mailchimp long-run stress benchmark
- **Fidelity:** `parity_for_scope`
- **Execution boundary:** VM102 execution plane only
- **Requested agent count:** `10` minimum for the proof run
- **Run duration target:** `>= 2 hours` unless a hard fail triggers earlier
- **Stop condition:** `supervisor_green_or_blocker_report`, plus the hard-fail rules below

## Count rules
Count only **real product-surface work**.

### Counts as real work
- accepted merged patches with non-empty `modifiedFiles`
- changed files on Mailchimp product surfaces such as `packages/app/` and `apps/web/`
- relevant non-skipped verifier evidence tied to those accepted diffs
- surviving repo diff against the run baseline on counted product files

### Does not count as real coding success
- verification-only shards
- merged patches with empty `modifiedFiles`
- docs-only, tests-only, scripts-only, artifacts-only, or supervisor-only diffs
- transport health, worker liveness, or notifier delivery by themselves
- a green run whose final surviving product diff is trivial

### Files excluded from product LOC accounting
- `docs/`
- `tests/`
- `scripts/`
- `artifacts/`
- `state/`
- `backups/`
- `_tmp/`
- `_logs/`

## Required prelaunch gates
If any of these fail, do not launch. Mark the run blocked instead.

1. **Executable work inventory**
   - work graph must expose at least `10` executable product shards
   - those shards must cover at least `3` unresolved focus lanes
2. **Real-file contracts**
   - each counted shard must name allowed product files/modules
   - no verification-only shard may be used to claim coding throughput
3. **Execution boundary proof**
   - launch from control plane, run on VM102
   - artifact root and run id must be bound before launch
4. **LOC accounting installed**
   - run must write a mechanical LOC accounting artifact for counted product files
   - if the run cannot tell us gross and surviving product diff, it cannot qualify as the deciding proof run

## GO thresholds
The project earns a **go / continue** only if **all** of these hold in one honest run.

1. **Sustained autonomy**
   - productive execution lasts at least `120 minutes` without human steering
2. **Real product diff volume**
   - surviving final product diff is at least `150` changed lines total (`adds + dels`) on counted product files
   - and touches at least `8` counted product files
3. **Multi-lane progress**
   - accepted product diffs land in at least `3` distinct unresolved focus lanes
4. **Actual multi-agent contribution**
   - accepted counted patches come from at least `4` distinct agent ids
5. **Throughput quality**
   - no-op rate `<= 0.20`
   - repeat-blocker rate `<= 0.15`
   - verification integrity `>= 0.95`
   - truth-integrity contradictions `0`
6. **No fake-green escape hatch**
   - no verification-only result may be reported as coding success
   - no tiny final diff may be dressed up as long-horizon coding success

## Immediate NO-GO triggers
Any one of these is enough to pause or pivot the project after the run.

- final surviving counted product diff is `< 50` changed lines
- fewer than `3` counted product files changed
- only `1` focus lane receives counted product diffs
- accepted merged patches are mostly verification-only or empty-diff
- the run stops in `< 30 minutes` without an external blocker and still tries to claim success
- supervisor/notifier language overstates what the artifacts prove
- the run cannot produce trustworthy LOC accounting for counted product files

## Immediate HARD FAIL triggers
Any one of these means stop the campaign and fix the system before another attempt.

- fake-green: supervisor green while counted product diff is trivial or absent
- stale or wrong artifact root bound to the claimed run id
- heavy local execution on the control plane
- repeated contradiction between canonical artifacts and user-facing summary
- empty executable work graph while unresolved product lanes remain

## Project continuation decision rule
- **Continue** if the next serious run meets the GO thresholds above
- **Pause and pivot** if the run is honest but misses the thresholds
- **Stop and repair first** if any hard-fail trigger appears

## Why this rubric exists
The project is only worth continuing if it proves the thing Jake actually cares about:

- agents coding productively for hours
- on a hard repo
- with real multi-file product diffs
- under honest supervision
- without fake-green reporting

Anything weaker is interesting orchestration research, but not yet a convincing long-horizon coding system.
