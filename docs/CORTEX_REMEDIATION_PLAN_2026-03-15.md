# Cortex Remediation Plan — 2026-03-15

## Objective
Make Cortex the clean, auditable 38-level backend in active use by OpenClaw, with all identified audit failures fixed in the live runtime.

## Fix plan

### 1) Repair canonical status coverage
- Add `/nexus/status` so L24 exists on its documented canonical path.

### 2) Repair registry/self-report consistency
- Fix Hive to report level 12 instead of level 3.
- Update Mirror to reflect the full 38-level topology and canonical routes.

### 3) Repair false Oracle degradation
- Increase local OpenClaw probe timeout in Oracle status so `openclaw_ok` reflects reality.

### 4) Repair Exoskeleton runtime access
- Include Docker tooling in the Cortex image.
- Recreate the live Cortex container with `/var/run/docker.sock` mounted so level 17 can actually reach the host daemon.

### 5) Validate post-fix runtime
- Re-run all 38 status checks.
- Re-check Cortex health, Oracle, Nexus, Mirror, Hive, and Exoskeleton specifically.
- Confirm OpenClaw is still configured to use the Cortex memory bridge.

## Execution rule
No further side work until these fixes are live and re-audited.
