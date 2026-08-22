# Autopilot Status Command

Canonical quick-status command:

```bash
/opt/clawdbot/scripts/autopilot_status.sh
```

Machine-readable form:

```bash
/opt/clawdbot/scripts/autopilot_status.sh --json
```

## One-line output example

`AUTOPILOT_STATUS GREEN | health=ok cron=ok route=ok:0h backup=ok:0h ci=ok:0h nightly=ok:0h`

## What it checks
- API health
- Cron integrity for automation jobs
- Route-sanity pass + freshness
- Backup freshness + checksum presence
- CI pass freshness
- Nightly intelligence check freshness/pass

## Status meaning
- **GREEN**: all core checks healthy
- **YELLOW**: non-critical warning(s)
- **RED**: critical issue(s) (health/cron/route-sanity)
