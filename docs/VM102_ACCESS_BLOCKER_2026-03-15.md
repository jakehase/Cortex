# VM102 access blocker — 2026-03-15

Attempted read-only SSH to likely VM102 host:
- Host: `10.0.0.52`
- User: `root`
- Key: `~/.ssh/id_ed25519`

Result:
- `Permission denied (publickey)`

Meaning:
- rollout cannot be honestly applied to VM102 from this session yet
- local rollout artifacts have been prepared in `/root/clawd`
- next required step is granting SSH access for the deployment user/key, or providing the correct VM102 host/user/key path
