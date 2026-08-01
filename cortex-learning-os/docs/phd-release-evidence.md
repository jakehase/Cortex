# PhD release evidence

Commit and tree delivery identity is intentionally not stored in a tracked report
inside the commit it describes. A release operator must create an external,
signed record after the commit exists. That record must bind:

- the exact commit and tree;
- the test-tier transcript digests;
- the deployed public trust policy and authority key fingerprints;
- the exact canonical proof-runtime attestation bytes and record, full signed
  runtime/product/deployment/trust manifests, digest, authority ID, and
  verification-key digest;
- the full independent replay evidence and receipt, including proof-runtime
  identity equality and distinct `proof_runtime`/`proof_replay` authority IDs
  and verification-key digests;
- the production control-plane and execution-plane identities.

The repository contains no current live acquisition, retention, qualification,
proof, specialization, research, or PhD-capability evidence. Structural
validation and synthetic tests cannot populate an external release record or
make a live claim.
