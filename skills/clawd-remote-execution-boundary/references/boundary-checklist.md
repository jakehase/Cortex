# Boundary checklist

## Prelaunch

Confirm all of these before a heavy run:
- requested fidelity
- scope
- stop condition
- execution boundary
- remote launcher path
- sync path for changed shared files
- supervisor placement
- notifier placement
- artifact root and return path

## Sync proof

When shared runtime/control-plane code changed, verify the remote boundary includes those files.
Examples in this workspace often include:
- `packages/multi-agent-orchestrator/index.mjs`
- `packages/system-benchmark/index.mjs`
- `packages/campaign-runtime/index.mjs`
- task-contract / issue-dag / surface-matrix helpers if the launch path depends on them

## Red flags

Stop and write a blocker if you see:
- heavy run planned locally without explicit exception
- no clear sync path
- no remote artifact proof
- notifier depends on the heavy worker surviving
- completion claim depends on chat summary rather than returned artifacts

## Postlaunch

Verify:
- remote run id
- artifact root
- worker/supervisor evidence
- remote code actually included the intended patch
