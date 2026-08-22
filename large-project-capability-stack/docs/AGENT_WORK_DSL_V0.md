# Agent Work DSL v0

A thin AI-readable layer over the existing orchestration run contract.

It is intentionally small: define the goal, fidelity, permissions, surfaces, verifiers, and done conditions; compile it into `run_contract.json`, `surface_matrix.json`, and `work_graph.json`.

Example:

```text
goal CurrentOrchestrationRepair
repo /path/to/repo
fidelity parity_for_scope
agents 10
allow read_repo, write_product_code, run_tests
forbid relaunch_benchmark, external_send, touch_prod
done all_surfaces_pass, full_npm_test_passes, no_truth_layer_overclaim

surface campaign_handoff
  label: Campaign handoff and telemetry
  files: packages/app/domain-campaigns.mjs, packages/app/job-handlers.mjs
  verify: node scripts/deep-architecture-verifier.mjs
```

Compile:

```bash
node apps/system-benchmark/compile-agent-work-dsl.mjs spec.aw --out artifacts/agent-work-dsl/current
```

Compile a Cortex handoff JSON into the same artifacts:

```bash
node apps/system-benchmark/compile-cortex-agent-work.mjs cortex_handoff.json --out artifacts/agent-work-dsl/current
```

Runners now accept either a compiled `run_contract.json`, a compiled artifact directory, or a raw Agent Work DSL spec:

```bash
node apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs spec.aw
node apps/system-benchmark/run-continuous-real-workload-controller.mjs spec.aw --dry-run
```

Guardrails in v0:

- refuses requested actions that are also forbidden, e.g. `relaunch_benchmark`
- flags verifier commands that appear to require forbidden capabilities
- blocks `full_clone` fidelity unless explicit parity evidence gates are declared
- preserves truth-layer policy in the generated run contract

This is not a replacement for implementation languages. It is a goal/permissions/verification language for agent orchestration.

## v0.1 orchestration policies

The next layer lets Cortex describe not just the initial surface graph, but how the run should stay productive when the first graph is exhausted or still red.

```text
goal MailchimpParityRepair
repo /path/to/repo
fidelity parity_for_scope
agents 20
forbid external_send, touch_prod, relaunch_benchmark
done all_surfaces_pass, no_truth_layer_overclaim

template node_test_surface
  lane: product_runtime
  verify: node --test {{test_path}}

budget
  token_cap: 24000000
  worker_prompt_tokens: 6000
  global_calls: 23

wave_policy
  max_waves: 24
  bundle_size: 5
  full_context_waves: 0
  handoff: wave_factpack

expansion_policy
  triggers: objective_red, graph_exhausted
  max_cycles: 20
  max_surfaces: 200
  strategy: decompose_missing_surfaces

evidence_schema productive_delta
  require: creative_product_delta_integrity >= 1
  require: verified_surface_count >= 1
  artifact: canonical_result_summary.json

surface campaign_delivery uses node_test_surface
  files: packages/app/campaigns.mjs
  test_path: tests/campaigns.test.mjs
```

Compiled artifacts now preserve:

- `scope.budgets` — token/call/runtime ceilings and worker prompt caps.
- `scope.wavePolicy` — wave count, bundling, full-context suppression, and handoff mode.
- `scope.expansionPolicy` — when to decompose new work instead of fake-greening or stopping early.
- `scope.evidenceSchemas` — named evidence gates/artifacts the truth layer should inspect.
- `templates` — reusable surface macros with `{{placeholder}}` substitution from surface metadata.

Unresolved template placeholders are compile errors. Policies are contract data; individual runners still decide which policies they enforce, and must report unsupported policy handling honestly in artifacts.

## Cortex handoff contract

Cortex should hand off serious orchestration work as `cortex.agent_work_handoff.v0` JSON with:

- objective / goal
- repoPath
- fidelity
- permissions allow/forbid
- surfaces with files and verifier commands
- optional budgets, wavePolicy, expansionPolicy, evidenceSchemas, and templates
- doneWhen / stopCondition
- route levels and memory citations when relevant

The shared stack owns compilation and execution. Cortex owns intent, routing, and provenance.
