# PhD mathematics trajectory and production boundary

## Current state

The committed source defines a 264-concept prerequisite DAG, a six-stage
rubric, four core qualifying specifications, specialization, seven formal proof
obligations, two retention windows, and a bounded research gate. These are
program specifications, not evidence.

The checked-in `policies/phd-production-trust.v1.json` has
`productionEnabled: false` and no authorities. Pinned Lean, production sealed
banks, a live signed 264-concept state, retention windows, proof runs, and
research artifacts are absent. Therefore every production qualification gate
is non-green and `phd_math_qualified` remains false.

The first 84 graph records are canonically identical to the prior
continuous-acquisition graph. The 180 additional records describe advanced
tracks. `src/phd-assessment.mjs` currently supplies broad deterministic drills
for mechanics tests. Each such item is labeled
`synthetic_track_drill_unqualified`; production acquisition, retention, and
qualification verifiers reject it. Prefix coverage is not outcome coverage.

## Required evidence layers

Production qualification requires all of the following for one subject and
one exact committed deployment:

1. A signature-valid 264-concept acquisition state with no unassessed or
   learning/correction records, plus an independent acquisition-authority
   attestation over the raw evidence-ledger root and assessment-registry
   digest. The registry must contain exactly one concept-specific,
   outcome-bound production entry and a unique seed-independent theorem family
   for every committed concept. Acquisition means covered once, not retention.
2. Two signed, declared-unseen retention windows separated by at least seven
   elapsed days. The control plane derives stages/tracks/outcomes from exact
   committed graph and rubric bytes. Windows must be disjoint by item,
   concept, outcome, and seed-independent semantic theorem family.
3. Four core exams and one declared specialization exam from sealed bank v2
   artifacts that were independently authored and expert reviewed, unavailable
   during acquisition, disjoint from acquisition and prior campaign families,
   and authenticated by separate bank-authoring and expert-review authorities.
   Campaign freeze consumes the signed acquisition receipt and rejects every
   bank family found in that exact assessment registry.
4. Graduate qualifying difficulty and complete declared track coverage, with
   explicit concept, outcome, and theorem-family metadata. Generated fixture
   banks are categorically ineligible.
5. Exact raw candidate output and an append-only raw provider event ledger for
   every model call, signed by a trusted runner. The signature binds provider
   request/session identities, planned session, role, model, xhigh,
   read-only/no-tools execution, positive provider usage, prompt, output,
   ledger predecessor, and timestamps.
6. Separate authenticated proctor and grader receipts for every exam. Role
   strings and worker-authored manifests are not provenance.
7. Kernel acceptance and independent replay for every proof obligation. The
   runtime itself must have a protected-build signature over every Lean runtime
   file, every compiled dependency file, the exact Lake manifest, and the exact
   package allowlist, product, deployment, and trust-policy binding. Kernel and
   replay evidence retain the exact canonical attestation bytes and signed
   record. Proof replay receipts retain full replay evidence and the independent
   replay attestation, are recomputed from raw task/candidate/template bytes,
   and require runtime/replay authority IDs and verification-key digests to be
   distinct.
8. An executable research source bundle, immutable image digest, exact
   reproduction command, stdout/stderr digests, and independently recomputed
   output files. Reproduction and adversarial review require separate
   authorities.
9. An independently extracted formal claim whose theorem statement expresses
   the artifact claim semantics. The correspondence authority signs the
   executable source, environment, extraction, template, theorem statement,
   and semantic digest. Merely mentioning an artifact hash in an unused
   definition or hypothesis is insufficient.

Each layer is subject-, deployment-, age-, and content-bound. Missing,
fixture-only, self-declared, stale, duplicate, malformed, or digest-mismatched
evidence fails closed.

## Control plane and retention resume

`src/phd-qualification-control.mjs` provides bounded control-plane entry points
for campaign freeze, job-plan creation, protected Lean replay, campaign
verification/publication, authenticated executable-research assembly, and due
retention release. It consumes owner-only
HMAC secrets and writes new immutable outputs. Every input bundle must include
`expectedDeployment` equal to the authenticated campaign/plan v3 deployment,
whose source projection must equal the exact clean committed v2 program
deployment and whose approved executable is validated separately.
Generic control outputs and campaign reports share one descriptor-relative,
no-follow publisher. Its output parent must already be owner-only; publication
never repairs permissions on a pre-existing directory. Every observed target
or stage must have both the validated parent's device and Linux mount ID, so a
same-device bind mount cannot be adopted as though its namespace were governed
by the no-replace link and parent-fsync protocol. It fsyncs authenticated
staging bytes, re-syncs every selected stage inode and its parent immediately
before commit (including a stage adopted after process death), creates the
result with a no-replace hard link, adopts only an
exact authenticated byte match after contention or a crash, removes reconciled
staging aliases, and fsyncs the selected inode before its parent after both the
no-replace link and the final staging-alias unlink. Caller-selected outputs may
not occupy any name under the internal crash-stage prefix, including malformed
stage-like names, or contain control characters, so a separately published
control result cannot poison, ambiguously encode, or be mistaken for an
orphaned stage. An
authenticated distinct winner remains immutable; a losing retry first durably removes validated
single-link crash stages and then reports the byte conflict. Adoption takes a
fresh post-cleanup checkpoint and requires unchanged nanosecond change time,
link count, metadata, and bytes through its final named revalidation, so an
in-place change-and-restore cannot hide behind the alias cleanup needed for
crash recovery. A recognizable staging alias that arrives after either adoption
snapshot causes a bounded retry and exact cleanup; a legitimate competing stage
that is unlinked after its no-follow descriptor opens is treated as a transient
departure and reconciles through the authenticated winner. Any unrecognized
hard link still exhausts that bound and fails closed. Both the initial publisher and an
identical adopter keep the selected target descriptor pinned while validating
the named parent, then pin the freshly resolved named-parent descriptor and
reopen the target through that descriptor. The selected target must retain the
same exact inode, bytes, nanosecond metadata, and single-link state before
success is reported. The final named-parent operation also snapshots the
directory's nanosecond modification, change, and birth times and requires them
to remain unchanged after its target descriptor closes. After that full-path
parent check, publication resolves the target again through the freshly opened
parent, closes this second target while the first remains pinned, and re-reads
the pinned inode's exact authenticated bytes and nanosecond metadata. An
in-place same-inode rewrite that leaves parent metadata unchanged therefore
fails closed, as does a target-name replacement in the last read-to-return
window or during the final full-path resolution, even if its bytes and
authentication are otherwise valid. It then closes that pinned snapshot and
performs one final no-follow commit witness through a newly opened parent,
requiring unchanged parent mutation identity and the same authenticated,
single-link target inode. After the durability witness closes every earlier
target and staging-file pin, publication resolves the full parent and target
once more and requires the same directory mutation identity, target inode,
exact bytes, authentication, metadata, and single-link state before returning
success. Immediately before the
no-replace link, the publisher also reopens
the named stage no-follow and re-authenticates its exact serialized bytes in
addition to matching its pinned inode and nanosecond metadata; earlier in-memory
and staged-byte checks cannot substitute for commit-boundary authentication.
A report that claims every PhD campaign gate passed cannot use this low-level
summary publisher. The production campaign command calls a combined
verify-and-publish boundary that consumes the complete immutable campaign
bundle, exact signed harvest receipts and terminal artifact/model-call sets,
proof-runtime and replay requests, signed assessment banks, and retention
evidence before it creates the report bytes. An otherwise well-formed HMAC
summary is therefore not a publication authority for a qualified result.
Descriptor observations retain device and inode identities as kernel-width
integers; publication never narrows a filesystem identity through a JavaScript
floating-point number. Named files are opened no-follow and nonblocking, and
must prove regular-file metadata before any bytes are read. Exact positional
reads are capped at the authenticated pre-read size and reject an extra byte,
so a FIFO, other special-file substitution, or concurrently growing regular
file fails closed instead of stalling or driving an unbounded snapshot.
The CLI rejects substituted graph/rubric/policy/trust/program bytes, any
fixture-only value anywhere in the bundle, and all work while production trust
is disabled.

Retention waits are signed, persisted owner-only, and may be installed through
the packaged detached notifier/resume path. Installation and resume reconcile
an owner-only HMAC journal with the exact ordered installation prefix
`pending`, `created`, `inspected`, `install_pending`, and `installed`, optional
paired `install_invalidated`/`install_repair` successors, then `fired` and
`released`. A permanent no-follow lock inode holds a kernel exclusion across
every journal/wait comparison and replacement; process death releases it
without stale pathname deletion. The signed process-runtime closure is
published before the wait into a root-owned content-addressed runtime image.
Its exact recursive `0444`/`0555` set contains Node, the dynamic loader, every
loaded library, and the no-follow, descriptor-executed helpers and their
dependencies. Sealed staging is adoptable after a crash; abandoned partial
staging is moved to a disjoint root-only quarantine. The service uses that
image as `RootDirectory`, mounts only the immutable signed source checkout and
the protected state directory, and read-only mounts the current local NSS
files, system-bus identity, and durable systemd unit directory needed for
firing inspection. The due process resolves its unit-directory descriptor's
mount ID through `/proc/self/mountinfo`, requires that mount to be read-only at
the exact in-root unit path, and binds that observed access state into fired
evidence. Host-side installation is recorded separately as a privileged
descriptor observation; it cannot be mislabeled as the sealed-service bind.
Thus package replacement cannot substitute or remove the delayed interpreter
or helpers, while the sealed non-root resume process can observe but cannot
mutate the host unit bytes.

The signed wait fixes the dedicated service's unique
name-to-numeric-UID/GID mapping, normalized files-only NSS policy, and an
owner-only `0700` service state directory containing only service-owned `0600`,
single-link state, bundle, release, and secret files. Every install, reconcile,
and resume reparses the complete current passwd and group databases through
no-follow, nonblocking root-owned descriptors. Protected state, bundle, release,
and secret ingestion likewise uses bounded positional reads through nonblocking
no-follow descriptors, repeats the pinned bytes, reopens the exact name, and
requires unchanged nanosecond inode, link, mount, and parent-directory identity
before parsing or consuming the snapshot. The safe metadata captured by the
initial open must also equal the first read baseline; a writer cannot relax a
mode, add a hard link, or make a protected parent writable between those checks
and have the unsafe baseline treated as stable. A FIFO cannot stall delayed
resume, and an in-place rewrite or name substitution cannot inherit the earlier
metadata decision. Executable and delayed-entrypoint identities are consumed
from the recursively authenticated immutable runtime/source closure members;
retention does not reopen those members by pathname to derive a second authority
digest. Unrelated identity records are permitted, while UID
or GID aliases, remaps, shared primary groups, supplementary membership, and
NSS provider changes fail closed. The durable unit uses the signed numeric
UID/GID. Resume also rechecks its EUID, EGID, and supplementary groups before
opening the HMAC secret. The timer is not transient: content-addressed
service and timer unit bytes are atomically published in durable root-owned
systemd storage, with the unit inode fsynced before its parent after each link
and staging-alias unlink, then daemon-reloaded and enabled for boot. Reconciliation
reopens the unit directory and both unit files with no-follow descriptors,
checks their exact bytes, hashes, ownership, modes, link counts, and inspected
inode identities, and proves that none of the exact-name, dash-prefix, or
type-wide `.d` paths systemd applies to either unit exists in the durable unit
directory. That complete applicable-path set and its absence are bound into
the inspected and fired observations; an empty pre-positioned prefix or
type-wide drop-in directory cannot later acquire an override while leaving the
parent unit-directory identity unchanged. The due-time
process pins all three descriptors while it
reads the cached manager properties, rechecks the named publication after that
inspection, and keeps the descriptors pinned across the authenticated `fired`
journal write, exact named readback, and commit. It then rechecks the named
files and the current loaded manager semantics under the same pinned unit pair
before any release is constructed. This fresh check is required even when a
previously committed `fired` journal is being retried after process loss, and
when manager state remains loaded its `LastTriggerUSec` must still equal the
authenticated fired instant. Each named unit observation closes its last
freshly resolved descriptor while the outer unit descriptor remains pinned,
then re-reads that pinned inode and metadata before the observation can return.
A same-inode write in that close-to-return boundary is therefore rejected
before an `inspected` journal can advance to `fired`, even when every cached
manager property remains exact. Complete manager-state loss across reboot remains
recoverable from the already authenticated fired predecessor and exact durable
unit files only when successful manager queries independently return the exact
requested unit identities as not found. A failed manager query cannot
masquerade as clean reboot absence; a present partial, waiting, or changed
loaded state is also rejected. Both inspected and fired manager evidence bind
`NeedDaemonReload=no` for the service and timer, so systemd's own declaration
that its loaded semantics are stale relative to disk cannot coexist with an
accepted durable-unit observation. The
resume path also pins the same exact unit pair separately across the release
file, released-journal, and released-wait commits. A deletion or replacement
during any boundary can leave a fail-closed predecessor or orphaned exact
release file for owner diagnosis, but it cannot advance the next authenticated
successor. Each pinned critical section also re-reads the descriptor mount
record before and after its mutation and requires the access mode, mount point,
and mount ID to remain exactly the authenticated observation; a read-only bind
cannot silently become writable during a fired or release commit. Each critical
section performs a second complete named-unit, drop-in, directory, and
mount-access commit witness after its post-mutation assertion, so a change at
that assertion's last descriptor-close boundary fails closed as well. It then
closes both original unit-file pins, reopens the service and timer no-follow
through the pinned directory, and repeats that complete observation; cached
manager properties cannot inherit an earlier durable-byte snapshot across the
pin-release boundary. Every
later reconciliation authenticates the journal, revalidates
the no-follow unit files and every
loaded property, and safely re-enables the exact timer when a reboot has
removed runtime state in `pending`, `created`, or `inspected`. `Persistent=true`
supplies a missed activation only after the durable unit has been restored;
wall-clock passage alone never does. The resume command verifies the wait,
journal chain, exact unit bytes/properties, signed firing identity, and an
independently observed `LastTriggerUSec` at or after the deadline and no later
than the authenticated fired-transition observation before
writing a byte-identical idempotent window-two release. A timer, journal
transition, or elapsed interval is not a passing retention result.
Journal verification does not accept the authenticated inspection digest as a
semantic summary: it independently replays the exact loaded service command,
D-Bus command tuple, isolation and bind set, fragment and drop-in paths,
environment, timer calendar, activation state, and fired lifecycle from the
embedded properties for both `inspected` and `fired` transitions.

Durable unit observation v9 serializes directory and file device, inode,
mount-ID, and link-count values as canonical decimal strings and includes
nanosecond modification, change, and birth timestamps for the directory and
both unit files, plus the sorted complete set of applicable absent durable
drop-in paths. Binding the directory timestamps means detaching and later
restoring the same directory inode cannot erase the name-substitution evidence
while cached systemd properties remain exact. It also authenticates the actual
descriptor mount ID, mount point, and read-only state alongside the root, bind
path, runtime-closure digest, and service UID. Production observations
distinguish the privileged host broker from the sealed service; only the latter
may enter `fired`, and only with a read-only mount at the exact durable unit
path.
Fixture observations explicitly identify descriptor-relative direct access
instead. Each observation
requires the directory and both unit descriptors to share one mount ID in the
active mount namespace, rejecting a same-device file bind mount. Raw mount IDs
are not compared between the privileged host installer and the sealed due-time
service because Linux assigns namespace-local IDs; device/inode identity and
all exact bytes and metadata remain equal across those observations. This
preserves the exact kernel identity even on filesystems
whose 64-bit identifiers exceed JavaScript's safe integer range. Durable unit
observations v3 through v8 remain accepted as authenticated predecessors during
in-flight wait recovery; the next fired transition upgrades them to v9 after
a fresh exact observation that proves every applicable durable drop-in path
absent and binds the observed sealed access contract. A fired transition itself
must carry v9 evidence: v3 through v8 fired observations are invalid even under an
otherwise correct HMAC and cannot construct or publish a release. Production
firing also requires the current process to prove that the signed sealed
runtime is active; the retention UID or a closure-digest environment value
alone is insufficient because the current interpreter, loaded objects,
recursive root image, and mounted targets are revalidated against that closure.
Durable unit
and staging descriptors are also opened nonblocking and must prove regular-file
metadata before reads. Bounded positional snapshots reject shrinkage or growth
past the exact pre-read size, preventing a special-file replacement or
concurrently growing regular file from hanging or exhausting the sealed
due-time service while systemd's cached properties remain exact.

Remote workers receive no HMAC secret and cannot mutate canonical state.
Each job writes only to a producer-owned staging tree outside the terminal
namespace. A root-only, non-producing publisher imports it with
descriptor-relative no-follow traversal and exclusive files, validates the
complete recursive set, fsyncs every file and directory, transfers the result
to root-owned `0444`/`0555` material, and atomically renames it into the final
namespace before fsyncing the parent. A root-owned journal binds the signed job
bytes and all execution-closure digests. A permanent root-only per-job
directory descriptor holds a kernel exclusion from producer-stage creation
through execution, import, sealing, and final publication. Archival
reconciliation first adopts an exact authenticated live worker and otherwise
must acquire that same exclusion; a live producer or publisher causes a
non-mutating defer. On control-host restart, the harvester carries the live
unit binding, command digest, working directory, terminal path, and exact
reconcile-only command. It reauthenticates the live process until termination,
then uses the same per-job exclusion to recover import, sealing, or final
rename before harvesting. Restart reconciliation can finish a sealed
publication after expiry; only remnants proven ownerless under the exclusion
may be quarantined. Missing or invalid work after expiry requires a new
campaign.
Candidate start/completion times must agree
across the executor record, summary, and manifest and finish no later than the
signed job expiry. Harvest adds a control-plane HMAC receipt over that exact
interval and manifest, while provider-time authority still requires the
independent execution attestation. Exact already-applied wave receipts remain
idempotent after wave expiry, while incomplete or late-completing jobs fail.

## Canonical detached qualification plan

`phd:jobs:build` no longer accepts caller-supplied extra descriptors. From one
signature-valid frozen campaign it deterministically builds and signs:

- all four core-exam releases and the specialization release;
- exact tasks for all seven Lean obligations, including task bytes, theorem
  statement, template, deployment, toolchain, run identity, and replay role;
- bounded research generation;
- inert materialization of the exact frozen research theorem source;
- a canonical, closed-schema adversarial-review request whose exact bytes and
  SHA-256 bind the authenticated candidate artifact/result, request job and
  session, bounded claim, corpus, assumptions, and claim semantics;
- executable frozen-environment reproduction bound to that same harvested
  candidate; and
- every retention task/release whose session was declared in the campaign.

Retention remains staged: a later window cannot be built before its signed
predecessor and minimum separation exist. If a campaign declares a retention
session, jobs build fails unless the corresponding signed task and exact
candidate-visible release are supplied. It never invents a future window.

Every detached job has a descriptor digest and idempotency key. Dependencies
are explicit, terminal artifacts are immutable, and retries may only rerun a
missing job with the same descriptor identity. The plan separately lists
protected proof-replay, research-review, and reproduction-authority tasks.
Those tasks are not delegated to the evidence workers.
Local plan snapshots and materialized job files use a descriptor-relative,
no-follow publication beneath an owner-only directory. The publisher traverses
from the filesystem root with retained directory descriptors, rejects
symlinked or writable ancestors, binds every ancestor and the final parent to
its exact device, inode, mount, ownership, mode, and link identity, and repeats
that named traversal before success. Missing materialization directories are
created one component at a time through the retained descriptors with mode
`0700` and a parent-directory fsync. Publication writes and fsyncs a bounded
stage, creates the committed name with a hard-link no-replace operation,
fsyncs the parent around stage removal, and reopens and fsyncs the exact inode
and bytes through the pinned parent. Retry discards a safe unlinked partial
stage or completes cleanup of an exact same-mount stage already linked to the
target; malformed, foreign, oversized, cross-mount, or unexpectedly linked
stages fail closed. An already exact target is also fsynced before its parent
and named ancestor chain are confirmed. The returned SHA-256 is computed from
the authenticated plan/job bytes, never from a pathname reopened after the
publication handoff.
The research-review authority signs the exact request SHA-256 and scope, the
canonical review result/findings digests, and an interval beginning only after
the authenticated request job completes. Assembly and final verification
reconstruct those request bytes from the signed campaign, plan, receipts, and
terminal file set.

Model jobs run xhigh, read-only, and no-tools. Proof-candidate artifacts include
an unsigned independent-replay request with exact task, candidate, and template
bytes; they do not run or attest Lean. Non-model jobs only materialize frozen
bytes, execute the declared reproduction command, or prepare unsigned authority
requests. The harvester validates both artifact classes and never applies them.

## Frozen research reproduction

A production research program must freeze the exact source bundle bytes, every
source-file digest, a canonical bundle digest, the complete environment
identity, a digest-addressed Docker image, a lock digest, the exact
command, output paths, result path, and timeout. Network access is disabled and
the container root is read-only.

The approved client alone is not a runtime identity. Production deployment
binding v3 therefore uses `approved_research_runtime.v3`: approval observes the
active systemd service and socket units, unit drop-ins, invocation/PID/start
time/cgroup, descriptor-opened daemon executable and every mapped dependency,
the kernel Unix-socket inode owned by that service, the uniquely socket-owning
containerd process and its mapped libraries, the configured OCI runtime and
shim, the explicit seccomp profile, the loaded enforcing AppArmor policy bytes,
and the actual configuration and systemd
rootfs paths. The mutable Docker data and exec roots are measured separately
instead of being misrepresented as immutable closure material. Ancestors,
uid/gid, full mode (including special bits), device, inode, size, and file
digest are bound.

The client explicitly selects the signed Unix socket, OCI runtime, AppArmor
profile, and seccomp bytes and repeats the complete daemon observation around
execution. While the exact container is live, independent procfs/cgroupfs
evidence binds its init executable, shim parent, namespaces, mounts, image-layer
tree digests, cgroup limit, capabilities, seccomp and LSM state, offline network
namespace, read-only root, exact workspace bind, and protected tmpfs. Daemon
inspect output is supplemental and cannot satisfy those checks. A daemon or
helper restart, socket replacement, fake inspect response, ignored isolation,
file replacement, added or removed recursive entry, or closure drift fails
closed. Podman remains unapproved until it has an equivalent complete helper
and kernel-evidence closure.

Worker output remains an unsigned authority request. A protected reproduction
authority must return a distinct signed replay execution core on a separately
approved daemon/runtime generation and its own live kernel measurements. Final
campaign verification validates that replay core, requires it to start after
the worker execution, binds its exact request, deployment, source, daemon,
runtime, image-layer content, init executable, isolation, output, and result
identities, and rejects a copied worker core, same-daemon common mode, or
summary-only attestation.

`npm run phd:research:reproduce -- --task TASK
--candidate-binding BINDING --artifact-root OUT` is the standalone executable
runner. The detached worker uses the same implementation. It retains:

- an exact copy of every frozen source file;
- declared and observed environment/container identities;
- the declared command and the actual container command;
- byte-exact stdout and stderr, exit code, signal, and process error;
- every declared output/result byte and digest; and
- the exact harvested candidate artifact/result/output binding.

Its terminal JSON is
`cortex.learning_os.research_reproduction_authority_request.v4`, with
`unsigned: true`, `selfAttestation: false`, and a null authority attestation.
The request itself and its requested payload use the unique canonical JSON
encoding; their exact bytes and SHA-256 values are retained. Only an
independent authority named by the production trust policy may verify the
retained bytes and sign the exact
`research_reproduction_authority_payload.v2` envelope containing the request
SHA-256, unchanged worker payload, and distinct authority replay/measurement
record. Final verification reparses the
exact harvested request bytes and rejects newline, field, request, payload,
argv, executable, runtime, image, isolation, or observed-environment
substitution. A matching local execution is not self-attestation and is not
qualification.

For the research-main-result proof, production rejects the checked-in
digest-binding fixture. Campaign freeze accepts only the exact externally
generated Lean template bytes covered by the correspondence authority, and
jobs use the task bytes frozen into that signed campaign. The other six proof
tasks likewise use their campaign-frozen statement, template, run, and task
identities. Fixture digest substitution remains available only when
`fixtureOnly: true`.

## Source and release identity

Canonical graph, rubric, policies, blueprint, proof templates, capsule, and
trust policy are loaded from exact Git blobs at the declared commit. Production
commands require the declared tree to belong to that commit and reject a dirty
product subtree, untracked product files, paths outside the product, or working
bytes that differ from their blob.

An immutable-checkout deployment additionally reopens every source member
relative to pinned directory descriptors with `O_NOFOLLOW`, `O_NONBLOCK`, and
`O_CLOEXEC`. Every traversed directory must remain root-owned mode 0555 on the
checkout mount; every file must remain a single-link root-owned mode 0444/0555
regular file with the signed size and digest. The reader compares nanosecond
metadata, mount identity, a named reopen, and a second descriptor read before
returning bytes. Working-tree closure construction applies the same stable
double-read and named-inode check, and rejects hard-linked or concurrently
rewritten source members instead of signing a mixed snapshot.

Commit delivery identity is intentionally not stored in a tracked
self-referential integration report. An operator must create a signed external
release record after the commit exists, following `phd-release-evidence.md`.
Control-plane Git queries execute the trusted filesystem-authority-owned,
caller-non-writable `/usr/bin/git` inode through a pinned no-follow descriptor,
with only a fixed minimal environment; caller-selected Git repositories, object
stores, configuration, pagers, prompts, and loader variables are not inherited,
and repository fsmonitor execution is disabled.
`HEAD` is resolved once to an exact commit before the repository and product
trees are derived, so a concurrent ref change cannot assemble an identity from
different commits.
Canonical Git readers independently recompute the `blob <size>\0<bytes>` object
ID for every `cat-file` result instead of trusting repository lookup output
alone. Runtime controls that select committed graphs, policies, capsules, trust
policy, or exam templates consume the descriptor-pinned bytes returned by that
check directly; they do not validate a pathname and then reopen it for use.
Product-relative names are canonical component sequences with no empty, dot,
control-character, or backslash aliases.

## Commands and test tiers

```bash
npm run phd:validate
npm run phd:status -- --state-root /root/.openclaw/cortex-learning-os
npm run test:synthetic
npm run test:integration
npm run test:lean-real
npm run qualify:retention
npm run qualify:phd
```

The real gates never treat skips or absent artifacts as green. The standalone
model-real receipt gate has been removed; model execution is consumed only as
exact terminal bytes plus signed harvest receipts inside full campaign or
retention verification.
`qualify:retention` and `qualify:phd` require an owner-only control-plane secret
through `CLOS_QUALIFICATION_SECRET`. `qualify:phd` also requires
`CLOS_PHD_CAMPAIGN_BUNDLE`. Both that underlying bundle and the supplied report
must be root-brokered canonical objects: a root-owned mode-0400 alias and its
SHA-256-named twin beneath a root-owned, mode-0500
`.authenticated-objects` directory. The gate holds the report object pinned
while it opens and pins the bundle object, then performs the complete
verification synchronously inside those nested protected handoffs. The report
is only an integrity index and must canonical-match a fresh full verification
of the signed campaign, plan, harvest receipts and manifests, exact artifact
file bytes, acquisition bank, retention windows and banks, exam attempts,
proof runtime/replay request identities, and research reproduction bundle.
Report publication authenticates the exact closed report shape, complete layer
set, mechanical-gate relation, claim boundary, and full harvest-binding digest
set. That stricter signed summary remains an index only and cannot replace the
underlying evidence replay. The full campaign publisher admits only the exact
report recomputed from those underlying inputs; a different validly signed
summary cannot be adopted. Production `campaign-verify` therefore requires
`--bundle-out` as the protected destination for the verified input bundle; it
commits that bundle before the matching `--out` report, and retry adopts only
the same exact pair. Before publication reports success, it reopens the
brokered content-addressed bundle, recomputes the complete campaign from those
persisted underlying bytes while the immutable object remains pinned, then
opens and consumes the exact brokered report inside that protected handoff.
The outer bundle reader confirms its descriptor, name, parent, and ancestor
identities again after report consumption; pair substitution or a crash after
both commits therefore fails closed and remains an exact idempotent retry.
The version-4 report also signs `verificationBundleSha256`, the SHA-256 of the
exact canonical broker serialization of the complete underlying bundle. The
publisher derives it before commit, derives it again from the pinned immutable
object, and the status and final gates independently derive it from the bundle
they consume. Distinct complete bundles that happen to project to the same
summary can therefore no longer share a report or be cross-paired.
Production control and campaign publication run
only through the root authority broker. The broker performs descriptor-relative
no-follow, hard-link no-replace commits, fsyncs both naming layers, reconciles
bounded crash stages, and removes directory write authority before its final
handoff. Candidate-UID writers therefore cannot mutate either name when the
last broker descriptor closes. The owner-UID implementation and its finite
return witnesses remain fixture-only and cannot publish production authority.
Production root is also a kernel identity, not the numeric UID reported inside
an attacker-created user namespace. Broker publication and consumption require
real and effective UID/GID 0 plus the initial Linux UID and GID maps supplied by
procfs. The same boundary guards terminal publication, delayed process-runtime
closure creation, the local state supervisor, and privileged retention
installation and reconciliation. Due-time firing deliberately runs as the
signed dedicated numeric `cortex-retention` identity, not as root: it cannot
mutate the root-owned unit namespace and must instead reopen and authenticate
the exact unit pair, manager invocation, firing generation, and each release
successor under the authenticated timer lock. A mapped-root namespace is
accepted only by an explicit fixture path used to exercise crash recovery; it cannot
publish or consume production authority. This prevents a same-UID principal
from mapping itself to namespace UID 0, producing inner-namespace
"root-owned" mode-0400/0500 lookalikes, and then regaining outer-owner write
authority after the final descriptor closes.
An older sealed alias stage whose historical name does not bind its intended
digest is never adopted or silently discarded. The broker hard-links its exact
canonical bytes into the root-owned mode-0500
`.authenticated-quarantine` namespace under a source-name and content digest,
fsyncs that handoff, removes the ambiguous staging name, and reconciles every
power-loss cut before accepting an independently authenticated successor.
If the legacy stage had already been linked to its final alias, the quarantine
handoff temporarily accounts for all three names, removes and fsyncs the
unproven alias before removing the stage, and requires the quarantine object to
settle at one link. A restart at the quarantine link, alias unlink, or stage
unlink resumes that exact handoff; it cannot leave the ambiguous alias in the
authority namespace or treat it as the requested successor.
Terminal artifact reconciliation also quarantines every reserved journal temp
left by a crash before rename, including malformed or unsafe entries, before it
uses a committed publication journal.
All remaining plan, launch, proof-request, bundle, and secret inputs use
centralized descriptor-relative readers, including the service-owned retention
state reader. JSON parsing and HMAC key-ID selection complete synchronously
while the exact file, final parent, and ancestor chain remain pinned; an
asynchronous consumer is rejected. The returned object is the already consumed
in-memory snapshot, so a pathname replacement after the protected handoff
cannot select different authority bytes for recomputation or publication.
After the synchronous consumer completes, the reader repeats the bounded
descriptor read, metadata comparison, named no-follow reopen, parent comparison,
and complete named-ancestor traversal before it releases any pin. Replacement,
same-inode rewrite, deletion, or a parent-name swap during that consumer
therefore fails the operation instead of being tolerated merely because the
consumer already copied the earlier bytes.
Qualification launch, proof-runtime request creation, and the real
Lean/retention gates verify their independent subject, campaign, deployment,
key, and plan-signature boundaries inside that synchronous handoff. Production
control-bundle ingestion verifies its independently pinned identities and
closed committed-program boundary there before command-level signature and
evidence recomputation consumes the same in-memory snapshot.
Retention installation is a signed two-phase successor protocol:
`install_pending` records and reads back the exact pinned unit pair and fresh
manager identity, the manager is re-inspected, and only then may the installed
wait be promoted. Drift records an explicit invalidation/repair phase and
requires retry rather than reporting installation complete.
The version-3 installation receipt carries systemd's exact 32-hex-character timer
`InvocationID` in addition to the complete manager-identity digest. The signed
wait and installed/repair journal transition must carry the same token, and it
must equal the timer generation in every promotion and protected-handoff
inspection. Version-1 receipts (without a generation) and version-2 receipts
(with only an opaque generation-bound digest) remain readable solely so an
idempotent repair can supersede them; neither may authorize a fresh successful
installation return.
If the confirmed installation journal is durable but authority changes before
the installed wait CAS begins, a predecessor-linked
`install_invalidated` transition records a pre-promotion failure while the wait
remains `timerInstalled=false`. This is distinct from post-promotion
invalidation, and journal validation binds the reason to the actual wait phase;
both paths require an authenticated repair successor and retry.
The installed-wait CAS is also treated as an uncertain commit boundary. If its
pinned predecessor check fails, or rename succeeds but the committed readback
cannot be authenticated, the broker reopens the protected wait name. It records
a signed pre-promotion or post-promotion invalidation only when those exact
states are observable; a missing, foreign, or unsafe name records
`promotion_outcome_unobservable` instead of guessing. Every outcome blocks
firing and release until an idempotent repair successor rebinds the current
manager generation, durable unit pair, and exact wait state. Repair revision
numbers are derived only from the predecessor-linked wait states that were
actually published; a confirmed repair abandoned at an unobservable CAS does
not fabricate an installed-wait revision.
Each manager inspection is itself a two-pass snapshot: the service property
set, timer property set, and D-Bus `ExecStartEx` value must be byte-for-byte
identical across both passes. A manager removal, invocation rotation, trigger
change, or activation transition during that multi-call observation therefore
cannot become a hybrid generation receipt; the current journal phase remains
retryable and no installed or released successor is authorized from it.
Every retention unit critical section is structurally paired with a final
pinned authority-consumption section; the handoff must explicitly acknowledge
that it consumed the exact successor, manager generation, and unit observation.
A commit-only call or an unacknowledged handoff is rejected. Unit drift after
that consumption but before the final pin releases invalidates an installed
promotion and enters the same signed repair protocol.
The protected handoff also reopens and authenticates the state successor itself.
Installation consumes the exact installed wait and its installation journal;
the first due transition consumes the exact fired journal before candidate
release construction; release consumes the exact release file, released
journal, and released wait.
Protected retention-state reads, lock acquisition, and CAS publication also
retain every directory descriptor from the filesystem root through any
service-owned descendant parent. Before and after synchronous consumption or
publication they rewalk every name with no-follow directory opens and require
the same device, inode, mount, owner, group, and mode identity. Renaming a
nested parent can therefore neither make the service
consume a detached predecessor nor make a CAS successor succeed in a detached
tree.
An existing retention-state publication target is bounded to one MiB before
allocation, read twice from one nonblocking no-follow descriptor, matched to a
fresh named descriptor and the pinned parent/ancestor chain, and retained
through the CAS commit. JSON predecessors must be the exact canonical bytes
whose record digest names the transition. The committed successor is then
reopened and authenticated before the operation returns; a copied-then-rewritten
predecessor, oversized state file, lexical JSON alias, name substitution, or
detached-parent commit fails closed rather than being adopted or overwritten.
Deletion or rollback at these boundaries cannot inherit the earlier readback:
the operation fails from an explicit signed predecessor/repair phase and an
idempotent retry must re-establish the exact successor. In particular, a fired
journal rollback observed before or during the final pinned consumption fails
before candidate-visible release bytes are constructed or published.
Retention release retries likewise require the current system manager to
retain the exact fired service/timer identity and `LastTriggerUSec` while the
root-owned durable unit pair is pinned and re-read. Release construction, the
release-file CAS/readback, the released-journal CAS/readback, and the
released-wait CAS/readback each inspect the same manager invocation and
`LastTriggerUSec` before and after the successor commit and again during the
protected unit handoff. Before the first fired transition, the running
production process must also consume systemd's `INVOCATION_ID` and match it to
the live service `InvocationID`; the manager's `MainPID` must be the running
process and `ControlPID` must be zero. The journal persists that service
invocation and main PID, the timer `InvocationID`, `LastTriggerUSec`, and the
exact manager/unit digests as a truth-bounded manager-firing receipt. The
released journal and final wait consume its digest; the final release receipt
also records the service invocation and main PID performing that commit while
retaining the same timer generation.
A restarted oneshot may retry an already committed successor only after
re-observing that timer generation. Installed version-2 journals migrate by an
authenticated CAS/readback to version 3 before firing; a legacy journal that
already crossed the firing boundary is rejected rather than upgraded from an
unissued receipt. A durable fired journal therefore does not turn clean manager
absence after a reboot, query failure, or cached-property drift into release
authority; recovery must observe the exact reloaded firing.

## Claim boundary

Writing, validating, migrating, or testing this source does not create
mathematical capability, alter model weights, demonstrate retention, confer a
degree, or establish research novelty. Fixture campaigns are categorically
ineligible. A future true `phd_math_qualified` value would mean only that every
bounded authenticated gate passed for the exact reported subject, deployment,
and evidence bundle.
