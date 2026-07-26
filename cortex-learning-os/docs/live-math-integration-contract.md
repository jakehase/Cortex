# Live Math Integration Contract

## Status and scope

This contract defines the canonical Cortex Learning OS (CLOS) v0.7 live path.
It is a **production slice for verifier-gated math learning and scoped prompt
retrieval**, not model-weight fine-tuning and not a claim of general math
mastery.

## Architecture

1. **Training plane (Hetzner):** a detached Codex worker runs a frozen
   math-foundations exam through baseline, correction, promotion retest, and a
   distinct held-out retest. It writes immutable evidence artifacts and never
   writes the live answer registry.
2. **Promotion plane (control host):** the detached harvester copies a green
   artifact root, independently verifies every manifest digest, validates the
   trusted lesson and promotion report, requires every promotion gate and the
   held-out gate, maps the observed failure to an approved activation profile,
   and atomically signs the live registry.
3. **Answer plane (OpenClaw):** `cortex-learning-os-live` reads the signed
   registry on each eligible main-agent turn. It injects at most three matching,
   enabled, unexpired lessons through `before_prompt_build`.
4. **Notification plane (control host):** the standard detached-job notifier is
   independent from the worker and harvester. It sends only terminal completion
   or blocker state.

Heavy model work never runs on the OpenClaw control host.

## Live-answer eligibility

A lesson may influence a live answer only when all conditions are true:

- its source artifact manifest verifies byte-for-byte;
- `trusted_lesson.json` and `promotion_report.json` pass strict CLOS schemas;
- the report and embedded proof agree and every promotion gate is true;
- `run_summary.json` records a green completed learning loop and a passed
  held-out retest;
- the capsule is explicitly allowed (`math-foundations-v0` by default);
- the lesson has an approved narrow activation profile;
- the signed registry verifies under the local HMAC trust root;
- the registry, lesson, plugin, and kill switch are enabled;
- the lesson has not reached `retestAfter`;
- the latest structured user turn matches the lesson profile;
- the turn belongs to an allowed live agent and is not a training, Oracle,
  cron, or subagent session.

If any condition fails, the answer path is unchanged.

## Data and privacy boundary

- The registry stores promoted lesson text and proof metadata only.
- Runtime telemetry stores timestamps, pseudonymous principal tags, registry
  revision/key ID, selected lesson IDs, activation profile names, and outcomes.
- Runtime telemetry does **not** store user prompts, answers, lesson text, or
  retrieval context.
- Training artifacts may contain generated exam prompts and model answers; they
  do not contain WhatsApp or other personal chat content.
- Training and live-answer sessions are explicitly isolated so existing live
  lessons cannot contaminate baseline training evidence.

## Default paths

- Plugin: `/root/clawd/plugins/cortex-learning-os-live`
- Registry: `/root/.openclaw/cortex-learning-os/live-registry.json`
- HMAC key: `/root/.openclaw/cortex-learning-os/registry.hmac`
- Telemetry: `/root/.openclaw/cortex-learning-os/telemetry.json`
- Training state: `/root/.openclaw/cortex-learning-os/training/`
- Incoming verified artifacts (outside the Git product tree):
  `/root/clawd/artifacts/cortex-learning-os-training/incoming/`
- Remote source: `/home/jake/clawd-remote/cortex-learning-os`
- Remote job state:
  `/home/jake/clawd-remote/state/cortex-learning-os/`

State directories and files are owner-only. The HMAC key is never committed,
synced to Hetzner, or printed by status commands.

## Operator commands

From `/root/clawd/cortex-learning-os`:

```bash
npm run live:status
npm run live:verify
npm run live:disable -- --lesson-id <lesson-id>
npm run live:enable -- --lesson-id <lesson-id>
npm run live:registry:disable
npm run live:registry:enable
```

Start a detached real-math training run (stress is the default and most likely
to expose a correctable error):

```bash
./scripts/launch-live-math-training.sh --exam stress
```

Other allowlisted curricula are `baseline` and `challenge`. The launcher
requires local `HEAD == origin/main`, the same commit on Hetzner, a valid live
registry, and the remote worker. It returns immediately after creating detached
worker, harvester, and notifier units.

A no-model-call readiness check is:

```bash
./scripts/launch-live-math-training.sh --exam stress --dry-run
```

## Kill switch and rollback

Fastest answer-path stop without destroying evidence:

```bash
npm run live:registry:disable
```

A specific lesson can be disabled independently. The OpenClaw plugin also has a
configuration-level `killSwitch`; changing that requires configuration
validation and a gateway restart. Registry changes are hot-reloaded and do not
require a restart.

Rollback preserves the signed registry and training artifacts. Removing or
mutating proof artifacts is not part of normal rollback.

## Stop condition for v0.7 integration

The integration is complete only when all of the following are observed:

1. source and plugin tests are green locally and on Hetzner;
2. the canonical real math-foundations lesson installs into a valid signed
   registry;
3. OpenClaw loads the plugin from the canonical default path;
4. a live positive canary records `answerInfluence=true`, identifies the
   expected lesson, and returns the correct exact answer;
5. non-math and mismatched-math canaries record no lesson application;
6. telemetry contains no prompt or lesson text;
7. the gateway is healthy after restart;
8. the detached launcher dry-run verifies the canonical local/remote boundary;
9. canonical `origin/main`, local source, and remote source agree.

Passing this stop condition proves that verifier-promoted scoped lessons can be
learned, installed, and used live. It does not prove broad math improvement,
causal benefit across domains, or any model-weight change.
