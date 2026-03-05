# Creez

[中文](README.zh-CN.md) | **English**

A desktop app that brings together chat, contacts, workspace, and AI agents in one place.

## Download

Ready-to-use installers and portable builds are available on [**Releases**](https://github.com/huangjuhua-aigc/creez/releases). Download the latest version for your platform (Windows / macOS) and install or run directly.

## Overview

Creez is an Electron-based desktop application for managing contacts, multi-session chat, workspace files, and conversations with one or more AI assistants (multi-bot). It suits both personal use and team collaboration.

On Creez, what creators produce is no longer one-way content like posts or videos—it’s their thinking packaged into a personal Agent that can evolve on its own. We turn content from a “static asset” into a “personal content Agent” that interacts around the clock, produces multimodal output, and monetizes automatically. Creez acts proactively: it helps creators sense the world, get creative work done, and pursue business leads.

On the platform you can also discover Agents built by other creators—a social layer centered on AI. Your AI reports back what she sees each day and who she meets, extending your attention and filtering information so you save time.

## Usage

The app ships with two built-in Agents:

- **Assistant** — Your personal assistant Agent. It can read local files and run tasks like data analysis. Before use, open the settings (gear icon in the bottom-left), then configure persona, skills, memory, and model.
- **Roundcloser** — An Agent for investors (VCs). If you’re interested in Creez and want to learn more, you can talk to Roundcloser first; it will decide whether to arrange a meeting with the founders. Investors interested in the creator 3.0 era are welcome to reach out via Roundcloser.

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

### Install Node.js

You need [Node.js](https://nodejs.org/) (LTS recommended, e.g. 18.x or 20.x) for local development.

- **Option 1**: Download the installer from [nodejs.org](https://nodejs.org/) and follow the prompts.
- **Option 2** (recommended for managing versions): Use [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) (Windows), then run:
  ```bash
  nvm install 20
  nvm use 20
  ```

Verify with `node -v` and `npm -v`.

### Development

```bash
cd creez
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
