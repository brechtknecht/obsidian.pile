# Pile for Obsidian

A port of [Pile](https://github.com/UdaraJay/Pile) — the reflective journaling
app by Udara Jay — running as an Obsidian plugin. The original React renderer
runs (mostly) unmodified inside an Obsidian `ItemView`; the Electron main
process is replaced by an in-process shim backed by the vault's filesystem.

Posts are plain markdown files with YAML frontmatter, stored in your vault
using Pile's native layout (`<folder>/<year>/<month>/<yymmdd-hhmmss>.md`), so
the data stays compatible with the desktop app and readable as regular
Obsidian notes.

## Architecture

```
src/
├── main.ts             Obsidian plugin entry (view, settings, ribbon)
├── view.tsx            ItemView → Shadow DOM host, theme sync, resource URLs
├── pile-bootstrap.tsx  window.electron bridge + mounts vendored <App/>
├── shim/
│   ├── electron.ts           virtual electron module (ipcMain/ipcRenderer bus,
│   │                         dialog via Obsidian's @electron/remote, …)
│   └── electron-settings.ts  JSON-file-backed settings store
└── vendor/             Pile's source (MIT), lightly patched — see
                        "Obsidian port:" comments for every deviation
```

Key mechanics:

- **In-process IPC**: Pile's real `ipcMain` handlers register into a shim
  registry; the renderer's `ipc.invoke` dispatches to them directly.
- **Shadow DOM isolation**: Obsidian's global CSS (and themes) cannot reach
  Pile's UI; Pile's compiled CSS is injected inside the shadow root.
- **Build-time CSS transforms** (see `esbuild.config.mjs`): all selectors
  scoped under `.pile-app-root`, `100vw/100vh` → container-relative,
  `prefers-color-scheme: dark` rewritten to `.is-dark` gating that follows
  Obsidian's light/dark setting, fonts/images inlined as data URIs.

## Install

Desktop only. Two ways:

**Via BRAT (recommended — auto-updates):**
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. BRAT → *Add beta plugin* → paste `brechtknecht/obsidian.pile`.
3. Enable **Pile** in Settings → Community plugins.

**Manual:**
1. From the [latest release](https://github.com/brechtknecht/obsidian.pile/releases),
   download `pile.zip`.
2. Unzip it into `<vault>/.obsidian/plugins/` (it contains a `pile/` folder).
3. Reload Obsidian, enable **Pile**.

## Develop

```sh
npm install
npm run build   # emits main.js + styles.css
npm run dev     # watch mode
```

Reload the plugin in Obsidian after building.

## Release (maintainers)

One command — CI builds the files and publishes the release, so you never
generate `main.js`/`styles.css` by hand:

```sh
npm version patch   # or: minor | major
```

That bumps `package.json`, syncs `manifest.json` + `versions.json`, commits,
tags, and pushes. The tag push triggers `.github/workflows/release.yml`, which
builds and attaches `main.js` + `manifest.json` + `styles.css` to a new GitHub
Release. BRAT users get the update automatically.

## Status

Working: timeline, posting, replies/threads, highlights, tags, search,
attachments (native file picker + `app://` media), light/dark sync.
Untested/not wired: AI reflections & chat (needs API key plumbing), link
previews, auto-updates (stubbed — irrelevant inside Obsidian).

Desktop-only (`isDesktopOnly: true`): the shim uses Node `fs` and Electron
remote APIs that don't exist on Obsidian mobile.

## License & attribution

Pile is © Udara Jay, released under the MIT License — see
[VENDOR-PILE-LICENSE.md](VENDOR-PILE-LICENSE.md). Everything under
`src/vendor/` derives from the upstream project. Port shim and build setup
are likewise MIT.
