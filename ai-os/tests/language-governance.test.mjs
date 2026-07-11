import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCanonicalAiosSource } from "../packages/aios-language/canonical.mjs";
import {
  AIOS_LANGUAGE_REVIEW_SCHEMA,
  currentCanonicalLanguageSurface,
  evaluateLanguageFreeze,
  evaluateV11Evidence,
} from "../packages/aios-language/governance/version-freeze.mjs";
import {
  PROVIDER_WORKFLOWS,
  renderProviderComputeSource,
  renderProviderReadSource,
  stableHash,
} from "../packages/aios-language/workflows/provider-dogfood.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const freezePolicy = JSON.parse(fs.readFileSync(path.join(root, "kernel", "policy", "language-v1-freeze.json"), "utf8"));
const providerPolicy = JSON.parse(fs.readFileSync(path.join(root, "kernel", "policy", "provider-read-compute.json"), "utf8"));

test("AIOS v1 frozen surface matches the canonical compiler surface", () => {
  const result = evaluateLanguageFreeze({ policy: freezePolicy });
  assert.equal(result.ok, true);
  assert.equal(result.surfaceChanged, false);
  assert.equal(result.expectedDigest, result.actualDigest);
  assert.deepEqual(result.allowedChangeClasses, ["bugfix", "security", "compatibility"]);
});

test("surface changes remain blocked without evidence and explicit approval", () => {
  const changed = { ...currentCanonicalLanguageSurface(), runtimeOperations: [...currentCanonicalLanguageSurface().runtimeOperations, "provider.future"] };
  const noReview = evaluateLanguageFreeze({ policy: freezePolicy, surface: changed });
  assert.equal(noReview.ok, false);
  assert.ok(noReview.errors.includes("AIOS_LANGUAGE_SURFACE_CHANGE_REQUIRES_APPROVED_EVIDENCE"));
  const evidenceOnly = evaluateLanguageFreeze({
    policy: freezePolicy,
    surface: changed,
    review: { schemaVersion: AIOS_LANGUAGE_REVIEW_SCHEMA, status: "eligible_for_v1_1_design_review", evidence: { successfulRuns: 20 } },
  });
  assert.equal(evidenceOnly.ok, false);
  const explicitlyApproved = evaluateLanguageFreeze({
    policy: freezePolicy,
    surface: changed,
    review: {
      schemaVersion: AIOS_LANGUAGE_REVIEW_SCHEMA,
      status: "approved_v1_1_surface_change",
      evidence: { successfulRuns: 20 },
      approval: { explicit: true, approvedBy: "operator" },
    },
  });
  assert.equal(explicitlyApproved.ok, true);
  assert.equal(explicitlyApproved.reviewAccepted, true);
});

test("canonical compiler rejects undeclared future kernel operators under the v1 freeze", () => {
  const source = `job futureOperator {
    capability aios.status: read @internal;
    step inspect uses kernel.future() -> status recover halt;
    verify status exists;
    truth state: source="artifact", confidence="observed";
    rollback halt;
  }`;
  const result = compileCanonicalAiosSource(source, { sourceName: "future.aios" });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "AIOS_CANONICAL_RUNTIME_ADAPTER_BLOCKED"));
});

test("three recurring workflows compile using only frozen provider read and compute operations", () => {
  assert.deepEqual(Object.keys(PROVIDER_WORKFLOWS).sort(), ["contradiction-review", "implementation-brief", "research-synthesis"]);
  const evidence = { results: [{ text: "canonical fact" }] };
  for (const workflowId of Object.keys(PROVIDER_WORKFLOWS)) {
    const read = renderProviderReadSource({ workflowId, query: "canonical project truth" });
    const compute = renderProviderComputeSource({ workflowId, query: "canonical project truth", retrievedEvidence: evidence });
    const readResult = compileCanonicalAiosSource(read, { sourceName: `${workflowId}-read.aios`, providerPolicy });
    const computeResult = compileCanonicalAiosSource(compute, { sourceName: `${workflowId}-compute.aios`, providerPolicy });
    assert.equal(readResult.ok, true, JSON.stringify(readResult.diagnostics));
    assert.equal(computeResult.ok, true, JSON.stringify(computeResult.diagnostics));
    assert.deepEqual(readResult.jobs[0].syscalls.map((entry) => entry.op), ["provider.read"]);
    assert.deepEqual(computeResult.jobs[0].syscalls.map((entry) => entry.op), ["provider.compute"]);
    assert.ok(compute.includes(stableHash(evidence)));
  }
});

test("provider prompts preserve quoted commas, semicolons, and recovery words", () => {
  const evidence = { note: "first, second; recover this -> only as evidence", nested: { status: "observed" } };
  const source = renderProviderComputeSource({ workflowId: "research-synthesis", query: "review evidence", retrievedEvidence: evidence });
  const result = compileCanonicalAiosSource(source, { sourceName: "quoted-provider-prompt.aios", providerPolicy });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(Object.keys(result.jobs[0].syscalls[0].args).sort(), ["model", "prompt", "provider", "response_mode"]);
  assert.match(result.jobs[0].syscalls[0].args.prompt, /first, second; recover this -> only as evidence/);
});

function successfulEntry(index, workflowId, friction = []) {
  return {
    runId: `run-${index}`,
    workflowId,
    status: "green",
    claimStatus: "allowed",
    friction,
  };
}

test("twenty green runs without recurring friction keep v1 frozen", () => {
  const workflows = Object.keys(PROVIDER_WORKFLOWS);
  const entries = Array.from({ length: 20 }, (_, index) => successfulEntry(index, workflows[index % workflows.length]));
  const review = evaluateV11Evidence(entries, freezePolicy);
  assert.equal(review.status, "keep_v1_frozen");
  assert.equal(review.evidence.successfulRuns, 20);
  assert.equal(review.evidence.workflowCount, 3);
  assert.equal(review.decision.automaticLanguageChangeAllowed, false);
});

test("recurring friction only opens design review and never auto-changes the language", () => {
  const workflows = Object.keys(PROVIDER_WORKFLOWS);
  const entries = Array.from({ length: 20 }, (_, index) => successfulEntry(
    index,
    workflows[index % workflows.length],
    index < 3 ? [{ code: "repeated-manual-binding", detail: "same missing primitive" }] : [],
  ));
  const review = evaluateV11Evidence(entries, freezePolicy);
  assert.equal(review.status, "eligible_for_v1_1_design_review");
  assert.equal(review.eligibleCandidates.length, 1);
  assert.equal(review.decision.automaticLanguageChangeAllowed, false);
});
