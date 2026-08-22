# Restore and backup

## Public vs private backup model

This project uses two different backup surfaces:

### Public repo
The public repo is for:
- public-safe code
- docs
- public-facing architecture/story
- safe reference material

It is **not** the right place for:
- memories
- auth blobs
- private keys
- OAuth tokens
- sensitive runtime state

### Private backup repo
A separate private backup repo should hold:
- sanitized workspace snapshots
- memories
- restore checklists
- restore helper scripts

## Restore philosophy

A good restore backup should recover:
- workspace files
- docs
- plugins/scripts
- memories
- enough structure to rebuild the system quickly

But it should still exclude:
- machine secrets
- private keys
- provider tokens
- highly sensitive app/runtime state

## Recommended restore flow

1. clone the private backup repo
2. restore the latest sanitized workspace snapshot
3. recreate secrets from secure stores
4. validate OpenClaw config and restart gateway
5. test browser, memory, and channel behavior

## Operator note

The safest backup is not the one that stores everything.
It is the one that restores the system well **without** turning GitHub into a secret dump.
