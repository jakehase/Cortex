import path from 'node:path';

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface';
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export const GAME_100_AGENT_READINESS_LADDER = Object.freeze([
  {
    agentCount: 10,
    rung: 'scoped_orchestration_proof',
    objective: 'Prove scoped multi-agent product diffs remain honest under admission and verifier gates.',
    requiredEvidence: ['10 assigned shards', 'isolated or non-overlapping ownership', 'surviving product diffs', 'surface verifiers pass']
  },
  {
    agentCount: 25,
    rung: 'playable_skeleton',
    objective: 'Produce one playable skeleton with controller, camera, combat, one enemy, one map, UI shell, and save stub integrated.',
    requiredEvidence: ['Godot import/build green', 'headless scene load green', 'movement/combat harness green', 'repair lane handles first-wave failures']
  },
  {
    agentCount: 50,
    rung: 'integrated_vertical_slice',
    objective: 'Converge multiple gameplay systems into a vertical slice with meaningful feature interaction, not isolated demos.',
    requiredEvidence: ['low-overlap surface matrix', 'cross-system integration proof', 'asset manifest proof', 'quality repair wave green']
  },
  {
    agentCount: 100,
    rung: 'full_100_agent_readiness',
    objective: 'Run 100 assigned product shards with quality convergence and no fake-green completion.',
    requiredEvidence: [
      '100 assigned agents/shards',
      'meaningful product diffs from most agents',
      'no-op rate below threshold',
      'build/import/test gate green',
      'automatic repair lane converged or produced a blocker report',
      'threshold evaluation green for tier3_game_vertical_slice_100agent'
    ]
  }
]);

export const GAME_100_AGENT_SCHEDULER_POLICY = Object.freeze({
  leases: { required: true, exclusiveFileAreas: true, renewalRequired: true },
  retries: { required: true, maxAttemptsPerTaskMin: 2, retryOnlyAfterLocalizedFailure: true },
  staleWorkerRecovery: { required: true, reclaimExpiredLeases: true, emitRecoveryEvents: true },
  activeCodexCallThrottle: { required: true, maxActiveCallsMax: 20, scheduleRequiredAtScale: true },
  usageLimitBackoff: { required: true, pauseInsteadOfSpendingRetries: true },
  workStealing: { required: true, strategy: 'ready_queue_plus_expired_lease_reassignment' },
  noFakeDone: { required: true, terminalCondition: 'supervisor_green_or_blocker_report' }
});

export const GAME_100_AGENT_ADMISSION_GATES = Object.freeze({
  rejectEmptyDiffs: true,
  rejectDocsOnlyChangesAsProduct: true,
  rejectTestsOnlyChangesAsProduct: true,
  requireAssignedProductFilesTouched: true,
  requireVerifierEvidence: true,
  requireMergeableNonConflictingPatch: true,
  requireCanonicalLandingEvidence: true,
  requireClaimIntegrity: true,
  requireNoMarkerOnlyDeltas: true
});

export const GAME_100_AGENT_VERIFICATION_POLICY = Object.freeze({
  required: true,
  godotProjectImport: { required: true, commandKind: 'godot_headless_import_or_static_project_gate' },
  headlessSceneLoad: { required: true, harnessPath: 'tests/headless/scene_load_smoke.gd' },
  movementCombatHarness: { required: true, harnessPath: 'tests/headless/player_movement_combat_smoke.gd' },
  assetManifest: { required: true, candidatePaths: ['assets/manifest.json', 'artifacts/game_asset_manifest.json'] },
  screenshotCapture: { required: false, enabledByEnv: 'GAME_VERIFY_CAPTURE_SCREENSHOT' },
  surfaceStaticGate: { required: true, rejectsMissingAssignedFile: true }
});

export const GAME_100_AGENT_REPAIR_LANE = Object.freeze({
  enabled: true,
  spawnAfterFeatureWave: true,
  maxRepairWaves: 3,
  triggers: [
    'godot_import_or_compile_failure',
    'headless_scene_load_failure',
    'movement_combat_harness_failure',
    'asset_manifest_failure',
    'file_ownership_collision',
    'merge_conflict_or_non_additive_patch',
    'test_failure_regression',
    'missing_integration_wire',
    'zero_or_marker_only_product_diff'
  ],
  stopCondition: 'repair_green_or_blocker_report'
});

const SURFACE_GROUPS = Object.freeze([
  {
    prefix: 'player', lane: 'player_controller', domain: 'runtime_gameplay', baseDir: 'scripts/player',
    labels: [
      'movement controller', 'jump and ladder traversal', 'dash and dodge action', 'slope and platform snap',
      'input buffering', 'hit reaction knockback', 'ledge and rope interaction', 'player state machine'
    ]
  },
  {
    prefix: 'camera', lane: 'camera_feel', domain: 'runtime_presentation', baseDir: 'scripts/camera',
    labels: ['side scroll camera', 'camera bounds zones', 'screen shake feedback', 'parallax depth layers', 'cinematic focus triggers']
  },
  {
    prefix: 'combat', lane: 'combat_skills', domain: 'runtime_gameplay', baseDir: 'scripts/combat',
    labels: [
      'basic attack combo', 'ranged projectile', 'skill cooldowns', 'area hitbox resolver', 'damage formula',
      'crit and status effects', 'enemy targeting', 'skill bar binding', 'mana and resource costs',
      'combat animation events', 'invulnerability frames', 'training dummy sandbox'
    ]
  },
  {
    prefix: 'enemy', lane: 'enemy_ai', domain: 'runtime_gameplay', baseDir: 'scripts/enemies',
    labels: [
      'slime patrol AI', 'flying enemy AI', 'ranged enemy AI', 'elite enemy modifiers', 'aggro and leash',
      'spawn groups', 'boss phase controller', 'boss pattern telegraph', 'enemy drop table', 'enemy health UI'
    ]
  },
  {
    prefix: 'npc', lane: 'npc_quest_dialogue', domain: 'runtime_content', baseDir: 'scripts/npc',
    labels: [
      'NPC interaction prompt', 'dialogue tree runner', 'quest accept complete', 'quest objective tracker',
      'quest reward grant', 'shopkeeper interaction', 'travel portal NPC', 'quest marker UI'
    ]
  },
  {
    prefix: 'inventory', lane: 'inventory_progression', domain: 'runtime_state', baseDir: 'scripts/inventory',
    labels: [
      'item inventory model', 'equipment slots', 'stat modifiers', 'loot pickup flow', 'item use consumables',
      'currency wallet', 'level and XP curve', 'skill unlock tree', 'equipment tooltips', 'inventory sort filter'
    ]
  },
  {
    prefix: 'ui', lane: 'ui_hud_menus', domain: 'runtime_presentation', baseDir: 'ui',
    labels: [
      'main HUD layout', 'health mana bars', 'minimap shell', 'pause menu', 'settings menu',
      'keybind menu', 'character sheet', 'skill book UI', 'inventory UI grid', 'notification toast'
    ]
  },
  {
    prefix: 'world', lane: 'world_maps_platforming', domain: 'runtime_content', baseDir: 'scripts/world',
    labels: [
      'Henesys town scene', 'forest training map', 'dungeon room loop', 'moving platforms', 'hazards and pits',
      'ladder rope map objects', 'portal transition system', 'spawn points checkpoint', 'background parallax scene',
      'lighting and fog zones', 'collision layer matrix', 'map streaming stub'
    ]
  },
  {
    prefix: 'asset', lane: 'assets_vfx_audio', domain: 'asset_pipeline', baseDir: 'assets/pipeline',
    labels: [
      'sprite placeholder pipeline', 'character animation library', 'enemy animation library', 'skill VFX emitters',
      'hit spark VFX', 'pickup VFX audio', 'ambient audio zones', 'UI sound pack', 'asset manifest validator',
      'material shader palette'
    ]
  },
  {
    prefix: 'save', lane: 'save_settings_tools', domain: 'runtime_state', baseDir: 'scripts/save',
    labels: [
      'save game model', 'checkpoint persistence', 'settings persistence', 'input profile persistence',
      'debug spawn console', 'level authoring metadata', 'content registry', 'build export profile'
    ]
  },
  {
    prefix: 'qa', lane: 'qa_integration_performance', domain: 'quality_gate', baseDir: 'tools/qa',
    labels: [
      'playable vertical slice gate', 'headless scene load gate', 'movement combat harness', 'asset manifest gate',
      'performance budget gate', 'screenshot capture gate', 'integration smoke dashboard'
    ]
  }
]);

function verifierKindsFor(group, label) {
  const text = `${group.lane} ${group.domain} ${label}`.toLowerCase();
  const kinds = ['surface_static', 'godot_project_import', 'headless_scene_load'];
  if (/player|movement|jump|dash|input|ledge|rope|vertical slice/.test(text)) kinds.push('movement_harness');
  if (/combat|skill|attack|damage|enemy|boss|training dummy/.test(text)) kinds.push('combat_harness');
  if (/asset|vfx|audio|manifest|material|sprite|animation/.test(text)) kinds.push('asset_manifest');
  if (/screenshot|capture/.test(text)) kinds.push('screenshot_capture_optional');
  return Array.from(new Set(kinds));
}

function buildVerifierCommand({ verifierScriptPath, surfaceId, primaryFile, group, label }) {
  return [
    'node',
    shellQuote(path.resolve(verifierScriptPath)),
    '--repo-path', '"${GAME_100_AGENT_REPO_PATH:-.}"',
    '--surface', shellQuote(surfaceId),
    '--file', shellQuote(primaryFile),
    '--kind', shellQuote(group.domain),
    '--lane', shellQuote(group.lane),
    '--duration-ms', '"${GAME_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE:-0}"',
    '--min-cycles', '"${GAME_BENCHMARK_SURFACE_MIN_CYCLES_OVERRIDE:-1}"',
    '--cycle-interval-ms', '"${GAME_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS_OVERRIDE:-60000}"',
    verifierKindsFor(group, label).includes('asset_manifest') ? '--check-asset-manifest' : null,
    verifierKindsFor(group, label).includes('screenshot_capture_optional') ? '--screenshot-optional' : null
  ].filter(Boolean).join(' ');
}

export function buildGame100AgentReadinessSurfaces({ verifierScriptPath = 'apps/system-benchmark/verify-godot-game-surface.mjs' } = {}) {
  const surfaces = [];
  for (const group of SURFACE_GROUPS) {
    for (const label of group.labels) {
      const labelSlug = slugify(label);
      const surfaceId = `${group.prefix}_${labelSlug}`;
      const primaryFile = `${group.baseDir}/${labelSlug}.gd`;
      const verifierCommand = buildVerifierCommand({ verifierScriptPath, surfaceId, primaryFile, group, label });
      const expectedVerifierKinds = verifierKindsFor(group, label);
      surfaces.push({
        id: surfaceId,
        label: `${label.replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
        lane: group.lane,
        productLane: group.lane,
        domain: group.domain,
        allowedFiles: [primaryFile],
        fileAreas: [primaryFile],
        productFiles: [primaryFile],
        targetFiles: [primaryFile],
        ownership: {
          primaryProductFile: primaryFile,
          exclusive: true,
          collisionPolicy: 'one_surface_owns_one_primary_product_file'
        },
        verification: [verifierCommand],
        acceptanceChecks: [
          `Assigned product file changes: ${primaryFile}`,
          'No docs-only/tests-only/marker-only changes count as product work.',
          'Godot project/import or static project gate passes.',
          'Headless scene-load verifier is green or produces a localized blocker.',
          'Surface-specific verifier evidence is attached.'
        ],
        inputs: {
          gameSurfaceKind: group.domain,
          gameLane: group.lane,
          expectedVerifierKinds,
          verifierCatalog: {
            [`${surfaceId}__game_surface`]: {
              id: `${surfaceId}__game_surface`,
              command: verifierCommand,
              purpose: `Verify Godot game surface ${surfaceId}`,
              surfaceId
            }
          }
        },
        metadata: {
          game100AgentReadiness: true,
          primaryProductFile: primaryFile,
          expectedVerifierKinds,
          artifactKind: 'product_diff',
          assignmentContract: {
            artifactKind: 'product_diff',
            targetFiles: [primaryFile],
            verifierRequirements: [`${surfaceId}__game_surface`],
            successPredicate: [
              'surviving scoped Godot product delta',
              'assigned surface verifier passes',
              'no fake-green admission rejection'
            ]
          }
        }
      });
    }
  }
  return surfaces;
}

export const GAME_100_AGENT_SURFACE_COUNT = buildGame100AgentReadinessSurfaces({ verifierScriptPath: '/tmp/verify-godot-game-surface.mjs' }).length;
