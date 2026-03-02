# Multi-Bot + KB Skill Implementation Plan

This document defines the implementation phases for:

- multi-bot architecture with isolated configuration per bot,
- a new VC fundraising bot,
- bot-scoped knowledge base retrieval via model-triggered skill calls.

## Scope and Decisions

- Knowledge retrieval is triggered by the model through a skill/tool call.
- KB scope is isolated by bot (not shared globally by default).
- Existing backend vector DB will be reused.
- New bots are created through the "Add Bot" flow (template-driven).

## Phase 0: Conversation Stability Baseline

### Goal

Stabilize event delivery and remove debug noise before larger refactors.

### Deliverables

- Ensure sender adapter compatibility with `senderRef.isDestroyed()` call style.
- Keep streaming lifecycle deterministic (`agent_end` always stops UI streaming).
- Remove temporary debug logs from renderer/main where possible.

### Acceptance Criteria

- Sending messages no longer gets stuck with perpetual waiting dots.
- No `isDestroyed is not a function` errors during event forwarding.
- End-user logs are clean by default in devtools/terminal.

### Unit Tests

- `tests/conversationEngineAdapter.test.cjs`
  - `createSenderAdapter` exposes callable `isDestroyed()`.
  - adapter routes `agent:event` and `agent:eventError` correctly.

---

## Phase 1: assistant_config Multi-Row Foundation

### Goal

Replace single-row assistant config with multi-row config support.

### Deliverables

- DB migration to remove `CHECK(id = 1)` from `assistant_config`.
- Preserve existing row (`id=1`) during migration.
- Repository APIs for config-by-id read/write paths.

### Acceptance Criteria

- DB accepts insertion of `assistant_config.id = 2`.
- Updating config `id=2` does not mutate `id=1`.
- Existing default bot behavior remains unchanged.

### Unit Tests

- migration test: old DB upgrades to multi-row `assistant_config`.
- repository test: `saveConfigById(2, ...)` is isolated from config `1`.

---

## Phase 2: Add Bot Flow (Template -> contact + assistant_config)

### Goal

Create new bots from templates and bind each bot to its own config.

### Deliverables

- Backend create-bot API for template-based creation.
- Template `vc_fundraising` creates:
  - a new `assistant_config`,
  - a new `contact` with `assistant_config_id`,
  - optional initial chat/message.
- Frontend add-bot button wired to creation flow.

### Acceptance Criteria

- Clicking add creates VC bot successfully.
- VC bot gets its own `assistant_config_id` (not 1).
- Switching between bots keeps configs isolated.

### Unit Tests

- create flow test: one-call creation is transactional.
- ipc handler test: invalid template returns validation error.

---

## Phase 3: Editable vs Non-Editable Bot Policy ✅

### Goal

Enforce non-configurable VC bot while keeping user default bot configurable.

### Deliverables

- ~~Add metadata fields to `assistant_config` (e.g. `bot_type`, `is_user_editable`).~~ **Omitted:** policy enforced by “config id 1 = editable”;
  no extra column needed.
- Settings save path checks edit policy before persistence. **Done:** `SETTINGS_SAVE_ASSISTANT_CONFIG` and `SETTINGS_UPLOAD_AVATAR` return `FORBIDDEN` when `assistantConfigId !== 1`.
- Settings UI reflects read-only policy for protected bots. **Done:** Settings tab only loads/saves default bot (no `contactId` passed); other bots are never shown in Settings.

### Acceptance Criteria

- VC bot settings cannot be edited by user. ✅ (backend rejects; no UI entry point.)
- Default bot settings remain editable. ✅

### Unit Tests

- settings save policy test: protected config returns forbidden. (Optional.)
- settings save policy test: editable config persists. (Optional.)

---

## Phase 4: Bot-Isolated Skills

### Goal

Maintain skill toggles and defaults per bot configuration.

### Deliverables

- Settings read/write by current bot/contact scope (not global singleton).
- Template-level default skill enabling (e.g. VC bot enables KB skill).
- Optional support for bot-specific skills.

### Acceptance Criteria

- Toggling skills in bot A does not affect bot B.
- VC-only skills are unavailable (or disabled) for default bot.

### Unit Tests

- settings isolation test across two contacts/configs.
- engine init test verifies skills loaded from contact-scoped config.

---

## Phase 5: Knowledge Base as Skill (Model-Triggered) ✅

**详细实施计划**：见 [phase5-knowledge-base-plan.md](./phase5-knowledge-base-plan.md)（双 collection、Node 后端、Creez 内建 skill 与分步计划）。**Memory 业务暂不做**，仅后端预留 collection 与路由。

### Goal

Integrate `knowledge_search` as a callable skill backed by vector DB.

### Deliverables

- New skill/tool handler: `knowledge_search({ query, topK? })`. ✅
- Query execution against existing vector DB (`POST /knowledge/search`). ✅
- Bot-level KB scope filtering (per bot binding; contactId → botId 注入). ✅
- Prompt guidance to encourage tool usage for factual/business questions. ✅

### Acceptance Criteria

- VC bot can answer KB-backed questions by triggering search skill. ✅
- Bot A cannot read bot B knowledge scope. ✅
- Empty/no-hit results are handled gracefully (unified error protocol). ✅

### Unit Tests

- skill handler success/empty/error path tests. ✅ (`tests/knowledgeSearchE2E.test.cjs`)
- bot-scope authorization test for retrieval. ✅ (default bot does not expose tool; non-default bot success path)
- serialization test for returned snippets format. ✅ (E2E 覆盖)

---

## Phase 6: Shared Retrieval Abstraction (Optional Next Iteration)

### Goal

Reuse KB search infrastructure for memory retrieval (future expansion).

### Deliverables

- Shared retrieval provider contract.
- Optional `memory_search` skill using same contract.

### Acceptance Criteria

- memory and kb providers pass same contract tests.
- existing `knowledge_search` behavior unchanged.

### Unit Tests

- provider contract tests for multiple backends.
- regression tests for `knowledge_search`.

---

## TODO (Backlog)

### Skill: Meeting Request (用户约见面 → 后端请求)

- **Goal**: When the user expresses intent to schedule a meeting (e.g. in RoundCloser: “leave your contact details and available time”), trigger a skill that sends the relevant information to the backend.
- **Deliverables**:
  - New skill/tool (e.g. `request_meeting` or `schedule_meeting`) that the model can call when the user provides contact info + availability.
  - Backend API/IPC endpoint to receive: contact details, preferred time, optional message/context; persist or forward as required.
  - RoundCloser (and optionally other bots) prompt guidance to use this skill when the user wants to meet.
- **Acceptance**: User says they want to meet and provides details → skill runs → backend receives structured payload; founder can be notified (implementation TBD).

> 更多待办见 [todo-backlog.md](./todo-backlog.md)（VC 信息互换、非默认 bot Sync、默认 bot Heartbeat 等）。

---

## Recommended Milestones

- **M1**: Phase 0 + Phase 1 + Phase 2
  - Stable chat loop and second bot creation working end-to-end.
- **M2**: Phase 3 + Phase 4 + Phase 5
  - Non-editable VC bot with bot-isolated KB skill.
- **M3**: Phase 6
  - Generalized retrieval foundation for additional bots/features.
