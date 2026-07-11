#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentCanonicalLanguageSurface,
  evaluateLanguageFreeze,
} from "../packages/aios-language/governance/version-freeze.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};
const policyPath = path.resolve(valueAfter("policy") || path.join(root, "kernel", "policy", "language-v1-freeze.json"));
const reviewPath = valueAfter("review") ? path.resolve(valueAfter("review")) : null;
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const review = reviewPath ? JSON.parse(fs.readFileSync(reviewPath, "utf8")) : null;
const result = evaluateLanguageFreeze({ policy, surface: currentCanonicalLanguageSurface(), review });
const packet = { ...result, policyPath, reviewPath };
console.log(JSON.stringify(packet, null, 2));
if (!result.ok) process.exitCode = 1;
