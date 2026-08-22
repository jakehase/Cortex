# Epistemic memory

## Core idea

Memory should not behave like a bag of vaguely similar text.

Cortex is moving toward memory that distinguishes between:
- fast recall
- reconcile
- investigate
- noisy/internal junk
- clean-but-empty

## Why this matters

Normal similarity retrieval fails badly when the real question is:
- what is the latest truth?
- what changed?
- what did we decide in the end?
- is this memory noisy or trustworthy?

## Intended behavior

### Fast recall
Use when the answer is probably simple and stable.

### Reconcile
Use when multiple candidate truths may exist and newer/clearer facts should win.

### Investigate
Use when the question is timeline-heavy, contradiction-heavy, or multi-session.

### Internal noise suppression
Do not treat internal traces or repetitive system chatter like user memory.

### Clean-but-empty
If memory is clean after noise suppression but still has nothing useful, say so explicitly.

## Distinctive claim

The novelty is not "we have memory." The novelty is trying to make memory behave more like an epistemic system than a similarity bucket.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

