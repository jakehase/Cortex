#!/usr/bin/env node
const base = process.env.CORTEX_BASE_URL || 'http://127.0.0.1:8000';
const fallbackLevels = [
  [1,'Kernel','/kernel/status'],[2,'Ghost (Browser)','/browser/status'],[3,'Parser','/parsers/status'],[4,'Lab','/lab/status'],
  [5,'Oracle','/oracle/status'],[6,'Bard','/bard/status'],[7,'Librarian','/librarian/status'],[8,'Cron','/cron/status'],
  [9,'Architect','/meta_conductor/status'],[10,'Listener','/listener/status'],[11,'Catalyst','/catalyst/status'],[12,'Hive/Darwin','/hive/status'],
  [13,'Dreamer','/dreamer/status'],[14,'Chronos (Night Shift)','/night_shift/status'],[15,'Council','/council/status'],[16,'Academy','/academy/status'],
  [17,'Exoskeleton','/tools/status'],[18,'Diplomat','/diplomat/status'],[19,'Geneticist','/geneticist/status'],[20,'Simulator','/simulator/status'],
  [21,'Sentinel','/sentinel/status'],[22,'Mnemosyne','/knowledge/status'],[23,'Cartographer','/mirror/status'],[24,'Nexus','/nexus/status'],
  [25,'Bridge','/bridge/status'],[26,'Orchestrator','/conductor/status'],[27,'Forge','/forge/status'],[28,'Polyglot','/polyglot/status'],
  [29,'Muse','/muse/status'],[30,'Seer','/seer/status'],[31,'Mediator','/mediator/status'],[32,'Synthesist','/synthesist_api/status'],
  [33,'Ethicist','/ethicist/status'],[34,'Validator','/validator/status'],[35,'Singularity','/singularity/status'],[36,'Conductor (Meta)','/meta_conductor/status'],
  [37,'Awareness','/awareness/status'],[38,'Augmenter','/augmenter/status'],
];

function summarize(body) {
  return body?.status ?? body?.data?.status ?? body?.success ?? null;
}

(async () => {
  let levels = fallbackLevels;
  let registrySource = 'fallback_static_matrix';
  try {
    const res = await fetch(base + '/kernel/levels');
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body?.levels) && body.levels.length) {
        levels = body.levels.map((item) => [item.level, item.name, item.canonical_status]);
        registrySource = '/kernel/levels';
      }
    }
  } catch {}

  const results = [];
  for (const [level, name, path] of levels) {
    try {
      const res = await fetch(base + path);
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      results.push({ level, name, path, http: res.status, ok: res.ok, summary: summarize(body), body });
    } catch (error) {
      results.push({ level, name, path, http: null, ok: false, error: String(error) });
    }
  }

  const cortexChecks = {};
  for (const path of ['/health', '/oracle/status', '/knowledge/status', '/mirror/status', '/nexus/status']) {
    try {
      const res = await fetch(base + path);
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      cortexChecks[path] = { http: res.status, ok: res.ok, summary: summarize(body), body };
    } catch (error) {
      cortexChecks[path] = { ok: false, error: String(error) };
    }
  }

  const pass = results.filter(r => r.ok).length;
  const report = {
    generatedAt: new Date().toISOString(),
    base,
    registrySource,
    pass,
    total: levels.length,
    allPass: pass === levels.length,
    results,
    cortexChecks,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.allPass ? 0 : 1);
})();
