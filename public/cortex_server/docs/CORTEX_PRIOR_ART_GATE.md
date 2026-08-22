# Cortex Prior-Art Gate

The prior-art gate is a pre-implementation memory/product check. Its job is to catch existing Cortex/shared-stack capabilities before a new implementation creates a parallel architecture.

## What it searches

- durable memory via Librarian robust recall,
- project memory / local-file fallback rows,
- Cortex structural code graph nodes,
- optional workspace file scans from the CLI.

## Decisions

The gate returns one of:

- `reuse_existing`
- `extend_existing`
- `adapter_wrapper_only`
- `extend_existing_or_adapter_required`
- `new_primitive_justified`
- `no_prior_art_found`

If high-confidence prior art exists and the proposed action is `new_primitive`, `new_capability`, `independent_implementation`, or unspecified, the gate blocks with `high_confidence_prior_art_requires_reuse_or_extension`.

## API

```http
POST /knowledge/prior-art-gate
```

Payload:

```json
{
  "objective": "Implement a run ledger / release packet",
  "planned_capabilities": ["run ledger", "release packet"],
  "planned_paths": ["packages/synthetic-labor-os/index.mjs"],
  "proposed_action": "adapter_wrapper_only"
}
```

## CLI

```bash
python3 public/cortex_server/scripts/prior_art_gate.py \
  --objective "Implement SLOS v19 run ledger / release packet as an adapter" \
  --capability "run ledger" \
  --capability "release packet" \
  --capability "proof carrying claim ledger" \
  --proposed-action adapter_wrapper_only
```

## Truth boundary

This is a recall/preflight gate. It can prove that prior art was searched and that a reuse/extend/adapter decision was made. It does not prove the recalled implementation is currently correct without live validation.
