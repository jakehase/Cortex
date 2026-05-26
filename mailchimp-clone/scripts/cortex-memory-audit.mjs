#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMailchimpCanonicalTruthPreflight } from './lib/mailchimp-canonical-truth-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(ROOT, '..');
const OUTPUT_PATH = process.env.CORTEX_MEMORY_AUDIT_PATH
  || path.join(ROOT, 'artifacts', 'full_audit_campaign', 'cortex_memory_audit.json');

async function optionalHttpSearch(query) {
  const endpoint = process.env.CORTEX_MEMORY_SEARCH_URL || '';
  if (!endpoint || typeof fetch !== 'function') {
    return { configured: Boolean(endpoint), ok: null, note: endpoint ? 'fetch_unavailable' : 'not_configured' };
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, maxResults: 5 })
    });
    const text = await res.text();
    const ok = res.ok && /Mailchimp|full parity|abundant|1M|1m/i.test(text);
    return { configured: true, ok, status: res.status, bytes: text.length };
  } catch (error) {
    return { configured: true, ok: false, error: error?.message || String(error) };
  }
}

const preflight = buildMailchimpCanonicalTruthPreflight({ workspaceRoot: WORKSPACE_ROOT });
const cortexSearch = await optionalHttpSearch('Mailchimp over 1M LOC nowhere near full parity abundant remaining work');
const payload = {
  generatedAt: new Date().toISOString(),
  ok: preflight.ok && cortexSearch.ok !== false,
  localTruthPreflight: preflight,
  cortexSearch,
  decision: preflight.ok && cortexSearch.ok !== false
    ? 'memory_guard_available'
    : 'memory_guard_degraded',
  nextAction: preflight.ok && cortexSearch.ok !== false
    ? 'Use local project memory plus canonical artifacts before Mailchimp completion/status claims.'
    : 'Repair local project memory markers or Cortex memory search before trusting Mailchimp full-parity status claims.'
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
