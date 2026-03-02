# Creez v2 Architecture Notes (Day 1 Baseline)

This document defines the v2 Electron architecture boundaries for Creez.

## 1) Layer responsibilities

- `main`:
  - Owns Electron app lifecycle, BrowserWindow creation, IPC handlers.
  - Owns local file access and SQLite access.
  - Owns model provider calls and error mapping.
- `preload`:
  - Exposes a strictly whitelisted API surface to renderer.
  - Bridges renderer calls to IPC channels.
  - Hides raw Electron APIs from UI code.
- `renderer`:
  - Pure UI state and user interaction.
  - Calls only preload-exposed APIs.
  - No direct Node.js or fs/db access.

## 2) Suggested directory layout

This is the target structure to converge to during v2 implementation:

```text
creezv2/
  src/
    main/
      index.ts
      ipc/
        channels.ts
        handlers/
    preload/
      index.ts
      api.ts
    renderer/
      app/
      services/
      hooks/
    shared/
      ipc-types.ts
      errors.ts
  docs/
    architecture.md
    ipc-contract.md
    db-schema.md
    week1-plan.md
```

Notes:
- Existing figma-derived UI can stay in current renderer folders while we migrate incrementally.
- If current repo uses slightly different paths, keep these boundaries and naming rules even if file locations differ.

## 3) Entry points and boot flow

- Main entry:
  - Initializes app config and storage root (`~/.creez`).
  - Opens SQLite database at `~/.creez/app.db`.
  - Registers IPC handlers.
  - Creates BrowserWindow and loads renderer.
- Preload entry:
  - Registers `window.electron` or `window.api` whitelist methods.
- Renderer entry:
  - Boots React app and uses preload APIs for data/actions.

## 4) IPC ownership rules

- Channel names use `domain:action` (for example `chat:list`).
- Channel constants live in one place (`main/ipc/channels.ts` or `shared/ipc-types.ts`).
- Input/output DTO types live in `shared`.
- Validation is performed in main handler before business logic.

## 5) Dependency rules (must-follow)

- `renderer` -> can import from `shared`; cannot import from `main` or `preload`.
- `preload` -> can import from `shared`; cannot import renderer UI modules.
- `main` -> can import from `shared`; must not import renderer UI modules.
- Any fs/db/model provider code must be called from `main` only.

## 5.1) Paths: system config vs user data

- **System config (always under `~/.creez`):** App config, agent state, skills, avatars, logs, memory, device_id, SQLite DB. Implemented in `electron/main/creezPaths.cjs`: at startup we call `ensureCreezDirs(homeDir)` so `~/.creez` and subdirs (`avatars`, `logs`, `memory`, `skills`, `sessions`) exist. Home is taken once as `app.getPath("home")` and passed to DB, MemoryStore, SkillManager, AppStateStore, agent IPC, and settings IPC.
- **agentDir:** Same as the Creez config root: `path.join(homeDir, ".creez")`. Used by the agent (e.g. pi-coding-agent) for sessions, auth, etc. All under system config.
- **User work data:** Workspace root is user-defined (stored in app state in DB). Workspace files live in that directory, not under `~/.creez`. The app never forces user data into `~/.creez`.

## 6) Security baseline

- `contextIsolation: true`
- `nodeIntegration: false`
- No raw API key logging
- Workspace paths must be normalized and checked against allowed roots

## 7) Day 1 completion checklist

Day 1 is considered complete when:

- Architecture boundaries are documented (this file).
- IPC contract baseline is documented (`docs/ipc-contract.md`).
- DB schema baseline is documented (`docs/db-schema.md`).
- Team agrees to enforce dependency and security rules above.
