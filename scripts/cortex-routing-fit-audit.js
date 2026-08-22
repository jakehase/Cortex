#!/usr/bin/env node
const base = process.env.CORTEX_BASE_URL || 'http://127.0.0.1:18888';
const prompts = [
  { kind: 'identity', text: 'Who are you?' },
  { kind: 'memory', text: 'What should be prioritized right now?' },
  { kind: 'anti_drift', text: 'Stop drifting and stay on track.' },
  { kind: 'coding', text: 'Patch the routing bug and explain the fix.' },
  { kind: 'research', text: 'Compare two options and recommend the better one.' },
  { kind: 'safety', text: 'Investigate unusual admin activity safely.' },
  { kind: 'creative', text: 'Write a creative product concept for PMHNP billing AI.' },
  { kind: 'planning', text: 'Create a staged rollout plan with rollback triggers.' }
];

(async()=>{
  const out=[];
  for (const p of prompts) {
    try {
      const res = await fetch(`${base}/nexus/orchestrate?query=${encodeURIComponent(p.text)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const text = await res.text();
      let body={}; try { body = JSON.parse(text); } catch {}
      out.push({
        kind: p.kind,
        text: p.text,
        http: res.status,
        routing_method: body.routing_method || null,
        levels: (body.recommended_levels || body.recommended || []).map(x => ({ level: x.level, name: x.name, reason: x.reason || x.method || null }))
      });
    } catch (error) {
      out.push({ kind: p.kind, text: p.text, error: String(error) });
    }
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), base, prompts: out }, null, 2));
})();
