# AI OS Filesystem Layout

Wave 0 namespace contract for hosted AI OS.

```text
/aios
  /kernel       # trusted contracts, runtime, policy, audit
  /processes    # process state records
  /jobs         # job definitions and run contracts
  /memory       # memory mount manifests and snapshots
  /artifacts    # content-addressed evidence bundles
  /claims       # claim records linked to evidence
  /verifiers    # verifier contracts and results
  /tools        # syscall/tool descriptors
  /drivers      # driver packages and adapters
  /packages     # AI OS packages
  /apps         # userland apps
  /users        # owner/operator profiles and policies
  /world        # external world-state snapshots
  /audit        # append-only event stream
  /quarantine   # unsafe/stale/superseded paths
```

This layout is a contract. Implementation comes in later waves.
