# Parity Harness Extension Path

The parity harness in this repository is intentionally dependency-light.

What exists now:
- HTTP route/content/json/state checks
- cookie-aware form workflows
- fixture-target support for fast tests
- detailed machine-readable reports

How to extend to browser automation:
1. add a browser-backed target implementing the same target contract used by `runParityHarness`
2. map DOM assertions into `check.run(target, ctx)` steps
3. keep reports in the same artifact shape so supervisors do not care whether evidence came from HTTP or full browser automation
4. gate completion on the resulting parity report rather than on screenshots alone
