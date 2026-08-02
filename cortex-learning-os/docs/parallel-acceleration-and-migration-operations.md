# Parallel acquisition acceleration and additive graph migration

This runbook covers the signed parallel accelerator and the additive path from
an exact signed 84-concept v2 state to the canonical 264-concept target. The
264 graph/policy/capsule are the command defaults. The 84 graph remains only an
explicit migration source. Acquisition collects covered-once and genuine
correction evidence; it never selects or schedules retention review.

## Trust and placement boundary

The control plane builds and HMAC-signs one wave. The signed envelope freezes:

- the exact Git commit and tree;
- canonical graph, policy, capsule, complete signed-state identities, and the exact external assessment-bank identity;
- the base revision and existing applied-run receipt prefix;
- each selected concept record and relevant pending-repair record;
- each child run ID, seed, xhigh model runtime, read-only/no-tools constraints, and exact signed session plan;
- canonical UTF-8 bytes and SHA-256 digests for observed, correction, and paired generated items and their local oracle inputs;
- the expiry and deterministic merge order.

Only the per-child session plan and an owner-only copy of the exact assessment bank are copied to Hetzner. The state HMAC secret stays on the control plane. Every Codex process runs as the `jake` service user in a detached Hetzner unit with its own artifact root.

The independent harvester waits at least five seconds between polls. It copies artifacts only after every child is terminal. A remote infrastructure, source, or execution failure prevents any apply attempt.

## Launch one wave

The default concurrency is four; the accepted range is 1 through 8.

```bash
cd /root/clawd
cortex-learning-os/scripts/launch-parallel-adaptive-wave.sh \
  --assessment-bank /owner-only/acquisition-bank.json
```

`--assessment-bank` is mandatory, including for a dry run. It must name the exact externally supplied, independently authored and reviewed production bank bound to the canonical trust policy, deployment, rubric, and campaign. The launcher validates it before any worker dispatch, stages it mode `0600` for `jake`, threads the same bytes through every child and the control-plane apply, and fails closed if it changes. Generated fixture banks are never accepted as production evidence.

Use `--concurrency N`, `--expires-seconds N`, or `--dry-run` as needed. A dry run still performs source/Hetzner/runtime preflight and writes a signed wave, but launches no Codex process.

The launcher verifies the canonical source marker against `origin/main`, resolves the commit tree, verifies the same commit/tree on Hetzner, builds the wave through `adaptive-wave-plan`, starts one independent control-plane harvester, and starts all selected child units without a shared worker lock.

The control-plane apply API is:

```bash
node cortex-learning-os/src/live-control.mjs adaptive-wave-apply \
  --state-root /root/.openclaw/cortex-learning-os \
  --wave /root/.openclaw/cortex-learning-os/waves/WAVE_ID/wave.json \
  --artifact-root /root/clawd/artifacts/cortex-learning-os-waves/WAVE_ID \
  --source-commit COMMIT \
  --source-tree TREE \
  --assessment-bank /owner-only/acquisition-bank.json
```

Do not invoke it before all child artifact roots are present.

## Merge and stale-state semantics

The verifier independently checks the manifest, exact committed source,
trusted-runner signature, raw provider output and append-only event ledger,
provider request/session identities, xhigh/read-only/no-tools execution,
positive usage, signed plan, frozen item bytes and oracle inputs,
deterministic grades, candidate linkage, paired analysis, and proposed delta
for every child before constructing a state update. Worker-authored JSON and
manifests are transport integrity only.

If every child is safe, deltas are applied in `mergeOrder` and the state revision advances exactly once in one atomic signed write. Run receipts are appended in that order. An exact replay is idempotent. Reusing a run ID with different artifacts is rejected.

A genuine observed or correction failure can still carry valid learning evidence. Because wave footprints are disjoint, that failure and successful sibling evidence can be recorded together. A structured mechanical blocker, missing artifact, tamper, source drift, provider/runtime/usage/tool violation, or unsafe delta fails the whole wave before mutation.

A higher current revision is not by itself stale. Work remains eligible only when:

- graph, policy, capsule, commit, and tree identities still match;
- every selected source concept record is byte-identical;
- each relevant repair record is byte-identical;
- the frozen applied-run ID and receipt arrays remain an exact prefix;
- no selected concept or repair target overlaps another child or an intervening update.

Any selected-record, repair-record, receipt, or partial-application conflict fails closed.

## Repeated acquisition-only waves

Launch the responsive detached supervisor with an independent notifier:

```bash
cortex-learning-os/scripts/launch-parallel-adaptive-continuation.sh \
  --concurrency 4 \
  --max-waves 100 \
  --max-sessions 800 \
  --max-wall-seconds 86400 \
  --assessment-bank /owner-only/acquisition-bank.json \
  --graph /absolute/committed/cortex-learning-os/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json \
  --policy /absolute/committed/cortex-learning-os/policies/adaptive-math-phd-v1.json \
  --capsule /absolute/committed/cortex-learning-os/capsules/math-foundations/capsule.json
```

The supervisor stops at the graph frontier, a genuine blocker, the wave cap, the child-session cap, or the wall-time cap. All Codex workers remain on Hetzner. The existing `launch-adaptive-math-continuation.sh` sequential launcher remains a compatibility path.

Machine-readable state categories are available through:

```bash
npm run live:adaptive:status -- --state-root /root/.openclaw/cortex-learning-os
```

The output separates `acquiredOnce`, `learningOrCorrection`, `unassessed`, externally owned `formalQualification`, and the current prerequisite-ready `frontier`.

## Canonical PhD target

The production target is supplied in-tree:

- `capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json`;
- `policies/adaptive-math-phd-v1.json`;
- deterministic mechanics fixtures for source coverage, with advanced
  synthetic drills rejected from production evidence until independently
  authored assessment surfaces are installed; and
- the rubric, sealed qualifying blueprint, retention contract, and seven-proof
  trusted registry described in `phd-mathematics-program.md`.

Wave/status commands accept `--graph`, `--policy`, and `--capsule` paths. Migration accepts separate source and target graph/policy paths.

## Freeze and apply an additive v2 migration

First obtain a read-only freeze from the signed source state:

```bash
npm run live:adaptive:migration-freeze -- \
  --state-root /root/.openclaw/cortex-learning-os \
  --source-graph /root/clawd/cortex-learning-os/capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json \
  --source-policy /root/clawd/cortex-learning-os/policies/adaptive-math-continuous-v1.json \
  --target-graph /root/clawd/cortex-learning-os/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json \
  --target-policy /root/clawd/cortex-learning-os/policies/adaptive-math-phd-v1.json \
  --source-commit COMMIT \
  --source-tree TREE
```

Record the returned revision and five digests in the operator change record. Then pass those exact values:

```bash
npm run live:adaptive:migrate-additive -- \
  --state-root /root/.openclaw/cortex-learning-os \
  --source-graph SOURCE_GRAPH \
  --source-policy SOURCE_POLICY \
  --target-graph TARGET_GRAPH \
  --target-policy TARGET_POLICY \
  --source-commit COMMIT \
  --expected-source-commit COMMIT \
  --source-tree TREE \
  --expected-source-tree TREE \
  --expected-source-revision REVISION \
  --expected-source-state-digest STATE_SHA256 \
  --expected-source-graph-digest SOURCE_GRAPH_SHA256 \
  --expected-source-policy-digest SOURCE_POLICY_SHA256 \
  --expected-target-graph-digest TARGET_GRAPH_SHA256 \
  --expected-target-policy-digest TARGET_POLICY_SHA256 \
  --audit-out /root/.openclaw/cortex-learning-os/audits/phd-expansion.json
```

The migration accepts any signed source revision when it matches the frozen
revision and complete signed-state digest. It rejects bad signatures, stale
inputs, non-monotonic time, concept removal, concept rewrite, repeat targets,
and graph/policy scope drift. Source and target paths must be committed regular
files inside the product subtree and match their exact Git blobs.

Every existing concept record, pending repair, applied run ID, applied run
receipt, original v2 migration receipt, and prior additive receipt remains
byte-identical. Only new default unassessed concept records and one additive
receipt are appended. The state revision advances exactly once.

Publication uses an owner-only signed transaction journal next to the audit.
The journal records `prepared`, `state_committed`, and `committed` phases plus
the exact signed target state and audit. The target state is published before
the audit. On retry, an exact prepared/partially committed transaction is
reconciled; an existing matching audit no longer makes recovery impossible.
Any mismatching state, audit, journal, signature, or digest fails closed.
Crash-injection tests cover interruption after state publication and after
audit publication.

After migration, pass the in-tree target graph and policy to the parallel wave
and continuation launchers. Acquisition remains acquisition/correction only.
Retention waits, exams, proofs, specialization, and research are separate
qualification events and are never routine review selections.

Heavy qualification jobs launch from a control-plane-signed plan with
`scripts/launch-phd-qualification.sh`. Jobs run detached as `jake` on Hetzner
from a frozen checkout beneath the root-owned
`/var/lib/cortex-learning-os/phd` hierarchy and produce inert evidence only.
Every checkout ancestor is opened no-follow, required to be root-owned and
non-writable by group/other, and retained by descriptor through closure
validation. Existing terminal artifacts are validated before skipping; upload
staging and invalid/partial artifact quarantine live outside the exact job and
artifact roots. The local harvester also uses protected sibling staging and
quarantine roots. Its signed per-job journal adopts only a complete remnant
whose job, plan, manifest, and file digests match; mismatches are quarantined.
Files and directories are fsynced before the terminal rename, and the terminal
root plus signed state parent are fsynced before readiness. The independent
harvester records
`ready_for_independent_replay`, never mutates canonical signed state, and emits
a state file compatible with the packaged
`scripts/detached_job_notifier.py`.

Before freezing a production campaign, operations must independently approve a
static Linux x86-64 executor with no ELF interpreter and install it as:

```text
/opt/cortex-learning-os/approved-model-executors/<executable-sha256>/codex
```

Every ancestor is root-owned and non-writable by group/other. The digest-named
runtime directory and `codex` file are `root:root` mode `0555`. Build the
approved-executable record from that installed object, bind it to the frozen
source deployment with `bindApprovedModelExecutable`. The same operation
requires an independently approved static research-runtime wrapper installed
at
`/opt/cortex-learning-os/approved-research-runtimes/<sha256>/runtime`, plus its
exact immutable client and daemon executable/configuration/rootfs closure.
Sign the resulting v3 deployment as part of the campaign. Those records bind
the absolute paths, exact
byte length and SHA-256, the two-entry runtime closure, and its closure digest.
No worker-owned path or dynamically interpreted executor is eligible.

The remote launch preflight traverses the approved path descriptor-relatively
with no-follow semantics and rechecks the signed identity. The worker opens and
hashes the same object, maps that descriptor to child fd 3, and executes
`/proc/self/fd/3`; it never resolves the approved executable by pathname after
validation. Research reproduction likewise opens the approved runtime once,
maps it to fd 4 for both exact image inspection and execution, uses no inherited
`PATH`, and binds the digest-addressed image, isolation flags, observed
environment, daemon closure, and actual argv. There is no `--remote-codex-bin` or production
`--codex-command` override.

The launcher requires the owner-only qualification HMAC and authenticates the
v2 job plan, including its v3 deployment, before reading campaign, deployment,
or job fields and before any SSH, SCP, or remote `systemd-run`:

```bash
scripts/launch-phd-qualification.sh \
  --jobs /root/.openclaw/cortex-learning-os/phd/campaigns/CAMPAIGN/jobs.json \
  --secret /root/.openclaw/cortex-learning-os/phd/qualification.hmac
```

The local state root is opened component-by-component from `/` with
`O_DIRECTORY|O_NOFOLLOW`. Every ancestor must be `root:root`, owner-traversable,
and non-writable by group/other; the supervisor retains the bound descriptors
through launch and archival resume. Publication uses the retained state-root
view. Worker, harvester, and notifier transient unit names combine a readable
prefix with a full content identity over the plan/campaign/job/command, and an
active unit is adopted only after its user, group, cwd, environment binding,
live `/proc` argv bytes, and command digest match.

`npm run phd:jobs:verify -- --plan ... --secret ...` exposes the same narrow
verification boundary. It checks the plan HMAC, exact schema, campaign digest,
commit/tree/content deployment identity, validity interval, uniqueness, and
every job HMAC and binding. Each job is reverified against the initially
authenticated plan digest immediately before materialization. The remote worker
then checks the exact materialized file digest before model spend.

After plan expiry, a rebooted or replaced supervisor must use the archival-only
entry point and the saved campaign plan:

```bash
scripts/launch-phd-qualification.sh \
  --archival-only \
  --jobs /root/.openclaw/cortex-learning-os/phd/campaigns/CAMPAIGN/plan.v2.json \
  --secret /root/.openclaw/cortex-learning-os/phd/qualification.hmac
```

This mode authenticates the plan with `archival_harvest`, descriptor-validates
the local and remote frozen checkouts, verifies every existing local and remote
job byte sequence and the exact job set, and starts only harvesting and
notification. It cannot snapshot a plan, create a checkout, materialize or copy
a job, validate a live executor for new work, or dispatch a worker. A missing
terminal after expiry requires a new campaign. A semantically invalid terminal
is quarantined and rerun only while its signed launch authorization is valid.

A retention wait may be built only from a valid retention-status HMAC under
that same qualification secret. Production uses the dedicated non-root
`cortex-retention` service identity. Its UID and primary GID must each map
uniquely, its primary group may contain no other account, and it may have no
supplementary group. Production accepts only a descriptor-validated
`/etc/nsswitch.conf` in which `passwd`, `group`, and any explicit `initgroups`
database name exactly the local `files` provider. Dynamic, network, compatibility,
fallback, action-clause, and otherwise non-enumerable providers fail closed.
The runtime opens `/etc/nsswitch.conf`, `/etc/passwd`, and `/etc/group` no-follow
through a recursively root-owned, non-writable ancestor chain, requires
root-owned non-writable one-link regular files, and parses the passwd and group
files directly. It never treats successful bare `getent` output as complete.
Retention wait v2 signs the SHA-256 digest of all three source files, and every
later identity or protected-state check requires the current direct snapshot to
match that binding. A source-file or NSS-policy change therefore stops resume
rather than silently changing the numeric authority.
This proof is repeated before protected state and secret access. Every wait,
journal, bundle, release, notifier, and secret path must be beneath one
pre-existing state root owned by that exact numeric service UID/GID at mode
`0700`.
Operations must provision that system identity first, create the state root as
`<service-user>:<service-group>` mode `0700`, and install the qualification
secret and resume bundle as that same owner at mode `0600` with one link.
Every JSON successor is also service-owned mode `0600` with one link. Group
authorization is never accepted.
Operations must keep the three signed local identity sources unchanged for the
life of a wait. Apply account-database or NSS-policy maintenance before building
a wait, or after it has reached a terminal state; retention wait v1 records are
intentionally not accepted by the v2 runtime.
Use a traversable root-owned hierarchy such as
`/var/lib/cortex-learning-os/retention`; production state beneath `/root` is
rejected because the dedicated service cannot traverse that ancestor.
The complete ancestor chain is opened no-follow from `/`; ancestors above the
state root are root-owned and non-writable outside root, while only the
dedicated service UID can read or write the state root. Its device/inode digest
is signed. Reads, temporary creation, fsync, and rename use retained directory
descriptors and revalidate the signed identity before publication. The signed
wait also carries the complete source status digest and signature, the
root-owned executable and entrypoint byte digests, the complete immutable
deployment execution closure, and the exact Node interpreter, loader, and
currently loaded shared-library closure. The runtime closure also binds the
exact `/usr/bin/flock` helper used for kernel exclusion. It records every
root-owned no-follow ancestor plus exact modes, sizes, and SHA-256 digests for
the interpreter, shared objects, and helper; the helper is opened no-follow and
executed only through its verified descriptor. Timer installation and due-time firing
revalidate both recursive closures before deriving a content-addressed service/timer
identity. The unit uses the signed numeric `User=` and `Group=`, an explicit
single-GID supplementary set, and `UMask=0077`; it never delegates authority
through a reusable account or group name. Build, installation, recovery, and
firing re-resolve the signed name-to-ID mapping and fail if the account or group
is shared or remapped. Before any secret read, resume also requires its real
EUID, EGID, and every supplementary GID to equal the signed service identity.
Timer reconciliation then inspects the command, calendar, persistence, numeric
service identity, sandboxing, and unit properties. Before creating anything externally it
persists an owner-only HMAC journal at the signed default
`<wait-state>.timer-journal.json` path.
Installation and due-time reconciliation serialize on a permanent protected
per-timer inode whose open file description holds a kernel `flock` for the
complete install or reconcile operation. Process death releases the exclusion;
the inode is never unlinked or reclaimed by pathname, so two recovery entrants
cannot displace one another's locks. Descriptor/path device and inode identity
are rechecked after acquisition. Every journal and wait successor compares the
digest of its durable predecessor while that exclusion remains held. The only
accepted transition history is
`pending -> created -> inspected -> fired -> released`; every successor chains
the digest of its authenticated predecessor. Only `inspected` may publish
`timerInstalled: true`. A retry after creation but before publication adopts
the exact content-addressed timer without creating a duplicate. If a crash
leaves `pending` before external creation and downtime spans the due time, the
same transition creates or adopts the deterministic persistent timer, records
its exact firing evidence, and releases only after `resumeAt`.

At or after the signed due time, the canonical resume path reconciles the same
journal, exact systemd firing identity, and inspected `LastTriggerUSec` before
writing the one signed release path. A crash after firing or after release-file
publication reuses that journal-authenticated external firing time and adopts
only byte-identical release output. The exact service binds
`Restart=on-failure`, a fixed retry delay, and failed-unit retention so the
canonical resume command automatically re-enters reconciliation after a crash.
Mismatched units, properties, firing identity, journal history, or successor
bytes fail closed. Dry run writes no journal transition and cannot manufacture
installed, fired, or released evidence.

Each candidate worker summary and artifact manifest carries the same canonical
signed lower bound, start, completion, signed-job expiry, job digest, and
interval digest. The local harvester rechecks every executor and writes an
HMAC-authenticated harvest receipt for that exact interval and manifest. Final
assembly consumes the exact manifest and every terminal file byte for exams,
proof requests, research candidate/reproduction, and retention jobs; summary
HMACs cannot substitute for those bytes. This authentication is not
provider-time authority: independent execution attestation remains mandatory
before qualification.

## Verification

Before release:

```bash
cd /root/clawd/cortex-learning-os
npm test
npm run validate:fixtures
python3 -m unittest scripts/test_continue_adaptive_math.py
python3 -m unittest scripts/test_continue_parallel_adaptive_math.py
git diff --check
```

Remove `__pycache__` directories produced by direct Python test or compile runs before committing.
