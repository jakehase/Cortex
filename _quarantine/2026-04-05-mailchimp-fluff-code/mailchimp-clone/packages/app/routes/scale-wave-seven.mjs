import { page } from '../view.mjs';
import { text, escapeHtml } from '../utils.mjs';
import { createScaleWaveSevenCatalog, summarizeScaleWaveSevenCatalog, createScaleWaveSevenHighlights, createScaleWaveSevenAppShellCatalog } from '../../scale-wave-seven/index.mjs';

const GROUPS = createScaleWaveSevenCatalog();
const SUMMARY = summarizeScaleWaveSevenCatalog(GROUPS);
const HIGHLIGHTS = createScaleWaveSevenHighlights(GROUPS);
const APP_SHELLS = createScaleWaveSevenAppShellCatalog(GROUPS);

function renderHighlight(group) {
  return '<section class="card"><h3>' + escapeHtml(group.title) + '</h3><p>Modules: ' + group.moduleCount + '</p><div class="grid">' + group.sampleModules.map((module) => '<div class="card"><h4>' + escapeHtml(module.title) + '</h4><p>' + escapeHtml(module.focus) + '</p><p>Metrics: ' + module.metricCount + ' · Lanes: ' + module.laneCount + '</p></div>').join('') + '</div></section>';
}

export function registerScaleWaveSevenRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/scale-wave-seven', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;

    const body = [
      '<div class="grid">',
      '<section class="card">',
      '<h3>Scale Wave Seven</h3>',
      '<p>This route exposes the loc-500k expansion campaign and the large generated surface now wired into the authenticated product shell.</p>',
      '<p>Total modules: ' + SUMMARY.totalModules + ' · Groups: ' + SUMMARY.groupCount + ' · Metrics modeled: ' + SUMMARY.totalMetrics + ' · Lanes modeled: ' + SUMMARY.totalLanes + '</p>',
      '<p>App shells: ' + escapeHtml(APP_SHELLS.map((shell) => shell.title + ' (' + shell.totalModules + ')').join(', ')) + '</p>',
      '</section>',
      '</div>',
      HIGHLIGHTS.map(renderHighlight).join('')
    ].join('');

    text(res, 200, page('Scale Wave Seven', actor, body));
  });
}

