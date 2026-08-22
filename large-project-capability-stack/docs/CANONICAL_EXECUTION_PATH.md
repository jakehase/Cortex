# Canonical execution path

The only active implementation path is:

```text
OpenClaw -> Cortex -> Agent Work contract -> remote Codex workers -> independent verifier -> artifact-backed OpenClaw delivery
```

## Ownership

- OpenClaw owns interaction, approval boundaries, and reliable delivery.
- Cortex owns grounding, routing, planning, policy, and supervision.
- Agent Work owns the run contract, surface matrix, work graph, and controller input.
- Codex workers own bounded implementation on the execution plane.
- Full Parity Engine and project-specific acceptance checks own independent truth.
- Cortex Learning OS may consume completed evidence offline; it never controls a live run.

## Deprecation map

| Path | State | Allowed use |
|---|---|---|
| Agent Work CLI + canonical facade | canonical | All new implementation runs |
| Agent Work objective controller | internal implementation | Reached through the facade; not a product entrypoint |
| SLOS v19 | compatibility only | Translate historical release packets; no new runtime primitives |
| SLOS v20 hard-dogfood RC | mechanism donor | Port proven gates into Agent Work; do not become a second default runtime |
| SLOS v1-v18 | quarantined | Audit and replay only |
| AI OS adapter | bounded bridge | Internal status/recovery/handoff only |
| Direct Codex wrappers | quarantined | Historical evidence only |
| Artifact snapshot repositories | evidence only | Never an active source path |

## Commands

Compile only on the control plane:

```bash
npm run agent-work:canonical:compile -- handoff.json --out artifacts/run-id
```

Execute only with `BENCHMARK_HOST_ROLE=execution_plane` when the contract declares `remote_execution_required`:

```bash
npm run agent-work:canonical:run -- artifacts/run-id
```

The command fails closed rather than silently running heavy work locally.
