#!/usr/bin/env node
import fs from 'node:fs';

const files = [
  '/root/clawd/plugins/cortex-route-gate/index.ts',
  '/root/clawd/plugins/cortex-memory-bridge/index.ts',
  '/root/clawd/plugins/cortex-route-gate/openclaw.plugin.json',
  '/root/clawd/plugins/cortex-memory-bridge/openclaw.plugin.json',
  '/root/clawd/scripts/cortex-capability-probe.mjs',
  '/root/clawd/state/cortex-capabilities.json'
];

const requiredChecks = [
  { file: files[0], match: /CORTEX_EXECUTION_GOVERNOR/, label: 'route governor block present' },
  { file: files[0], match: /CORTEX_CREATIVITY_GOVERNOR/, label: 'creativity governor block present' },
  { file: files[0], match: /prompt-history\.json/, label: 'prompt history persistence present' },
  { file: files[0], match: /buildCreativityProfile\(/, label: 'creativity profile builder present' },
  { file: files[0], match: /creativity_governor/, label: 'creative route enforcement present' },
  { file: files[0], match: /tool_result_persist/, label: 'tool grounding hook present' },
  { file: files[0], match: /adaptive-routing-stats\.json/, label: 'adaptive routing stats persistence present' },
  { file: files[0], match: /Failure mode guard:/, label: 'failure-mode validator prompt present' },
  { file: files[0], match: /CORTEX_SELF_MODEL/, label: 'self-model prompt block present' },
  { file: files[0], match: /predictCapabilityUse\(/, label: 'counterfactual pre-action checks present' },
  { file: files[1], match: /enabledWriteThrough/, label: 'memory write-through config present' },
  { file: files[1], match: /durabilityScore\(/, label: 'durability scoring present' },
  { file: files[1], match: /postJson\(cfg\.baseUrl, cfg\.storePath/, label: 'memory store path write-through present' },
  { file: files[3], match: /minDurabilityScore/, label: 'memory plugin schema extended' },
  { file: files[4], match: /cortex-self-model\.json/, label: 'self-model probe writes self-model state' },
  { file: files[5], match: /dynamic_self_model/, label: 'capability registry tracks self-model capability' }
];

const results = [];
for (const check of requiredChecks) {
  const text = fs.readFileSync(check.file, 'utf8');
  results.push({ label: check.label, ok: check.match.test(text) });
}

const ok = results.every((x) => x.ok);
console.log(JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
