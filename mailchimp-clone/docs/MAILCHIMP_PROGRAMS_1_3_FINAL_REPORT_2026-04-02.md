Reply anchor:
- user approved relaunch under the new permanent contract/campaign/surface-matrix rules

Anchor:
- /root/clawd/public/cortex_server/docs/MAILCHIMP_PARITY_PROGRAM_0_SUPERVISED_ROADMAP_2026-04-01.md
- /root/clawd/public/cortex_server/docs/MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_2026-04-01.md
- /root/clawd/public/cortex_server/docs/MAILCHIMP_PRODUCT_SURFACE_MAP_2026-04-01.md
- /root/clawd/public/cortex_server/docs/MAILCHIMP_PARITY_CHARTER_2026-04-01.md
- current user direction to relaunch under the stricter permanent fixes

Target path:
- /root/clawd/mailchimp-clone

Fidelity: full_clone
Scope: Programs 1–3
Stop condition: supervisor_green_or_blocker_report
Campaign mode: persistent
Supervisor status: green
Surface matrix: artifacts/mailchimp_clone/programs_1_3/surface_checklist.json
Surface matrix status: all_complete
Diff scope:
- product implementation in `src/server.js`
- executable validation in `tests/platform-spine.test.mjs`, `tests/audience-core.test.mjs`, `tests/campaign-pipeline.test.mjs`
- worker/supervisor/watcher/notifier artifacts in `scripts/worker.mjs`, `scripts/supervisor.mjs`, `scripts/watch-completion.mjs`, `scripts/notify-once.mjs`, `scripts/smoke-programs-1-3.mjs`
- campaign artifacts in `artifacts/mailchimp_clone/programs_1_3/`

Parity status: full

Surface coverage:
- Program 1 — Platform spine
  - auth account lifecycle: signup, login, logout, reset request, reset completion, post-reset login verification
  - workspace/account spine: workspace creation, rename, switching, API key visibility, sender/compliance settings
  - team roles/permissions: invitation issuance, invite resend, invite acceptance, role updates for active members
  - billing plans: starter/growth/pro plan switching with visible feature gates and invoice history
  - settings/domains/authentication: sender identity, reply-to, address, domain add/verify/authenticate/default flows
  - audit/content/admin operations: audit view/export, content studio asset storage, feature flags, admin shell, public `/status`
  - jobs/events/notifications: queued/completed jobs view, event stream, notification outbox, API/session auth protection
- Program 2 — Audience/contact core
  - audience metrics, audience overview metrics, and audience detail summaries
  - searchable/filterable contacts table with bulk tagging/status operations
  - editable contact profile with notes and activity timeline
  - tags/groups/interests taxonomy management
  - multi-rule segments preview/save flows with visible plan gating
  - import preview/commit validation pipeline and API contact create/update
- Program 3 — Campaign/editor/send pipeline
  - campaign index and lifecycle state
  - setup/recipients/templates/editor/review wizard progression with resume semantics
  - template library and template-backed draft initialization
  - block-based editor and block-based email editor with live preview, asset linkage, style controls, block reordering, duplication, and delete flows
  - review/test-send/schedule/send-now flows with preflight blockers and recipient estimates
  - draft persistence and background job completion for scheduled/immediate sends

Parity evidence:
- product code evidence
  - `src/server.js` implements the scoped Programs 1–3 surfaces directly, including the previously missing reset completion flow, sending-domain auth surface, richer editor controls, and stronger team-admin behavior
- machine-readable surface matrix
  - `artifacts/mailchimp_clone/programs_1_3/surface_checklist.json`
- worker evidence
  - `artifacts/mailchimp_clone/programs_1_3/worker_state.json`
- smoke evidence
  - `artifacts/mailchimp_clone/programs_1_3/validation/live_smoke.json`
  - live smoke now covers signup, reset completion, workspace management, settings/domains, assets, invitations, notifications, events, jobs, audience flows, campaign review, and status
- test evidence
  - `artifacts/mailchimp_clone/programs_1_3/validation/tests_platform.log`
  - `artifacts/mailchimp_clone/programs_1_3/validation/tests_audience.log`
  - `artifacts/mailchimp_clone/programs_1_3/validation/tests_campaign.log`
- supervisor evidence
  - `artifacts/mailchimp_clone/programs_1_3/program_state.json`
  - `artifacts/mailchimp_clone/programs_1_3/completion_summary.json`
  - `artifacts/mailchimp_clone/programs_1_3/reports/supervisor_status.json`

Concrete tests/checks run:
- `npm test -- --runInBand`
- `node scripts/smoke-programs-1-3.mjs`
- `node scripts/worker.mjs`
- `node scripts/supervisor.mjs`
- `node scripts/watch-completion.mjs`
- `node scripts/notify-once.mjs`

Remaining gaps: none for the requested Programs 1–3 clone scope; only minor presentation polish remains possible without changing surface completeness or parity truth.
