# Auto Level Activation Expansion (2026-02-19)

Added additional automatic activations in `nexus/orchestrate` for non-always-on levels.

## Newly auto-activated intent groups
1. **Translation intent**
   - Trigger markers: `translation_triggered`, `translation_chain`
   - Levels: L28 Polyglot, L18 Diplomat

2. **Scheduling intent**
   - Trigger markers: `schedule_triggered`, `schedule_chain`
   - Levels: L14 Chronos, L10 Listener

3. **Mediation/conflict intent**
   - Trigger markers: `mediation_triggered`, `mediation_chain`
   - Levels: L31 Mediator, L15 Council, L18 Diplomat

4. **Forecast intent**
   - Trigger markers: `forecast_triggered`, `forecast_chain`
   - Levels: L30 Seer, L20 Simulator, L5 Oracle

5. **Training/learning intent**
   - Trigger markers: `training_triggered`, `training_chain`
   - Levels: L16 Academy, L7 Librarian, L6 Bard

6. **Ethics/compliance intent**
   - Trigger markers: `ethics_triggered`, `ethics_chain`
   - Levels: L33 Ethicist, L15 Council, L34 Validator

## L9 reliability tuning
- Lowered default auto thresholds:
  - `complexity_hard_threshold`: 0.42
  - `l9_auto_activation_threshold`: 0.48
- Added stronger drift correction logic in `routing_autotune`.
- Reduced false incident forcing for generic rollback-planning prompts.

## Persistence
- Code persisted under:
  - `/opt/clawdbot/cortex_server/cortex_server/routers/nexus.py`
  - `/opt/clawdbot/cortex_server/cortex_server/modules/routing_autotune.py`
- Autotune state persisted under bind-mounted host config path:
  - `/opt/clawdbot/config/state/nexus_autotune_state.json`
- Automation schedules persisted in host `crontab -l`.

## Validation
- Targeted tests: 15 passed
- Full tests: 38 passed
- CI gate + enforced replay: PASS
- Force-recreate verification: PASS (health + auto markers still active)
