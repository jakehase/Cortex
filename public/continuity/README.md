# Cortex volume continuity

Production startup reads deployment-specific volume IDs from this host-backed
directory and refuses a named volume whose in-volume marker is absent.

Provision distinct strong random values for `CORTEX_CHROMA_MOUNT_ID`,
`CORTEX_KNOWLEDGE_MOUNT_ID`, `CORTEX_RUNTIME_DELIVERY_MOUNT_ID`,
`CORTEX_APP_STATE_MOUNT_ID`, `CORTEX_REASONING_MOUNT_ID`,
`CORTEX_RELEASE_VERIFIER_STATE_MOUNT_ID`, and
`CORTEX_RELEASE_MANAGER_STATE_MOUNT_ID`. Then run the one-time bootstrap
explicitly. The bootstrap copies the packaged graph seed and initializes empty
controller observation ledgers; ordinary production startup never recreates a
missing database, ledger, marker, or manifest.

```sh
docker compose --profile bootstrap run --rm cortex-volume-bootstrap
```

To adopt a stopped `fd77a712` deployment, keep its named volumes, set the new
random IDs above, and leave the source marker IDs at their old values (normally
`cortex-chroma-v1` and `cortex-runtime-delivery-v1`). If that deployment used
custom marker IDs, also set `CORTEX_SOURCE_CHROMA_MOUNT_ID` and
`CORTEX_SOURCE_RUNTIME_DELIVERY_MOUNT_ID`. Stop Cortex without deleting volumes,
back up the source volumes and this directory, then run:

```sh
docker compose down
docker compose --profile adopt-source run --rm cortex-volume-adopt-source
```

The adoption has explicit source byte and entry bounds, validates the source
markers and layout, copies the split application, reasoning, and knowledge
state while retaining the runtime-delivery volume, and fsyncs a phase journal.
It publishes continuity manifests only after every copy and controller-ledger
initialization succeeds. An interrupted run with the same IDs is safe to rerun;
a completed rerun validates the published volume set and performs no copies.
Increase `CORTEX_ADOPTION_MAX_SOURCE_BYTES` or
`CORTEX_ADOPTION_MAX_SOURCE_ENTRIES` only to a reviewed finite limit when the
stopped source backup is known to exceed the defaults.

Back up this directory separately from all named volumes. Do not run bootstrap
to replace a lost volume; restore the volume and its matching continuity
manifest instead.
