# Cortex security/policy candidate migration

This runbook deploys source commit contents only. It does not authorize this repair worker to change live units, credentials, or processes.

## Preconditions

- Build an immutable release from the committed candidate and point `/opt/cortex/current` at it only through the normal release process.
- Capture current unit files, enabled state, ownership/modes for `/var/lib/cortex`, `/var/log/cortex`, the current graph/L22 SQLite files and sidecars, and the three OpenClaw policy files, plus the current release pointer.
- Verify through the existing credential-safe operational check that the Oracle agent resolves to the PMHNP OAuth account approved September 25, 2026. Do not print or copy tokens.
- Confirm these existing paths before installing the helper unit:
  - `/root/.openclaw/openclaw.json`
  - `/opt/openclaw-preastra-restore/2026.7.1-2/state/agents/main/agent/openclaw-agent.sqlite`
  - `/var/lib/cortex-oracle`
  - `/root/clawd/deploy/oracle-workspace-lite`

## Staged deployment

1. Create a locked, non-login `cortex` system user/group if absent. Its home is `/var/lib/cortex`; it receives no supplementary groups.
2. Generate one random helper token with at least 32 bytes of entropy without displaying it. Store only `ORACLE_BRIDGE_TOKEN=<value>` in `/etc/cortex/oracle-helper.env`, owned `root:root`, mode `0600`. The system manager injects the value into both services before dropping API privileges; do not add the token to `cortex.env`, source, logs, or shell history.
3. Install `ops/systemd/cortex-oracle-executor.service` and the revised `ops/systemd/cortex.service` into the staged unit directory. Run `systemd-analyze verify` against the staged files before copying them into `/etc/systemd/system`.
4. Stop and disable the legacy/ad-hoc Oracle listener that owns `127.0.0.1:18999`; record its prior enabled/running state for rollback. Do not run both executors on the same address.
5. Before stopping the prior runtime, validate the immutable `ops/config/oracle-openclaw.json` policy and run the credential-safe `openclaw models status --agent oracle --json` preflight against that config; require healthy OpenAI OAuth resolved from the exact main-agent store mounted by the helper. Bind the effective profile ID back to that SQLite store and persist only provider/type metadata plus one-way email and account-ID digests—never the account label, command output, or credential values. Install and start `cortex-oracle-executor.service`. From a root-only shell that sources the protected environment file, query its authenticated `/health` endpoint. That endpoint repeats config and OAuth readiness from inside the restricted helper mount namespace. Require model `gpt-5.6-sol`, reasoning `xhigh`, auth policy `pmhnp_oauth_approved_2026-09-25`, service-tier policy `provider_default_no_override`, state policy `service_owned_with_mounted_main_oauth`, config policy `dedicated_immutable_oracle_only`, the approved config digest, and a green runtime preflight.
6. Stop the API and copy, without printing content, the existing graph and L22 SQLite databases (including any live WAL/SHM state via the approved SQLite-safe migration procedure) to `/var/lib/cortex/knowledge/cortex_graph.db` and `/var/lib/cortex/state/l22-structured.db`. Update `CORTEX_DB_PATH` and `CORTEX_L22_STRUCTURED_DB` in the protected `cortex.env` to those paths. Preserve the old files read-only for rollback; do not move or delete them in this deployment.
7. Make the Cortex database/state/log trees writable by `cortex:cortex` while preserving modes and captured ownership metadata for rollback. Validate `cortex.env` against `ops/config/cortex-env.schema.json`, start the revised `cortex.service`, and confirm its effective properties show `User=cortex`, empty capability/ambient sets, `ProtectHome=yes`, and no `/opt/clawdbot` write path.
8. Merge `deploy/openclaw-policy/USER.md`, `TOOLS.md`, and `MEMORY.md` into the live files according to `deploy/openclaw-policy/README.md`. Preserve unrelated content and backups. Confirm the personal-OAuth, `ultra`, and forced Fast/priority rules appear only as superseded history.
9. Use the existing signed-principal Oracle probe to make one bounded request. Require a provider-bound completion receipt for `gpt-5.6-sol`; do not log authorization headers or credential material. Also confirm safe mode/external-write restrictions remain enabled.
10. Promote only after the immutable release manifest, unit hashes, and focused receipt all identify the candidate commit.

## Rollback

1. Stop `cortex.service` and `cortex-oracle-executor.service`.
2. Restore the captured prior Cortex unit, release pointer, `CORTEX_DB_PATH`/`CORTEX_L22_STRUCTURED_DB` values, state/log ownership, and the three policy-file backups. Reopen the preserved old databases rather than copying a post-rollback writer over them.
3. Restore the legacy Oracle listener's captured enabled/running state.
4. Remove or quarantine `/etc/cortex/oracle-helper.env` using the credential-handling procedure; never copy its value into the rollback report. The `/var/lib/cortex-oracle/openclaw-state` tree contains helper lifecycle/session state but no copied OAuth store; the writable OAuth bind disappears when the unit stops.
5. Reload systemd, start the prior services, and run the prior release's bounded readiness check. A rollback is not complete until unit state and release hashes match the captured baseline.

## Residual risks

- The helper still runs with UID 0 because the approved OpenClaw OAuth/profile state is root-owned. Its capabilities are empty, its own OpenClaw state lives under `/var/lib/cortex-oracle`, and the shared restored OpenClaw state tree is hidden after mounting the one provider-profile directory. UID separation would require a separately approved credential migration.
- The helper needs provider egress. The Cortex API also retains network access for existing browser, Home Assistant, Redis, Ollama-tunnel, and internal Cortex workflows; this source change does not add an application-layer destination allowlist.
- OpenClaw currently resolves the Oracle agent's approved OAuth through the main-agent fallback store. A writable bind includes only that main-agent profile directory (not main-agent sessions or the shared global state) so atomic OAuth refresh remains coherent with the gateway. Compromise of the helper could alter that profile; response authentication and the narrow mount namespace reduce but do not eliminate that risk.
- Attachments remain readable tool/model inputs for requested image and document workflows. The route gate treats their contents as untrusted, blocks attachment-driven external-write tools without user-text authorization, and preserves safe-mode gates, but parser vulnerabilities and model prompt injection remain possible.
- Worker preflight proves authenticated-session presence, not the human identity of the OAuth account. Deployment must verify the approved PMHNP account through the existing credential-safe control-plane procedure.
