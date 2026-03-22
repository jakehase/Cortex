# Oracle bridge and other levels

## Important context

The public repo does not currently mirror the entire live Oracle and multi-level implementation surface.
That is intentional in part, because some of the live deployment artifacts are mixed with auth state, machine-specific config, or operational internals.

## What is novel here

### Oracle bridge reliability work
The Oracle layer is not just a generic LLM wrapper. The live work includes:
- dedicated Oracle executor/runtime paths
- Oracle-session hygiene and cleanup rules
- route-gate bypass for internal Oracle executor sessions/prompts
- quarantine of oversized Oracle bridge sessions
- tighter session isolation to avoid poisoned long-lived executor sessions

### Multi-level routing work
The novelty is not simply that there are many levels.
The more interesting part is that routing and orchestration patterns are explicit.

Examples:
- research chain
- coding chain
- creativity-governor overlay
- L9 complexity-driven activation
- always-on/meta stack behavior

### Capability / control-plane work
Cortex also includes a more unusual implementation-state discipline:
- capability registry
- preflight checks
- coded vs live vs verified distinctions
- contradiction-aware upgrade planning

## What is public-safe to explain now
- routing patterns
- Oracle bridge design goals
- level-governor concepts
- capability-guard/control-plane concepts
- public-safe tests for route-gate behavior

## What should remain private unless rewritten
- auth-bearing deploy artifacts
- machine-specific OpenClaw homes
- private service credentials and keys
- directly copy-pasted operational deployment bundles

## Direction

The public repo should increasingly reflect the implementation reality, but through:
- public-safe mirrors
- stripped reference implementations
- architecture and test docs

not by dumping live operational state.
