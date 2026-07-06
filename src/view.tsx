import { FileSystemAdapter, ItemView, WorkspaceLeaf } from "obsidian";
import fs from "fs";
import path from "path";
import type PilePlugin from "./main";
import { mountPile } from "./pile-bootstrap";

export const VIEW_TYPE_PILE = "pile-view";

export class PileView extends ItemView {
  private unmount: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PilePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_PILE;
  }
  getDisplayText() {
    return "Pile";
  }
  getIcon() {
    return "layers";
  }

  async onOpen() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      this.contentEl.setText("Pile requires a desktop vault (local filesystem).");
      return;
    }
    const vaultBase = adapter.getBasePath();
    const pluginDir = path.join(vaultBase, this.plugin.manifest.dir ?? "");

    // Shadow DOM isolation: Obsidian's global CSS (bare button/input/select
    // rules, community themes) cannot cross a shadow boundary, so Pile renders
    // exactly as it does in its own clean Electron page. attachShadow is
    // once-per-element, so reuse on reopen.
    const shadow =
      this.contentEl.shadowRoot ?? this.contentEl.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    // Pile's compiled CSS goes INSIDE the shadow. (Obsidian also auto-loads
    // styles.css into the document — that copy only registers @font-face,
    // since fonts must be document-level; its selectors match nothing in the
    // light DOM.)
    const style = document.createElement("style");
    try {
      style.textContent = fs.readFileSync(
        path.join(pluginDir, "styles.css"),
        "utf8"
      );
    } catch (e) {
      console.error("[pile] failed to read styles.css", e);
    }
    shadow.appendChild(style);

    const host = document.createElement("div");
    host.className = "pile-app-root";
    host.textContent = "Loading Pile…";
    shadow.appendChild(host);

    // Follow Obsidian's light/dark setting (not the OS): the build rewrites
    // Pile's prefers-color-scheme blocks to .is-dark-gated rules.
    const syncTheme = () =>
      host.classList.toggle(
        "is-dark",
        document.body.classList.contains("theme-dark")
      );
    syncTheme();
    this.registerEvent(this.app.workspace.on("css-change", syncTheme));

    // Radix portals without an in-tree container need an explicit target
    // inside the shadow (document.body would escape it).
    (window as any).__PILE_PORTAL__ = host;

    // Pile displays media via its own local:// Electron protocol, which
    // Obsidian doesn't register. Convert absolute disk paths to Obsidian
    // app:// resource URLs instead.
    (window as any).__PILE_RESOURCE__ = (absPath: string) => {
      const rel = path.relative(vaultBase, absPath).split(path.sep).join("/");
      return adapter.getResourcePath(rel);
    };

    // Defer heavy mounting until Obsidian's own init/layout is done, so we
    // never run (and never touch window.electron) inside its startup path.
    const run = async () => {
      host.textContent = "";
      try {
        this.unmount = await mountPile({
          container: host,
          pluginDir,
          vaultBase,
          pileFolder: this.plugin.settings.pileFolder,
          pileName: this.plugin.settings.pileName,
        });
      } catch (e) {
        console.error("[pile] mount failed", e);
        const pre = document.createElement("pre");
        pre.textContent =
          "Pile failed to mount:\n\n" +
          (e instanceof Error ? (e.stack ?? e.message) : String(e));
        host.textContent = "";
        host.appendChild(pre);
      }
    };
    this.app.workspace.onLayoutReady(run);
  }

  async onClose() {
    this.unmount?.();
    this.unmount = null;
    if ((window as any).__PILE_PORTAL__?.getRootNode() === this.contentEl.shadowRoot) {
      delete (window as any).__PILE_PORTAL__;
    }
    this.contentEl.shadowRoot?.replaceChildren();
  }
}
