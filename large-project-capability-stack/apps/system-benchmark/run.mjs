#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { profileClawhip, profileCortex, compareSystems, renderComparisonReport } from '../../packages/system-benchmark/index.mjs';

const clawhipRoot = path.resolve(process.argv[2] || '/root/clawd/tmp_clawhip');
const stackRoot = path.resolve(process.argv[3] || '/root/clawd/large-project-capability-stack');
const mailchimpRoot = path.resolve(process.argv[4] || '/root/clawd/mailchimp-clone');
const artifactRoot = path.resolve(process.argv[5] || '/root/clawd/large-project-capability-stack/artifacts/benchmarks/cortex_vs_clawhip');
fs.mkdirSync(artifactRoot, { recursive: true });

const clawhip = profileClawhip({ repoRoot: clawhipRoot });
const cortex = profileCortex({ stackRoot, mailchimpRoot });
const result = compareSystems({ cortex, clawhip });

const jsonPath = path.join(artifactRoot, 'comparison.json');
const mdPath = path.join(artifactRoot, 'comparison_report.md');
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
fs.writeFileSync(mdPath, renderComparisonReport(result));

console.log(JSON.stringify({
  ok: true,
  artifactRoot,
  jsonPath,
  mdPath,
  overall: result.overall
}, null, 2));
