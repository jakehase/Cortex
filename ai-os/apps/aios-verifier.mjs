#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBoundVerifierEvidence } from "../packages/aios-language/runtime/claim-evidence.mjs";

const AI_OS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_POLICY = path.join(AI_OS_ROOT, "kernel", "policy", "provider-read-compute.json");

function parseArgs(tokens) {
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function safePath(input, label) {
  if (!input) throw new Error(`${label} is required`);
  const resolved = path.resolve(input);
  if (resolved !== AI_OS_ROOT && !resolved.startsWith(`${AI_OS_ROOT}${path.sep}`) && !resolved.startsWith(`${path.resolve("/tmp")}${path.sep}`)) {
    throw new Error(`${label} must stay inside AI OS or /tmp`);
  }
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function verifyCurrentRun({ artifactRoot, jobPath, providerPolicyPath = DEFAULT_POLICY, now = new Date() } = {}) {
  const root = safePath(artifactRoot, "artifact root");
  const job = safePath(jobPath, "job");
  const policy = safePath(providerPolicyPath, "provider policy");
  const packet = createBoundVerifierEvidence({
    artifactRoot: root,
    job: readJson(job),
    bootProof: readJson(path.join(root, "packets", "boot-proof.packet.json")),
    runProof: readJson(path.join(root, "packets", "run-proof.packet.json")),
    providerPolicy: readJson(policy),
    tenantBoundary: readJson(path.join(root, ".aios-tenant-boundary.json")),
    now,
  });
  const packetPath = path.join(root, "packets", "verifier-evidence.packet.json");
  fs.mkdirSync(path.dirname(packetPath), { recursive: true });
  const temporaryPath = `${packetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, packetPath);
  return { ...packet, verifierPath: packetPath };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const packet = verifyCurrentRun({
      artifactRoot: args["artifact-root"],
      jobPath: args.job,
      providerPolicyPath: args["provider-policy"] || DEFAULT_POLICY,
    });
    console.log(JSON.stringify(packet, null, 2));
    if (!packet.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
