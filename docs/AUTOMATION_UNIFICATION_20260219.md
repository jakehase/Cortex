# Automation Unification (2026-02-19)

Goal: ensure autonomous/control-plane features are not duplicated across conflicting scripts, and consolidate into one canonical automation path.

## Canonical controller
- `scripts/auto_ops.sh` is now the single source of operational automation truth.
- Tasks consolidated:
  - `health_guard`
  - `hud_guard`
  - `backup`
  - `ci_gate`
  - `route_sanity`
  - `state_audit`
  - `housekeeping`

## Legacy overlap merged
Previously overlapping scripts were converted to wrappers that delegate to canonical automation:
- `/opt/clawdbot/cortex_health_check.sh` -> `scripts/auto_ops.sh health_guard`
- `/opt/clawdbot/cortex_server/cortex_hud_health.sh` -> `scripts/auto_ops.sh hud_guard`

This avoids drift and keeps behavior unified.

## Cron unification
Active crontab now points to canonical `auto_ops.sh` tasks (+ nightly replay checks):
- health guard every 2m
- HUD guard every 5m
- backup daily
- nightly replay checks
- CI + route sanity nightly
- housekeeping daily
- weekly lock refresh
- @reboot bootstrap + @reboot run_all

## Route sanity coverage expanded
`auto_ops.sh route_sanity` now validates all key auto-activation groups:
- brainstorm, coding, incident, research, architecture
- translation, scheduling, mediation, forecast
- training, ethics
- complexity-driven L9 activation

## Persistence checks
Validated after force-recreate:
- health endpoint healthy
- auto_ops cron entries still present
- legacy wrappers still executable
- route_sanity still passing
