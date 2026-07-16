# Cortex volume continuity

Production startup reads deployment-specific volume IDs from this host-backed
directory and refuses a named volume whose in-volume marker is absent.

Provision strong random values for `CORTEX_CHROMA_MOUNT_ID` and
`CORTEX_RUNTIME_DELIVERY_MOUNT_ID`, then run the one-time bootstrap explicitly:

```sh
docker compose --profile bootstrap run --rm cortex-volume-bootstrap
```

Back up this directory separately from both named volumes. Do not run bootstrap
to replace a lost volume; restore the volume and its matching continuity
manifest instead.
