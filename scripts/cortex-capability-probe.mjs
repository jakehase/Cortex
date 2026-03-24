#!/usr/bin/env node
import fs from 'node:fs';

const registryPath = '/root/clawd/state/cortex-capabilities.json';
const selfModelPath = '/root/clawd/state/cortex-self-model.json';
const contradictionPath = '/root/clawd/state/cortex-contradictions.json';

async function checkHttp(url, opts = {}) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs || 5000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    clearTimeout(t);
    return { ok: res.ok, status: res.status, text: text.slice(0, 400) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
function exists(path) { try { return fs.existsSync(path); } catch { return false; } }
function readJson(path, fallback) { try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; } }
function iso() { return new Date().toISOString(); }
function contradiction(id, severity, summary, evidence) { return { id, severity, summary, evidence, detectedAt: iso() }; }

const registry = readJson(registryPath, { capabilities: [] });
const selfModel = { version: 1, generatedAt: iso(), capabilities: {}, confidence: {}, degraded: [], recommendations: [] };
const contradictions = [];

const routeStats = readJson('/root/.openclaw/cortex-route-gate/adaptive-routing-stats.json', null);
const routeFingerprints = exists('/root/.openclaw/cortex-route-gate/prompt-fingerprints.json');
selfModel.capabilities.route_governor = {
  claimed: true,
  implemented: true,
  live: Boolean(routeStats && routeFingerprints),
  verified: Boolean(routeStats && routeStats.byLevel && Object.keys(routeStats.byLevel).length > 0),
  observedAt: iso(),
  evidence: [
    routeStats ? '/root/.openclaw/cortex-route-gate/adaptive-routing-stats.json' : null,
    routeFingerprints ? '/root/.openclaw/cortex-route-gate/prompt-fingerprints.json' : null
  ].filter(Boolean)
};
selfModel.confidence.route_governor = selfModel.capabilities.route_governor.verified ? 0.95 : 0.6;

const browserStatus = await checkHttp('http://127.0.0.1:18888/browser/status');
selfModel.capabilities.l2_browser_bridge = {
  claimed: true,
  implemented: true,
  live: Boolean(browserStatus.ok),
  verified: Boolean(browserStatus.ok),
  observedAt: iso(),
  evidence: [browserStatus]
};
selfModel.confidence.l2_browser_bridge = browserStatus.ok ? 0.9 : 0.2;
if (!browserStatus.ok) {
  selfModel.degraded.push('l2_browser_bridge');
  contradictions.push(contradiction('l2_browser_bridge_degraded', 'high', 'L2 browser bridge is implemented but not currently observed as live.', [browserStatus]));
  selfModel.recommendations.push('Do not rely on Cortex-native browsing until /browser/status succeeds; use explicit fallback language.');
}

const memoryStore = await checkHttp('http://127.0.0.1:18888/l22/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'memory', content: 'probe', tags: ['probe'], metadata: { source: 'self-model-probe' } }) });
selfModel.capabilities.memory_write_through = {
  claimed: true,
  implemented: true,
  live: Boolean(memoryStore.ok),
  verified: false,
  observedAt: iso(),
  evidence: [memoryStore, 'automatic hook path not yet directly observed']
};
selfModel.confidence.memory_write_through = memoryStore.ok ? 0.55 : 0.2;
if (memoryStore.ok) {
  contradictions.push(contradiction('memory_write_through_partial', 'medium', 'Memory store endpoint is live, but automatic write-through hook remains unverified.', [memoryStore, 'hook path lacks direct success evidence']));
  selfModel.recommendations.push('Treat memory write-through as partially trusted: endpoint works, hook automation still needs direct verification evidence.');
} else {
  selfModel.degraded.push('memory_write_through');
}

selfModel.capabilities.capability_registry_preflight = {
  claimed: true,
  implemented: true,
  live: exists(registryPath) && exists('/root/clawd/scripts/cortex-capability-preflight.mjs'),
  verified: exists(registryPath) && exists('/root/clawd/scripts/cortex-capability-preflight.mjs'),
  observedAt: iso(),
  evidence: [registryPath, '/root/clawd/scripts/cortex-capability-preflight.mjs']
};
selfModel.confidence.capability_registry_preflight = selfModel.capabilities.capability_registry_preflight.verified ? 0.95 : 0.5;

for (const cap of registry.capabilities || []) {
  const observed = selfModel.capabilities[cap.id];
  if (!observed) continue;
  if (cap.implemented && observed.live === false) {
    contradictions.push(contradiction(`${cap.id}_implemented_but_not_live`, 'medium', `${cap.id} is registered as implemented, but live observation is currently false.`, [cap, observed]));
  }
  if (cap.verified && observed.verified === false) {
    contradictions.push(contradiction(`${cap.id}_verified_mismatch`, 'medium', `${cap.id} is marked verified in registry, but latest observation could not verify it.`, [cap, observed]));
  }
}

fs.writeFileSync(selfModelPath, JSON.stringify(selfModel, null, 2));
fs.writeFileSync(contradictionPath, JSON.stringify({ version: 1, generatedAt: iso(), contradictions }, null, 2));
console.log(JSON.stringify({ ok: true, selfModelPath, contradictionPath, degraded: selfModel.degraded, contradictions: contradictions.length }, null, 2));
