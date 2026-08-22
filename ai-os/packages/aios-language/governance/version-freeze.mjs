import { createHash } from "node:crypto";

import { KEYWORDS, SYMBOLS } from "../source/tokens.mjs";

export const AIOS_LANGUAGE_FREEZE_SCHEMA = "aios.language.freeze-policy.v1";
export const AIOS_LANGUAGE_REVIEW_SCHEMA = "aios.language.v1.1-review.v1";
export const AIOS_CANONICAL_LANGUAGE_VERSION = "aios.language.v1";
export const AIOS_CANONICAL_GRAMMAR = "job-block-v1";
export const AIOS_CANONICAL_COMPILER = "aios.language.compiler.canonical.v1";
export const AIOS_CANONICAL_SOURCE_EXTENSION = ".aios";
export const AIOS_V1_RUNTIME_OPERATIONS = Object.freeze([
  "kernel.echo",
  "kernel.record",
  "kernel.artifact.status",
  "kernel.complete",
  "process.admit",
  "process.transition",
  "provider.read",
  "provider.compute",
]);

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableClone(value));
}

export function languageSurfaceDigest(surface = currentCanonicalLanguageSurface()) {
  return createHash("sha256").update(stableJson(surface)).digest("hex");
}

export function currentCanonicalLanguageSurface() {
  return Object.freeze({
    languageVersion: AIOS_CANONICAL_LANGUAGE_VERSION,
    grammar: AIOS_CANONICAL_GRAMMAR,
    compiler: AIOS_CANONICAL_COMPILER,
    sourceExtension: AIOS_CANONICAL_SOURCE_EXTENSION,
    keywords: Object.freeze([...KEYWORDS].sort()),
    symbols: Object.freeze([...SYMBOLS].sort()),
    runtimeOperations: AIOS_V1_RUNTIME_OPERATIONS,
  });
}

function surfaceDelta(expected = {}, actual = {}) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap((key) => {
    const before = expected[key];
    const after = actual[key];
    if (stableJson(before) === stableJson(after)) return [];
    return [{ key, expected: before ?? null, actual: after ?? null }];
  });
}

export function evaluateLanguageFreeze({ policy = {}, surface = currentCanonicalLanguageSurface(), review = null } = {}) {
  const errors = [];
  if (policy.schemaVersion !== AIOS_LANGUAGE_FREEZE_SCHEMA) errors.push("AIOS_LANGUAGE_FREEZE_SCHEMA_INVALID");
  if (policy.status !== "frozen") errors.push("AIOS_LANGUAGE_V1_NOT_FROZEN");
  if (policy.languageVersion !== AIOS_CANONICAL_LANGUAGE_VERSION) errors.push("AIOS_LANGUAGE_FREEZE_VERSION_MISMATCH");
  const delta = surfaceDelta(policy.frozenSurface ?? {}, surface);
  const surfaceChanged = delta.length > 0;
  let reviewAccepted = false;
  if (surfaceChanged) {
    reviewAccepted = review?.schemaVersion === AIOS_LANGUAGE_REVIEW_SCHEMA
      && review?.status === "approved_v1_1_surface_change"
      && Number(review?.evidence?.successfulRuns ?? 0) >= Number(policy?.v1_1Review?.minimumSuccessfulRuns ?? 20)
      && review?.approval?.explicit === true
      && typeof review?.approval?.approvedBy === "string"
      && review.approval.approvedBy.trim().length > 0;
    if (!reviewAccepted) errors.push("AIOS_LANGUAGE_SURFACE_CHANGE_REQUIRES_APPROVED_EVIDENCE");
  }
  return Object.freeze({
    ok: errors.length === 0,
    schemaVersion: AIOS_LANGUAGE_FREEZE_SCHEMA,
    status: errors.length === 0 ? "green" : "blocked",
    languageVersion: AIOS_CANONICAL_LANGUAGE_VERSION,
    freezeStatus: policy.status ?? null,
    allowedChangeClasses: Object.freeze([...(policy.allowedChangeClasses ?? [])]),
    surfaceChanged,
    reviewAccepted,
    expectedDigest: languageSurfaceDigest(policy.frozenSurface ?? {}),
    actualDigest: languageSurfaceDigest(surface),
    delta: Object.freeze(delta),
    errors: Object.freeze(errors),
  });
}

export function evaluateV11Evidence(entries = [], policy = {}) {
  const successful = entries.filter((entry) => entry?.status === "green" && entry?.claimStatus === "allowed");
  const friction = successful.flatMap((entry) => (entry.friction ?? []).map((event) => ({
    code: String(event.code ?? "unspecified"),
    detail: String(event.detail ?? ""),
    runId: entry.runId,
    workflowId: entry.workflowId,
  })));
  const grouped = new Map();
  for (const event of friction) {
    const row = grouped.get(event.code) ?? { code: event.code, occurrences: 0, runs: new Set(), workflows: new Set(), details: new Set() };
    row.occurrences += 1;
    row.runs.add(event.runId);
    row.workflows.add(event.workflowId);
    if (event.detail) row.details.add(event.detail);
    grouped.set(event.code, row);
  }
  const requirements = {
    minimumSuccessfulRuns: Number(policy?.v1_1Review?.minimumSuccessfulRuns ?? 20),
    minimumOccurrences: Number(policy?.v1_1Review?.minimumCandidateOccurrences ?? 3),
    minimumDistinctRuns: Number(policy?.v1_1Review?.minimumDistinctRuns ?? 3),
    minimumDistinctWorkflows: Number(policy?.v1_1Review?.minimumDistinctWorkflows ?? 2),
  };
  const candidates = [...grouped.values()].map((row) => ({
    code: row.code,
    occurrences: row.occurrences,
    distinctRuns: row.runs.size,
    distinctWorkflows: row.workflows.size,
    details: [...row.details],
    eligible: row.occurrences >= requirements.minimumOccurrences
      && row.runs.size >= requirements.minimumDistinctRuns
      && row.workflows.size >= requirements.minimumDistinctWorkflows,
  })).sort((a, b) => b.occurrences - a.occurrences || a.code.localeCompare(b.code));
  const enoughRuns = successful.length >= requirements.minimumSuccessfulRuns;
  const eligibleCandidates = candidates.filter((candidate) => candidate.eligible);
  const status = !enoughRuns
    ? "insufficient_evidence"
    : eligibleCandidates.length > 0
      ? "eligible_for_v1_1_design_review"
      : "keep_v1_frozen";
  return Object.freeze({
    schemaVersion: AIOS_LANGUAGE_REVIEW_SCHEMA,
    status,
    generatedAt: new Date().toISOString(),
    evidence: Object.freeze({
      totalRuns: entries.length,
      successfulRuns: successful.length,
      workflowCount: new Set(successful.map((entry) => entry.workflowId)).size,
      frictionEventCount: friction.length,
    }),
    requirements: Object.freeze(requirements),
    candidates: Object.freeze(candidates),
    eligibleCandidates: Object.freeze(eligibleCandidates),
    decision: Object.freeze({
      automaticLanguageChangeAllowed: false,
      recommendation: status === "eligible_for_v1_1_design_review"
        ? "Review recurring evidence with the operator; do not change the language until explicitly approved."
        : status === "keep_v1_frozen"
          ? "Keep AIOS v1 frozen; no recurring workflow friction justifies a v1.1 surface change."
          : "Collect more successful recurring workflow executions before considering v1.1.",
    }),
  });
}
