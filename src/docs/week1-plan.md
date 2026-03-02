# Creez v2 Week 1 Plan (Execution Draft)

This plan converts the v2 architecture draft into day-by-day execution tasks for week 1.

## Objective

Deliver a runnable v2 Electron desktop baseline with:

- v2 renderer bootstrapped
- IPC contract skeleton connected
- SQLite schema initialized
- Chat/Settings/Workspace minimum paths wired

## Working agreements

- Keep old v1 implementation untouched while v2 is stabilizing.
- New v2 work is isolated under `creezv2` and dedicated Electron entry wiring.
- Any channel added must be documented in `docs/ipc-contract.md`.
- Any table change must update `docs/db-schema.md` + migration script.

## Day 1 - Architecture lock

- Tasks:
  - Finalize folder boundaries (`main`, `preload`, `renderer`).
  - Confirm channel naming and response envelope.
  - Define error code mapping strategy.
- Deliverables:
  - Architecture notes committed in docs.
  - IPC contract v1 reviewed.
- Acceptance:
  - Team can explain where each responsibility lives.
  - No unresolved naming conflicts.

Status: completed

Completed artifacts:
- `docs/architecture.md`
- `docs/ipc-contract.md`
- `docs/db-schema.md`

## Day 2 - Electron shell and preload bridge

- Tasks:
  - Ensure Electron boots v2 renderer reliably.
  - Add preload whitelist API surface.
  - Implement `app:getState` and `app:setState` baseline handlers.
- Deliverables:
  - App launches to v2 UI.
  - Last selected tab persists across restart.
- Acceptance:
  - Cold start and restart both succeed.
  - Renderer has no direct Node access.

## Day 3 - SQLite foundation

- Tasks:
  - Integrate SQLite connection bootstrap.
  - Apply base migrations for `chats`, `messages`, `app_state`, `assistant_config`.
  - Implement read channels: `chat:list`, `chat:getMessages`.
- Deliverables:
  - DB file is created in `~/.creez/app.db`.
  - Chat list/message history read from DB.
- Acceptance:
  - Empty DB does not crash UI.
  - Seed data can be queried through IPC.

Status: completed

Completed artifacts:
- `electron/main/db/database.cjs`
- `electron/main/db/migrations.cjs`
- `electron/main/repositories/chatRepository.cjs`
- `electron/main/chatIpc.cjs`

## Day 4 - Chat send and full-response write

- Tasks:
  - Implement `chat:send` request path.
  - Persist user message immediately after send.
  - Write assistant message once after full model response returns.
- Deliverables:
  - User message stored immediately.
  - Assistant response is stored and displayed after full completion.
- Acceptance:
  - Success path: both user and assistant messages are persisted correctly.
  - Failure path: assistant message is marked `error` with structured error fields.

## Day 5 - Settings and Memory integration

- Tasks:
  - Implement `settings:getAssistantConfig`.
  - Implement `settings:saveAssistantConfig`.
  - Implement `settings:uploadAvatar`, `memory:read`, `memory:write`.
- Deliverables:
  - Settings page reads/saves real data.
  - Memory markdown round-trip works.
- Acceptance:
  - Restart preserves saved settings.
  - Avatar update path is valid and displayed.

Status: completed

Completed artifacts:
- `electron/main/repositories/assistantConfigRepository.cjs`
- `electron/main/memoryStore.cjs`
- `electron/main/settingsIpc.cjs`
- `src/app/services/settings.ts`
- `src/app/components/AdvancedSettings.tsx`

Manual verification checklist:
- Update Identity fields, blur input, restart app -> values persist.
- Upload avatar (<=10MB common image), restart app -> avatar still visible.
- Edit Memory content, blur textarea, restart app -> content persists in `~/.creez/memory/memory.md`.
- Toggle Skills -> `~/.creez/skills` adds/removes corresponding skill directories.
- Update model provider/model/api key, blur input -> values persist after restart.

## Day 6 - Workspace CRUD

- Tasks:
  - Implement `workspace:getTree/create/rename/delete/readFile/writeFile`.
  - Add root path allowlist and path normalization checks.
- Deliverables:
  - Resource panel uses real file tree.
  - Core file operations function end-to-end.
- Acceptance:
  - Attempts outside workspace root are blocked.
  - CRUD updates reflect correctly in UI.

Status: completed

Completed artifacts:
- `electron/main/workspaceIpc.cjs`
- `src/app/services/workspace.ts`
- `src/app/components/ResourcePanel.tsx`
- `tests/workspaceIpc.test.cjs`

## Day 7 - Stabilization and alpha package

- Tasks:
  - Manual end-to-end verification pass.
  - Fix P0 blockers found during testing.
  - Produce internal alpha installer build.
- Deliverables:
  - Test checklist with pass/fail results.
  - Alpha package + known issues list.
- Acceptance:
  - Critical flows usable:
    - switch tabs
    - list chats/load history/send message
    - update settings + memory
    - workspace CRUD

## Daily checklist template

Use this checklist at day-end:

- Scope completed for the day
- Docs updated if interfaces changed
- Logs captured for regressions
- Known issues added to tracking list
- Next-day blockers explicitly listed

## Risks and mitigations

- Risk: Model provider instability (timeout/network/errors)
  - Mitigation: timeout + structured retry path + clear error mapping
- Risk: File operation security bugs
  - Mitigation: centralized path validator and tests
- Risk: Schema churn during rapid UI changes
  - Mitigation: strict migration versioning and review gate

## Definition of done for Week 1

- v2 desktop app launches and core flows run on local machine.
- IPC contract and DB schema are documented and aligned with implementation.
- Team can start Week 2 feature depth work without architectural rework.
