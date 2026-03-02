# Creez

[中文](README.zh-CN.md) | **English**

A desktop app that brings together chat, contacts, workspace, and AI agents in one place.

## Download

Ready-to-use installers and portable builds are available on [**Releases**](https://github.com/YOUR_ORG/creez/releases). Download the latest version for your platform (Windows / macOS) and install or run directly.

## Overview

Creez is an Electron-based desktop application for managing contacts, multi-session chat, workspace files, and conversations with one or more AI assistants (multi-bot). It suits both personal use and team collaboration.

On Creez, what creators produce is no longer one-way content like posts or videos—it’s their thinking packaged into a personal Agent that can evolve on its own. We turn content from a “static asset” into a “personal content Agent” that interacts around the clock, produces multimodal output, and monetizes automatically. Creez acts proactively: it helps creators sense the world, get creative work done, and pursue business leads.

On the platform you can also discover Agents built by other creators—a social layer centered on AI. Your AI reports back what she sees each day and who she meets, extending your attention and filtering information so you save time.

## Features

- **Desktop app** — Native experience on Windows, macOS, and Linux
- **Chat** — Multiple conversations with streaming replies
- **Contacts** — Manage chat partners and sessions
- **Workspace** — Browse and edit workspace files, linked to your chats
- **AI assistant** — Built-in AI agents with multi-bot support and configurable providers
- **Local-first** — Config and SQLite data stored locally (e.g. `~/.creez`)

## Tech stack

- **Electron** — Desktop runtime
- **React** — UI
- **Vite** — Build and dev server
- **SQLite** (better-sqlite3) — Local data storage

## How to run

### Development

```bash
cd creezv2
npm install
npm run dev
```

This starts the Vite dev server and the Electron window. Refresh the window after changing frontend code to see updates.

### Production (build then start)

```bash
npm run build
npm run start
```

Or use `npm run start:prod` to build and then start in one step.

## How to get the packaged app

The project uses [electron-builder](https://www.electron.build/) to produce installable or portable builds:

```bash
npm run build
npm run pack
```

- **Windows**: Run the above on Windows; output goes to `release/` (e.g. `win-unpacked` or installer).
- **macOS / Linux**: Run on the target OS, or adjust `build.win` / `build.mac` / `build.linux` in `package.json` for cross-build.

After packing, get the app from the `release/` directory (unpacked folder or installer).

### CI builds (GitHub Actions)

Builds run on push to `main`/`master` or when you trigger the workflow manually (Actions → “Build Electron (Creez)” → Run workflow). Download Windows (`win-unpacked`) or Mac (`.dmg`) artifacts from the run’s **Artifacts** section. Code signing is disabled in CI unless repo secrets are set.

## More

- For detailed run and debug notes, see the repo root or the legacy [Creez README](../creez/README.md) if present.
- 中文说明见 [README.zh-CN.md](README.zh-CN.md).
