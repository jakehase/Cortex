#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildCodeValueAudit, renderCodeValueReport } from '../../packages/code-value-audit/index.mjs';

const repoRoot = path.resolve(process.argv[2] || '/root/clawd/mailchimp-clone');
const artifactRoot = path.resolve(process.argv[3] || '/root/clawd/large-project-capability-stack/artifacts/audits/mailchimp_clone_code_value');
fs.mkdirSync(artifactRoot, { recursive: true });

const audit = buildCodeValueAudit({ repoRoot });
const jsonPath = path.join(artifactRoot, 'code_value_audit.json');
const mdPath = path.join(artifactRoot, 'code_value_audit_report.md');

fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2));
fs.writeFileSync(mdPath, renderCodeValueReport(audit));

console.log(JSON.stringify({
  ok: true,
  repoRoot,
  artifactRoot,
  codeTestScriptLines: audit.totals.codeTestScriptLines,
  percentages: audit.percentages,
  jsonPath,
  mdPath
}, null, 2));
