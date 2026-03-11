# Cortex Deploy (Source-of-Truth Mode)

## Canonical rule

For Cortex code changes, treat the git-backed source tree as the edit surface and the VM host tree as the deploy surface:

- **edit source here first:** `/opt/clawdbot`
- **deploy host tree on Cortex VM:** `/opt/clawdbot`
- **live runtime mount:** `/app/cortex_server`

The live container must keep this canonical bind mount:

- `/opt/clawdbot/cortex_server/cortex_server -> /app/cortex_server`

## Hard rule

**Do not hotfix `/app` directly** unless it is an emergency.

If an emergency live fix is ever applied first, backport the same change into the source tree immediately before considering the task complete.

## Safe deploy path

Use the path-scoped repo-to-VM deploy helper:

```bash
cd /opt/clawdbot
CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh cortex_server/cortex_server/routers/nexus.py
```

Check the canonical runtime mount only:

```bash
cd /opt/clawdbot
CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh --check-only
```

Sync without restarting:

```bash
cd /opt/clawdbot
CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh --no-deploy docs/DEPLOY.md scripts/deploy_to_cortex_vm.sh
```

## Why path-scoped deploys for now?

The public git-backed source repo is not yet fully reconciled with the richer live VM tree, so a blind full-tree overwrite would risk clobbering good runtime state.

For now, use **path-scoped source-of-truth deploys** for the files you intentionally changed.

## Desired end state

Long-term, every Cortex fix should follow this order:

1. edit source tree
2. deploy to VM host tree
3. live container picks it up via canonical mount/recreate
4. public export/autosync sees the same source change

That avoids repo/runtime drift and prevents “fixed live but not pushed” repeats.
