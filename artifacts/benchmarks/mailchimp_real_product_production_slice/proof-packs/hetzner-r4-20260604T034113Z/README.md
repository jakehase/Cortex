# Mailchimp real product production-slice Hetzner r4 proof pack

Run: `campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4`

Terminal iteration: `campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4-iter-002`

Truth boundary: **production_slice / parity_for_scope only; not full Mailchimp 1:1 parity**.

## Result

- Persistent runner: `green`
- Completion decision: `stop_green`
- Supervisor confirmed completion: `true`
- Orchestration confirmed completion: `true`
- Parity status: `parity_for_scope`
- Matrix status: `all_complete`
- Blocker: `null`
- Sync ok: `true`

## Commits

- Product seal: `984543daa Land Mailchimp production slice product progress`
- Contract repair: `708dd2e40 Add Mailchimp production slice scope surfaces`

## Evidence roots

- Local proof files: `local/`
- Remote iter-001 captured files: `remote/campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4-iter-001/`
- Remote iter-002 captured files: `remote/campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4-iter-002/`
- Remote iter-002 artifact root: `/home/jake/clawd-remote/mailchimp-runs/campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4-iter-002/artifacts/implementation_runs/campaign-20260604-034113-mailchimp-real-product-production-slice-hetzner-r4-iter-002`

## Note

This proves the requested production-slice scope only. It must not be reported as full Mailchimp 1:1 parity.

## Quarantine notes

- Local stale r2/r3/rerun artifact quarantine manifest: `/root/clawd/_quarantine/mailchimp-stale-runs/20260604-r4-stale-r2-r3-quarantine/quarantine-manifest.json`
- Remote stale r2/r3 quarantine manifest: `/home/jake/clawd-remote/_quarantine/stale-mailchimp-runs/20260604-r4-stale-r2-r3-quarantine/remote-quarantine-manifest.json`

The local payload is intentionally in top-level `_quarantine/` because it is large and ignored by git.
